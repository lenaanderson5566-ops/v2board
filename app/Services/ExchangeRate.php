<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

final class ExchangeRate
{
    public static function refresh(bool $manual = false): bool
    {
        // Persist the attempt before network I/O; failed automatic requests are not retried that day.
        $claimed = DB::transaction(function() use ($manual) {
            $row=DB::table('v2_exchange_rate')->where('id',1)->lockForUpdate()->first();
            $day=gmdate('Y-m-d');
            if ((!$manual && $row->automatic_day === $day) || ($row->attempted_at && $row->attempted_at > time()-60)) return false;
            DB::table('v2_exchange_rate')->where('id',1)->update(['attempted_at'=>time(),'automatic_day'=>$manual ? $row->automatic_day : $day]);
            return true;
        },3);
        if (!$claimed) return false;
        try {
            $response=Http::connectTimeout(5)->timeout(15)->withOptions(['allow_redirects'=>false])->get('https://open.er-api.com/v6/latest/USD');
            $data=$response->throw()->json();
            $rate=$data['rates']['CNY'] ?? null; $quoted=$data['time_last_update_unix'] ?? null;
            if (($data['result'] ?? '') !== 'success' || ($data['base_code'] ?? '') !== 'USD' || !is_numeric($rate)
                || $rate < 1 || $rate > 30 || !is_int($quoted) || $quoted > time()+300 || $quoted < time()-7*86400) throw new \RuntimeException('invalid_rate');
            DB::table('v2_exchange_rate')->where('id',1)->update(['usd_cny_micros'=>(int)round($rate*1000000),'quoted_at'=>$quoted,'fetched_at'=>time(),'last_error'=>null]);
            return true;
        } catch (\Throwable $e) {
            DB::table('v2_exchange_rate')->where('id',1)->update(['last_error'=>'refresh_failed']);
            return false;
        }
    }

    public static function snapshot(): array
    {
        $row=DB::table('v2_exchange_rate')->where('id',1)->first();
        abort_unless($row && $row->quoted_at >= time()-7*86400 && $row->usd_cny_micros, 503, __('Exchange rate unavailable. Please try again later.'));
        return ['usdCnyMicros'=>(int)$row->usd_cny_micros,'quotedAt'=>(int)$row->quoted_at,'source'=>'ExchangeRate-API'];
    }

    public static function convert(int $minor, string $from, string $to, array $snapshot): int
    {
        if (!in_array($from,['CNY','USD'],true) || !in_array($to,['CNY','USD'],true) || $minor < 0) throw new \InvalidArgumentException('Unsupported monetary amount');
        if ($from === $to) return $minor;
        if ($minor > 1000000000) throw new \InvalidArgumentException('Converted amount exceeds supported range');
        $rate=(int)($snapshot['usdCnyMicros'] ?? 0);
        if ($rate < 1000000 || $rate > 30000000) throw new \InvalidArgumentException('Invalid exchange rate');
        $numerator=$minor*($from === 'USD' ? $rate : 1000000);
        $denominator=$from === 'USD' ? 1000000 : $rate;
        return intdiv($numerator+intdiv($denominator,2),$denominator);
    }
}
