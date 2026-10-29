<?php
namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class ExperienceMeasurements
{
    public const EVENTS=['view','download','copy_success','copy_failed','import_start','help_open','api_request','api_error','network_error','js_error','lcp','inp','cls','guide_manual','guide_continue','payment_open'];
    public const METRICS=['api_request','lcp','inp','cls'];
    public const BUCKETS=[0,10,50,100,200,250,500,1000,2500,4000,10000,30000,60000,600000];

    public function ready(): bool { return Schema::hasTable('v2_analytics_measurement') && Schema::hasTable('v2_analytics_session'); }

    // Caller holds the session row lock, bounding both concurrent writes and storage per session.
    public function record(int $session, array $event): void
    {
        if (!$this->ready()) return;
        if ((int)DB::table('v2_analytics_measurement')->where('session_id',$session)->sum('samples')>=200) return;
        $value=(int)($event['value'] ?? 0); $bucket=0;
        foreach (self::BUCKETS as $limit) { $bucket=$limit; if ($value<=$limit) break; }
        $key=['session_id'=>$session,'page'=>$event['page'],'event'=>$event['event'],'bucket'=>$bucket];
        $q=DB::table('v2_analytics_measurement')->where($key);
        if ($q->exists()) $q->update(['samples'=>DB::raw('samples+1'),'value_sum'=>DB::raw('value_sum+'.$value)]);
        else DB::table('v2_analytics_measurement')->insert($key+['samples'=>1,'value_sum'=>$value]);
    }

    public function report(int $days, string $device): array
    {
        if (!$this->ready()) return ['available'=>false,'rows'=>[]];
        $settings=app(ProductAnalytics::class)->settings(); $now=time();
        $from=(new \DateTimeImmutable('tomorrow',new \DateTimeZone(TimeZones::system())))->modify('-'.$days.' days')->getTimestamp();
        $sessions=DB::table('v2_analytics_session')->where('created_at','>=',max($from,$now-$settings['retentionDays']*86400))->where('created_at','<=',$now);
        if ($device!=='all') $sessions->where('device',$device);
        $q=DB::table('v2_analytics_measurement as m')->joinSub($sessions->select('id'),'s','s.id','=','m.session_id');
        $counts=(clone $q)->select('m.page','m.event')->selectRaw('SUM(m.samples) AS samples, SUM(m.value_sum) AS value_sum, COUNT(DISTINCT m.session_id) AS sessions')->groupBy('m.page','m.event')->orderBy('m.page')->orderBy('m.event')->get();
        $buckets=(clone $q)->select('m.page','m.event','m.bucket')->selectRaw('SUM(m.samples) AS samples')->groupBy('m.page','m.event','m.bucket')->orderBy('m.bucket')->get()->groupBy(fn($r)=>$r->page.':'.$r->event);
        return ['available'=>true,'effectiveFrom'=>gmdate('c',max($from,$now-$settings['retentionDays']*86400)),'retentionDays'=>$settings['retentionDays'],'enabled'=>$settings['enabled'],
            'rows'=>$counts->map(function($r) use($buckets) {
                $percentile=function(float $fraction) use($r,$buckets) {
                    $target=(int)ceil((int)$r->samples*$fraction); $count=0;
                    foreach ($buckets[$r->page.':'.$r->event] ?? [] as $b) { $count+=(int)$b->samples; if ($count>=$target) return (int)$b->bucket; }
                    return null;
                };
                $metric=in_array($r->event,self::METRICS,true);
                return ['page'=>$r->page,'event'=>$r->event,'samples'=>(int)$r->samples,'sessions'=>(int)$r->sessions,
                    'average'=>$metric ? round((int)$r->value_sum/(int)$r->samples,2) : null,
                    'p75Upper'=>$metric ? $percentile(.75) : null,'p95Upper'=>$metric ? $percentile(.95) : null];
            })->all()];
    }
}
