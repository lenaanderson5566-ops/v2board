<?php
namespace App\Http\Controllers\V1\Admin;
use App\Http\Controllers\Controller;
use App\Services\NodeCredentials;
use Illuminate\Http\Request;
final class NodeCredentialController extends Controller {
    private function identity(Request $r): array {
        return $r->validate(['type'=>'required|in:v2node,v2box','id'=>'required|integer|min:1']);
    }
    private function verify(Request $r): int {
        abort_unless($r->isJson(),415);
        $user=\App\Models\User::findOrFail($r->input('user.id'));
        abort_unless($user->is_admin && !$user->banned,403);
        return (int)$user->id;
    }
    public function index(Request $r) {
        $p=$this->identity($r);
        return response()->json(['data'=>NodeCredentials::listing($p['type'],(int)$p['id'])]);
    }
    public function deployment(Request $r) {
        $p=$this->identity($r);$actor=$this->verify($r);
        abort_unless($p['type']==='v2box',422,'一键接入仅支持 V2Box');
        $v=$r->validate(['networkOnly'=>'sometimes|boolean']);
        return response()->json(['data'=>\App\Services\NodeDeployment::create((int)$p['id'],$actor,(bool)($v['networkOnly']??false))],201)->header('Cache-Control','private, no-store');
    }
    public function issue(Request $r) {
        $p=$this->identity($r); $actor=$this->verify($r);
        return response()->json(['data'=>NodeCredentials::issue($p['type'],(int)$p['id'],$actor)],201);
    }
    public function revoke(Request $r) {
        $p=$this->identity($r); $actor=$this->verify($r);
        $r->validate(['credentialId'=>'required|string|size:32|regex:/^[a-f0-9]+$/D']);
        NodeCredentials::revoke($p['type'],(int)$p['id'],$r->input('credentialId'),$actor);
        return response()->json(['data'=>true]);
    }
    public function disableLegacy(Request $r) {
        NodeCredentials::disableLegacy($this->verify($r));
        return response()->json(['data'=>true]);
    }
}
