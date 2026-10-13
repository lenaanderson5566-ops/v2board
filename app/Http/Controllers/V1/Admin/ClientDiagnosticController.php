<?php
namespace App\Http\Controllers\V1\Admin;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class ClientDiagnosticController extends \App\Http\Controllers\Controller {
    public function fetch(Request $request) {
        $input = $request->validate(['kind'=>'nullable|in:runtime,diagnostic','current'=>'nullable|integer|min:1','pageSize'=>'nullable|integer|min:1|max:100','keyword'=>'nullable|string|max:128','platform'=>'nullable|in:windows,macos,linux,android,ios']);
        $query = DB::table('v2_client_diagnostic_report as r')->leftJoin('v2_user as u','u.id','=','r.user_id');
        if (!empty($input['keyword'])) {
            $keyword = $input['keyword'];
            $query->where(function ($q) use ($keyword) {
                $q->where('r.report_id',$keyword)->orWhere('u.email','like','%'.$keyword.'%')->orWhere('r.client_version',$keyword);
                if (ctype_digit($keyword)) $q->orWhere('r.user_id',(int)$keyword);
            });
        }
        if (!empty($input['platform'])) $query->where('r.platform',$input['platform']);
        if (!empty($input['kind'])) $query->where('r.report_kind',$input['kind']);
        $total = (clone $query)->count();
        $rows = $query->select('r.*','u.email')->orderByDesc('r.id')->forPage($input['current'] ?? 1,$input['pageSize'] ?? 20)->get();
        foreach ($rows as $row) $row->checks = json_decode($row->checks,true);
        return response()->json(['data'=>$rows,'total'=>$total]);
    }
}
