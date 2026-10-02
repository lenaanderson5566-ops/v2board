<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\Notice;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
$checks = 0;
$assert = function ($ok, $message) use (&$checks) { if (!$ok) throw new RuntimeException($message); $checks++; };
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$call = function ($path, $body, $token = null) use ($kernel) {
    $request = Illuminate\Http\Request::create('/api/v1/'.$path, $body === null ? 'GET' : 'POST', $body ?? []);
    $request->headers->set('Accept', 'application/json');
    if ($token) $request->headers->set('Authorization', $token);
    return $kernel->handle($request);
};
$auths = [];
DB::beginTransaction();
try {
    $makeUser = function () use (&$auths) {
        $user = User::create(['email'=>'notice-'.Str::uuid().'@example.com', 'password'=>password_hash(Str::random(24), PASSWORD_DEFAULT),
            'uuid'=>App\Utils\Helper::guid(true), 'token'=>App\Utils\Helper::guid()]);
        $auth = new App\Services\AuthService($user); $auths[] = $auth;
        return [$user, $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data']];
    };
    [$user, $token] = $makeUser(); [$other, $otherToken] = $makeUser();
    $before = $user->refresh()->getAttributes();
    $notice = Notice::create(['title'=>'Read receipt fixture', 'content'=>'## Test', 'show'=>1]);
    $hidden = Notice::create(['title'=>'Hidden fixture', 'content'=>'Private', 'show'=>0]);
    $version = (int) $notice->getRawOriginal('updated_at');
    $read = ['id'=>$notice->id, 'version'=>$version];
    $assert($call('user/notice/inbox', null)->getStatusCode() === 403, 'Anonymous inbox access');
    $assert($call('user/notice/read', $read)->getStatusCode() === 403, 'Anonymous receipt access');
    $response = $call('user/notice/inbox', null, $token);
    $assert($response->getStatusCode() === 200, 'Inbox failed: '.$response->getContent());
    $inbox = json_decode($response->getContent(), true)['data'];
    $assert($inbox['unread'] === $inbox['total'], 'New user has existing receipts');
    $assert(!in_array($hidden->id, array_column($inbox['items'], 'id')), 'Hidden notice leaked');
    $assert(!DB::table('v2_notice_read')->where('user_id', $user->id)->exists(), 'Fetching marks read');
    $assert($call('user/notice/read', $read + ['user_id'=>$other->id], $token)->getStatusCode() === 200, 'Read failed');
    $assert(!DB::table('v2_notice_read')->where('user_id', $other->id)->exists(), 'Receipt escaped auth scope');
    $assert($call('user/notice/read', $read, $token)->getStatusCode() === 200, 'Retry failed');
    $assert(DB::table('v2_notice_read')->where('user_id', $user->id)->count() === 1, 'Duplicate receipt');
    $after = json_decode($call('user/notice/inbox', null, $token)->getContent(), true)['data'];
    $assert($after['unread'] === $inbox['unread'] - 1, 'Read count did not decrease');
    $otherInbox = json_decode($call('user/notice/inbox', null, $otherToken)->getContent(), true)['data'];
    $assert($otherInbox['unread'] === $inbox['unread'], 'Read state shared across accounts');
    $notice->update(['content'=>'New revision']);
    $assert((int) $notice->getRawOriginal('updated_at') > $version, 'Same-second edit failed to advance version');
    $assert($call('user/notice/read', $read, $token)->getStatusCode() === 409, 'Stale view acknowledged newer content');
    $after = json_decode($call('user/notice/inbox', null, $token)->getContent(), true)['data'];
    $assert($after['unread'] === $inbox['unread'], 'Edited notice remains read');
    $read['version'] = (int) $notice->getRawOriginal('updated_at');
    $assert($call('user/notice/read', $read, $token)->getStatusCode() === 200, 'Updated revision cannot be read');
    $notice->update(['show'=>0]);
    $assert($call('user/notice/read', $read, $token)->getStatusCode() === 404, 'Withdrawn receipt accepted');
    $assert($call('user/notice/fetch?id='.$notice->id, null, $token)->getStatusCode() === 404, 'Withdrawn detail leaked');
    $assert($call('user/notice/inbox?current=-1', null, $token)->getStatusCode() === 422, 'Invalid page accepted');
    $assert($call('user/notice/read', ['id'=>$hidden->id,'version'=>time()+100], $token)->getStatusCode() === 404, 'Hidden notice accepted');
    for ($i = 0; $i < 12; $i++) Notice::create(['title'=>'Pagination '.$i, 'content'=>'Test', 'show'=>1]);
    $first = json_decode($call('user/notice/inbox', null, $token)->getContent(), true)['data'];
    $second = json_decode($call('user/notice/inbox?current=2', null, $token)->getContent(), true)['data'];
    $assert(count($first['items']) === 10 && count($second['items']) >= 2, 'Pagination failed');
    $assert(!array_intersect(array_column($first['items'],'id'),array_column($second['items'],'id')), 'Unstable sort duplicates notices');
    $assert($first['unread'] === $first['total'] && $first['unread'] === $second['unread'], 'Unread count restricted to current page');
    $assert($user->refresh()->getAttributes() === $before, 'Notice read changed account state');
    echo "Announcement receipts: $checks checks passed\n";
} finally {
    foreach ($auths as $auth) $auth->removeAllSession();
    DB::rollBack();
}
