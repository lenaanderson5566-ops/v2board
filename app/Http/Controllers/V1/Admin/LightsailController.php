<?php

namespace App\Http\Controllers\V1\Admin;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;
use App\Jobs\RotateLightsailIpJob;
class LightsailController extends \App\Http\Controllers\Controller
{
    public function fetch()
    {
        return response(['data' => DB::table('v2_lightsail_server')->select('id', 'name', 'region', 'instance', 'node_type', 'node_id', 'status', 'phase', 'current_ip', 'error_code', 'operation_at', 'old_name')->orderBy('id')->get()->map(function ($r) {
            $r->canRestore = (bool) $r->old_name;
            $r->recoverable = $r->status === 'failed' || in_array($r->status, ['queued', 'running'], true) && $r->operation_at < time() - 360;
            unset($r->operation_at, $r->old_name);
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
        $v = $request->validate(['id' => 'required|integer|min:1']);
        DB::transaction(function () use ($v) {
            $row = DB::table('v2_lightsail_server')->where('id', $v['id'])->lockForUpdate()->first();
            if (!$row) {
                abort(404, '配置不存在');
            }
            if (!in_array($row->status, ['ready', 'completed', 'restored'], true) && !($row->status === 'failed' && $row->phase === 'idle')) {
                abort(409, '请先完成或恢复 IP 操作');
            }
            DB::table('v2_lightsail_server')->where('id', $row->id)->delete();
        }, 3);
        return response(['data' => true]);
    }
    public function save(Request $request)
    {
        $v = $request->validate(['id' => 'nullable|integer|min:1', 'name' => 'required|string|max:100', 'region' => ['required', 'string', 'regex:/^[a-z]{2}(-[a-z]+)+-\d$/'], 'instance' => ['required', 'string', 'max:255', 'regex:/^[A-Za-z0-9][A-Za-z0-9_.-]*$/'], 'node_type' => 'required|in:v2node,v2box', 'node_id' => 'required|integer|min:1', 'accessKey' => 'nullable|string|max:128', 'secretKey' => 'nullable|string|max:256', 'sessionToken' => 'nullable|string|max:8192']);
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
            if ($row && $row->status === 'failed' && ($row->region !== $v['region'] || $row->instance !== $v['instance'] || $row->node_type !== $v['node_type'] || (int) $row->node_id !== (int) $v['node_id'])) {
                abort(409, '失败操作只能更新名称和凭据，实例与节点关联需要保持不变');
            }
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
            if (!empty($v['sessionToken']) && (empty($v['accessKey']) || empty($v['secretKey']))) {
                abort(422, '更新 Session Token 时请同时填写 Access Key 和 Secret Key');
            }
            if (!empty($v['accessKey']) || !empty($v['secretKey'])) {
                if (empty($v['accessKey']) || empty($v['secretKey'])) {
                    abort(422, 'Access Key 和 Secret Key 必须同时填写');
                }
                $credentials = ['key' => $v['accessKey'], 'secret' => $v['secretKey']];
                if (!empty($v['sessionToken'])) {
                    $credentials['token'] = $v['sessionToken'];
                }
                $data['credentials'] = Crypt::encryptString(json_encode($credentials, JSON_THROW_ON_ERROR));
            } elseif (!$row) {
                abort(422, '请填写 AWS 凭据');
            }
            if ($row) {
                DB::table('v2_lightsail_server')->where('id', $row->id)->update($data);
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
