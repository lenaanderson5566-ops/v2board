<?php
namespace App\Http\Controllers\V10;
use App\Http\Controllers\Controller;
use App\Services\NodeDdnsService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
class NodeAddressController extends Controller {
    public function store(Request $request) {
        $token=$request->bearerToken();
        abort_unless(is_string($token) && preg_match('/^[a-f0-9]{64}$/',$token),401,'Invalid report credential');
        return DB::transaction(function () use ($request,$token) {
            $row=DB::table('v2_node_ddns')->where('report_hash',hash('sha256',$token))->lockForUpdate()->first();
            abort_unless($row,401,'Invalid report credential');
            abort_unless($row->enabled && NodeDdnsService::nodeExists($row),403,'Address reporting disabled');
            abort_if(count(array_diff(array_keys($request->all()),['ipv4','ipv6']))>0,422,'Unknown address field');
            $v=$request->validate(['ipv4'=>'required_without:ipv6|string|max:45','ipv6'=>'required_without:ipv4|string|max:45']);
            $data=[];
            foreach ($v as $family=>$ip) {
                abort_unless(($row->family==='dual' || $row->family===$family) && NodeDdnsService::publicAddress($ip,$family==='ipv4' ? 4 : 6),422,'A public address in the configured family is required');
                $data[$family]=inet_ntop(inet_pton($ip)); $data[$family.'_seen_at']=time();
            }
            // Do not reset provider backoff or authentication pauses on every heartbeat.
            DB::table('v2_node_ddns')->where('id',$row->id)->update($data);
            return response()->json(['data'=>['accepted'=>true]],202,['Cache-Control'=>'private, no-store']);
        });
    }
}
