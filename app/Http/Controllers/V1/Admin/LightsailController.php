<?php

namespace App\Http\Controllers\V1\Admin;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;
use App\Jobs\RotateLightsailIpJob;
use App\Services\LightsailService;
class LightsailController extends \App\Http\Controllers\Controller
{
    public function credentials()
    {
        $usage = DB::table('v2_lightsail_server')->selectRaw("credential_id, COUNT(*) AS server_count, SUM(status IN ('queued','running')) AS active_count")->groupBy('credential_id')->get()->keyBy('credential_id');
        return response(['data' => DB::table('v2_lightsail_credential')->select('id', 'name')->orderBy('id')->get()->map(function ($row) use ($usage) {
            $row->server_count = (int) ($usage[$row->id]->server_count ?? 0);
            $row->active_count = (int) ($usage[$row->id]->active_count ?? 0);
            return $row;
        })]);
    }
    public function saveCredential(Request $request)
    {
        $v = $request->validate(['id'=>'nullable|integer|min:1', 'name'=>'required|string|max:100', 'accessKey'=>'nullable|string|max:128', 'secretKey'=>'nullable|string|max:256', 'sessionToken'=>'nullable|string|max:8192', 'confirmSharedUpdate'=>'sometimes|boolean']);
        $id = DB::transaction(function () use ($v) {
            $row = !empty($v['id']) ? DB::table('v2_lightsail_credential')->where('id', $v['id'])->lockForUpdate()->first() : null;
            if (!empty($v['id']) && !$row) abort(404, 'AWS 密钥不存在');
            $secret = $this->encryptCredential($v, !$row);
            $data = ['name'=>$v['name']];
            $locks = [];
            try {
                if ($secret !== null) {
                    $servers = $row ? DB::table('v2_lightsail_server')->where('credential_id', $row->id)->get() : collect();
                    if ($servers->count() > 1 && empty($v['confirmSharedUpdate'])) abort(409, '此密钥被多台服务器共用，请确认同步更新全部绑定服务器');
                    foreach ($servers as $server) {
                        if (in_array($server->status, ['queued','running'], true)) abort(409, '绑定服务器正在执行 IP 操作，请稍后更新密钥');
                        $lock = LightsailService::operationLock($server);
                        if (!$lock->get()) abort(409, '绑定服务器的 IP 操作仍在执行，请稍后重试');
                        $locks[] = $lock;
                    }
                    $data['credentials'] = $secret;
                }
                if (!$row) return DB::table('v2_lightsail_credential')->insertGetId($data);
                DB::table('v2_lightsail_credential')->where('id', $row->id)->update($data);
                return $row->id;
            } finally { foreach ($locks as $lock) $lock->release(); }
        }, 3);
        return response(['data'=>['id'=>$id]]);
    }
    public function dropCredential(Request $request)
    {
        $v = $request->validate(['id'=>'required|integer|min:1']);
        DB::transaction(function () use ($v) {
            $row = DB::table('v2_lightsail_credential')->where('id', $v['id'])->lockForUpdate()->first();
            if (!$row) abort(404, 'AWS 密钥不存在');
            if (DB::table('v2_lightsail_server')->where('credential_id', $row->id)->exists()) abort(409, '密钥仍被服务器使用，请先更换或移除绑定');
            DB::table('v2_lightsail_credential')->where('id', $row->id)->delete();
        }, 3);
        return response(['data'=>true]);
    }
    private function encryptCredential(array $v, bool $required = false): ?string
    {
        if (!empty($v['sessionToken']) && (empty($v['accessKey']) || empty($v['secretKey']))) abort(422, '更新 Session Token 时请同时填写 Access Key 和 Secret Key');
        if (empty($v['accessKey']) && empty($v['secretKey'])) {
            if ($required) abort(422, '请填写 AWS 凭据');
            return null;
        }
        if (empty($v['accessKey']) || empty($v['secretKey'])) abort(422, 'Access Key 和 Secret Key 必须同时填写');
        $credentials = ['key'=>$v['accessKey'], 'secret'=>$v['secretKey']];
        if (!empty($v['sessionToken'])) $credentials['token'] = $v['sessionToken'];
        return Crypt::encryptString(json_encode($credentials, JSON_THROW_ON_ERROR));
    }
    public function fetch()
    {
        return response(['data' => DB::table('v2_lightsail_server')->select('id', 'name', 'region', 'instance', 'node_type', 'node_id', 'credential_id', 'status', 'phase', 'current_ip', 'error_code', 'operation_at', 'old_name', 'new_name')->orderBy('id')->get()->map(function ($r) {
            $r->canRestore = (bool) $r->old_name;
            $r->recoverable = $r->status === 'failed' || in_array($r->status, ['queued', 'running'], true) && $r->operation_at < time() - 360;
            $r->staticIpNames = array_values(array_unique(array_filter([$r->old_name, $r->new_name])));
            unset($r->operation_at, $r->old_name, $r->new_name);
            return $r;
        })]);
    }
    public function inspect(Request $request)
    {
        $v = $request->validate(['id' => 'required|integer|min:1']);
        $row = DB::table('v2_lightsail_server')->find($v['id']);
        if (!$row) {
            abort(404, '配置不存在');
        }
        try {
            $instance = (new \App\Services\LightsailService())->client($row)->getInstance(['instanceName' => $row->instance])['instance'];
            return response(['data' => ['publicIp' => $instance['publicIpAddress'] ?? null, 'staticIp' => (bool) ($instance['isStaticIp'] ?? false)]]);
        } catch (\Throwable $e) {
            abort(502, '无法查询 AWS 实例，请检查区域、实例名称及凭据权限');
        }
    }
    public function drop(Request $request)
    {
        $v = $request->validate(['id' => 'required|integer|min:1', 'abandonOperation' => 'sometimes|boolean']);
        DB::transaction(function () use ($v) {
            $row = DB::table('v2_lightsail_server')->where('id', $v['id'])->lockForUpdate()->first();
            if (!$row) {
                abort(404, '配置不存在');
            }
            if (!in_array($row->status, ['ready', 'completed', 'restored', 'failed'], true)) {
                abort(409, 'IP 操作正在进行，请等待完成或失败后再移除配置');
            }
            if ($row->status === 'failed' && empty($v['abandonOperation'])) abort(409, '请确认放弃未完成操作，AWS 实例和新旧静态 IP 将保留，需要自行核对');
            $lock = LightsailService::operationLock($row);
            if (!$lock->get()) abort(409, 'IP 操作仍在执行，请稍后重试');
            try {
                DB::table('v2_lightsail_server')->where('id', $row->id)->delete();
            } finally {
                $lock->release();
            }
        }, 3);
        return response(['data' => true]);
    }
    public function save(Request $request)
    {
        $v = $request->validate(['id' => 'nullable|integer|min:1', 'name' => 'required|string|max:100', 'region' => ['required', 'string', 'regex:/^[a-z]{2}(-[a-z]+)+-\d$/'], 'instance' => ['required', 'string', 'max:255', 'regex:/^[A-Za-z0-9][A-Za-z0-9_.-]*$/'], 'node_type' => 'required|in:v2box', 'node_id' => 'required|integer|min:1', 'accessKey' => 'nullable|string|max:128', 'secretKey' => 'nullable|string|max:256', 'sessionToken' => 'nullable|string|max:8192']);
        $v += $request->validate(['abandonOperation' => 'sometimes|boolean', 'credential_id'=>'nullable|integer|min:1']);
        DB::transaction(function () use ($v) {
            $node = DB::table('v2_server_' . $v['node_type'])->where('id', $v['node_id'])->lockForUpdate()->first();
            if (!$node || $node->service_id) {
                abort(422, '请选择有效的代理服务');
            }
            $row = isset($v['id']) ? DB::table('v2_lightsail_server')->where('id', $v['id'])->lockForUpdate()->first() : null;
            if (isset($v['id']) && !$row) {
                abort(404, '配置不存在');
            }
            if ($row && in_array($row->status, ['queued', 'running'], true)) {
                abort(409, 'IP 操作正在进行');
            }
            $targetChanged = $row && ($row->region !== $v['region'] || $row->instance !== $v['instance'] || $row->node_type !== $v['node_type'] || (int) $row->node_id !== (int) $v['node_id'] || isset($v['credential_id']) && (int)$row->credential_id !== (int)$v['credential_id']);
            $abandon = $row && $row->status === 'failed' && !empty($v['abandonOperation']);
            if ($row && $row->status === 'failed' && $targetChanged && !$abandon) abort(409, '修改关联前请确认放弃未完成操作；也可只修改名称和凭据后继续操作');
            $duplicate = DB::table('v2_lightsail_server')->where('node_type', $v['node_type'])->where('node_id', $v['node_id']);
            if ($row) {
                $duplicate->where('id', '!=', $row->id);
            }
            if ($duplicate->exists()) {
                abort(409, '节点已绑定 Lightsail 配置');
            }
            $physical = DB::table('v2_lightsail_server')->where('region', $v['region'])->where('instance', $v['instance']);
            if ($row) {
                $physical->where('id', '!=', $row->id);
            }
            if ($physical->exists()) {
                abort(409, '实例已经配置，请复用代理服务关联');
            }
            $data = array_intersect_key($v, array_flip(['name', 'region', 'instance', 'node_type', 'node_id']));
            if ($targetChanged || $abandon) {
                $data += ['status' => 'ready', 'phase' => 'idle', 'operation' => 'rotate', 'old_name' => null, 'new_name' => null, 'current_ip' => null, 'error_code' => null, 'operation_at' => 0];
            }
            $credentialId = $v['credential_id'] ?? $row->credential_id ?? null;
            $credential = $credentialId ? DB::table('v2_lightsail_credential')->where('id', $credentialId)->lockForUpdate()->first() : null;
            if ($credentialId && !$credential) abort(422, '请选择有效的 AWS 密钥');
            $secret = $this->encryptCredential($v, !$credential);
            if ($secret !== null) {
                if ($credential && ((!$row || (int)$row->credential_id !== (int)$credentialId) || DB::table('v2_lightsail_server')->where('credential_id', $credentialId)->count() > 1)) abort(409, '共用密钥请在 AWS 密钥管理中更新');
                if ($credential) DB::table('v2_lightsail_credential')->where('id', $credentialId)->update(['credentials'=>$secret]);
                else $credentialId = DB::table('v2_lightsail_credential')->insertGetId(['name'=>mb_substr($v['name'].' AWS',0,100), 'credentials'=>$secret]);
            }
            $data['credential_id'] = $credentialId;
            if ($row) {
                $lock = LightsailService::operationLock($row);
                if (!$lock->get()) abort(409, 'IP 操作仍在执行，请稍后重试');
                try {
                    DB::table('v2_lightsail_server')->where('id', $row->id)->update($data);
                } finally {
                    $lock->release();
                }
            } else {
                DB::table('v2_lightsail_server')->insert($data);
            }
        }, 3);
        return response(['data' => true]);
    }
    public function operate(Request $request)
    {
        $v = $request->validate(['id' => 'required|integer|min:1', 'action' => 'required|in:rotate,resume,restore', 'confirmInstance' => 'required|string|max:255']);
        DB::transaction(function () use ($v) {
            $row = DB::table('v2_lightsail_server')->where('id', $v['id'])->lockForUpdate()->first();
            if (!$row) {
                abort(404, '配置不存在');
            }
            if (!hash_equals($row->instance, $v['confirmInstance'])) {
                abort(422, '实例名称确认不匹配');
            }
            if (in_array($row->status, ['queued', 'running'], true) && $row->operation_at >= time() - 360) {
                abort(409, '操作正在进行');
            }
            $recoverable = $row->status === 'failed' || in_array($row->status, ['queued', 'running'], true) && $row->operation_at < time() - 360;
            if ($v['action'] === 'rotate') {
                if (!in_array($row->status, ['ready', 'completed', 'restored'], true)) {
                    abort(409, '请先继续或恢复上次操作');
                }
                $data = ['operation' => 'rotate', 'phase' => 'idle', 'old_name' => null, 'new_name' => 'v2board-' . Str::uuid(), 'error_code' => null];
            } elseif ($v['action'] === 'restore') {
                if (!$recoverable || !$row->old_name) {
                    abort(409, '没有可恢复的操作');
                }
                $data = ['operation' => 'restore', 'error_code' => null];
            } else {
                if (!$recoverable) {
                    abort(409, '没有可继续的操作');
                }
                $data = ['error_code' => null];
            }
            $data['status'] = 'queued';
            $data['operation_at'] = time();
            DB::table('v2_lightsail_server')->where('id', $row->id)->update($data);
            RotateLightsailIpJob::dispatch($row->id)->afterCommit();
        }, 3);
        return response(['data' => true], 202);
    }
}
