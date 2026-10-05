<?php
namespace App\Http\Resources\V10;

final class Resource
{
    public const PERIODS = ['month_price'=>'monthly','quarter_price'=>'quarterly','half_year_price'=>'semiannual','year_price'=>'annual','two_year_price'=>'biennial','three_year_price'=>'triennial','onetime_price'=>'credits','reset_price'=>'reset','deposit'=>'deposit'];
    public const ORDER_STATUSES = ['unpaid','processing','cancelled','completed','discounted'];
    public static function contracts(): array
    {
        static $contracts;
        return $contracts ?? ($contracts = json_decode(file_get_contents(base_path('docs/api-v10/contracts.json')), true, 512, JSON_THROW_ON_ERROR));
    }
    public static function encode(string $name, $data, array $payload = [])
    {
        if ($name === 'scalar') return is_scalar($data) || $data === null ? $data : null;
        if ($name === 'strings') return array_values(array_filter((array)$data, 'is_string'));
        if ($name === 'orderCreated') return ['orderNumber'=>$data];
        if ($name === 'orderStatus') return ['status'=>self::ORDER_STATUSES[(int)$data] ?? 'unknown'];
        if ($name === 'payment') return ['kind'=>[-1=>'confirmed',0=>'qr',1=>'redirect',2=>'pending'][$payload['type'] ?? 2] ?? 'pending', 'value'=>$data];
        if ($name === 'authentication') {
            $token = $data['auth_data'] ?? '';
            $claims = explode('.', $token);
            $claims = isset($claims[1]) ? json_decode(base64_decode(strtr($claims[1], '-_', '+/')), true) : [];
            return ['accessToken'=>$token,'tokenType'=>'Bearer','expiresAt'=>self::time($claims['exp'] ?? null),'account'=>['id'=>$claims['id'] ?? null,'administrator'=>(bool)($data['is_admin'] ?? false)]];
        }
        if ($name === 'summary') return ['pendingOrders'=>$data[0] ?? 0,'pendingTickets'=>$data[1] ?? 0,'referrals'=>$data[2] ?? 0];
        if ($name === 'referrals') {
            $s=$data['stat'] ?? [];
            return ['rewards'=>$data['rewards'] ?? ['registrationBytes'=>0,'firstUseBytes'=>0,'validityMonths'=>1],'registeredUsers'=>$s[0] ?? 0,'earnedCommission'=>$s[1] ?? 0,'pendingCommission'=>(int)round($s[2] ?? 0),'commissionRate'=>$s[3] ?? 0,'availableCommission'=>$s[4] ?? 0,'currency'=>\App\Services\Money::CURRENCY];
        }
        if ($name === 'inbox') return ['items'=>self::encode('array:notification',$data['items'] ?? []),'unread'=>$data['unread'] ?? 0];
        if ($name === 'articles') {
            if (isset($data['id'])) return self::encode('article',$data);
            $groups=[];
            foreach ((array)$data as $category=>$items) $groups[$category]=self::encode('array:article',$items);
            return (object)$groups;
        }
        if (str_contains($name, ':')) {
            [$kind,$child]=explode(':',$name,2);
            if ($kind === 'flex') return isset($data['id']) ? self::encode($child,$data) : self::encode('array:'.$child,$data);
            $rows=[];
            foreach ((array)$data as $id=>$row) {
                $value=self::encode($child,$row);
                if ($kind === 'dictionary') $rows[$id]=$value; else $rows[]=$value;
            }
            return $kind === 'dictionary' ? (object)$rows : $rows;
        }
        if ($data === null) return null;
        $out=[];
        foreach (self::contracts()['schemas'][$name] as $external=>$spec) {
            [$source]=$spec;
            if (!array_key_exists($source,(array)$data)) continue;
            $v=$data[$source]; $type=$spec[1] ?? null;
            if ($type === 'time') $v=self::time($v);
            elseif ($type === 'boolean') $v=(bool)$v;
            elseif ($type === 'integer') $v=$v === null ? null : (int)$v;
            elseif ($type === 'number') $v=$v === null ? null : (float)$v;
            elseif ($type === 'strings') $v=array_values(array_filter((array)$v,'is_string'));
            elseif ($type === 'gb') $v=(int)round($v*1073741824);
            elseif ($type === 'period') $v=self::PERIODS[$v] ?? 'unknown';
            elseif ($type === 'orderStatus') $v=self::ORDER_STATUSES[(int)$v] ?? 'unknown';
            elseif ($type === 'ticketStatus') $v=['open','closed'][(int)$v] ?? 'unknown';
            elseif ($type === 'orderKind') $v=[1=>'new',2=>'renewal',3=>'switch',4=>'reset'][(int)$v] ?? 'other';
            elseif ($type === 'priority') $v=['normal','high','urgent'][(int)$v] ?? 'normal';
            elseif ($type === 'couponType') $v=[1=>'amount',2=>'percentage'][(int)$v] ?? 'unknown';
            elseif ($type === 'replyStatus') $v=(int)$v === 1 ? 'awaiting-user' : 'awaiting-staff';
            elseif ($type === 'object') $v=self::encode($spec[2],$v);
            elseif ($type === 'array') $v=self::encode('array:'.$spec[2],$v);
            if (in_array($external,['imageUrl','mobileImageUrl'],true) && is_string($v)) $v=str_replace('/api/v1/guest/banner/image/','/api/v10/public/banner-images/',$v);
            $out[$external]=$v;
        }
        if (in_array($name,['plan','order','credit','account','paymentMethod','commission','coupon'],true)) $out['currency']=$name === 'order' ? ($data['currency'] ?? \App\Services\Money::CURRENCY) : \App\Services\Money::CURRENCY;
        return $out;
    }
    private static function time($value): ?string
    {
        if (!$value) return null;
        $timestamp=is_numeric($value) ? (int)$value : strtotime($value);
        return $timestamp ? gmdate('Y-m-d\TH:i:s\Z',$timestamp) : null;
    }
}
