<?php
namespace App\Services;
use Illuminate\Support\Facades\Cache;

/** All mail workers for this application share the same sender budget in Redis. */
class MailRateLimiter
{
    private function scope()
    {
        return 'mail-rate:' . hash('sha256', config('mail.host').'|'.config('mail.username').'|'.config('mail.from.address'));
    }
    public function domain($email)
    {
        $domain = strtolower(substr(strrchr($email, '@') ?: '', 1));
        if (in_array($domain, ['gmail.com','googlemail.com'])) return 'gmail';
        if (in_array($domain, ['qq.com','vip.qq.com','foxmail.com'])) return 'qq';
        if (in_array($domain, ['163.com','126.com','yeah.net','vip.163.com','vip.126.com'])) return 'netease';
        return hash('sha256', $domain);
    }
    public function acquire($email, $bulk, $priority = false)
    {
        $cache = Cache::store('redis');
        $key = $this->scope();
        // Verification has dedicated workers and its own failure cooldown. Bulk gates never delay it.
        if ($priority) return max(0, (int)$cache->get($key.':priority:'.$this->domain($email).':cooldown', 0) - time());
        $lock = $cache->lock($key.':lock', 5);
        if (!$lock->get()) return 1;
        try {
            $now = time(); $domain = $key.':'.$this->domain($email);
            $gates = [$key.':all', $domain.':cooldown'];
            if ($bulk) $gates = array_merge($gates, [$key.':bulk', $domain.':bulk']);
            $wait = 0;
            foreach ($gates as $gate) $wait = max($wait, (int)$cache->get($gate, 0) - $now);
            if ($wait > 0) return $wait;
            $cache->put($key.':all', $now + max(1, (int)config('v2board.email_send_interval', 2)), 86400);
            if ($bulk) {
                $cache->put($key.':bulk', $now + max(1, (int)config('v2board.email_bulk_interval', 10)), 86400);
                $cache->put($domain.':bulk', $now + max(1, (int)config('v2board.email_domain_interval', 30)), 86400);
            }
            return 0;
        } finally { $lock->release(); }
    }
    public function cooldown($email, $priority = false)
    {
        $cache = Cache::store('redis'); $key = $this->scope().($priority ? ':priority:' : ':').$this->domain($email);
        $attempt = $cache->increment($key.':failures');
        $cache->put($key.':failures', $attempt, 3600);
        $cache->put($key.':cooldown', time() + ($priority ? min(60, 5 * pow(2, min(4, $attempt - 1))) : min(900, 60 * pow(2, min(4, $attempt - 1)))), 1800);
    }
    public function permanent($exception)
    {
        if (preg_match('/rate.?limit|too many|quota exceeded|daily.*limit|频率|频繁/i', $exception->getMessage())) return false;
        $code = (int)$exception->getCode();
        // Swift includes both expected and received SMTP codes; only inspect the received code.
        if (preg_match('/got code ["\']?(\d{3})/i', $exception->getMessage(), $match)) $code = (int)$match[1];
        return $code >= 500 && $code < 600;
    }
}
