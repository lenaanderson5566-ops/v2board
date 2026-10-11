<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
class SystemLogService {
    public const TITLES=['API request','Admin operation','Client configuration request','V10 request failed','Application exception','Application event'];
    public static function metadata(array $context): array {
        $id=$context['requestId'] ?? null;
        $status=$context['status'] ?? null; $duration=$context['durationMs'] ?? null;
        return [
            'request_id'=>is_string($id) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i',$id) ? strtolower($id) : null,
            'http_status'=>is_int($status) && $status>=100 && $status<=599 ? $status : null,
            'duration_ms'=>is_int($duration) && $duration>=0 && $duration<=4294967295 ? $duration : null,
            'metadata_indexed'=>true,
        ];
    }
    public function backfill(int $batchSize=500): int {
        $rows=DB::table('v2_log')->where('metadata_indexed',false)->orderBy('id')->limit($batchSize)->get(['id',DB::raw('CASE WHEN OCTET_LENGTH(context) <= 8192 THEN context ELSE NULL END AS context')]);
        $deadline=microtime(true)+5; $indexed=0;
        foreach ($rows as $row) {
            $context=json_decode($row->context ?? '',true);
            DB::table('v2_log')->where('id',$row->id)->where('metadata_indexed',false)->update(self::metadata(is_array($context) ? $context : []));
            $indexed++;
            if (microtime(true)>$deadline) break;
        }
        return $indexed;
    }
    public static function resource($row): array {
        // Legacy rows may still contain raw request data. Never send it to the browser.
        return ['id'=>$row->id,'title'=>in_array($row->title,self::TITLES,true) ? $row->title : 'Legacy application event',
            'level'=>$row->level,'method'=>in_array($row->method,['GET','POST','PATCH','PUT','DELETE','HEAD','OPTIONS'],true) ? $row->method : '',
            'uri'=>$row->route_template ?? '历史记录未保存路由模板','request_id'=>$row->request_id,'http_status'=>$row->http_status,'duration_ms'=>$row->duration_ms,'created_at'=>(int)$row->created_at];
    }
}
