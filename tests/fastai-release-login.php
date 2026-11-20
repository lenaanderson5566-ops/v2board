<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$call = function ($path, $body = [], $token = null, $method = 'GET') use ($app) {
    $request = Illuminate\Http\Request::create('/api/v10/'.$path, $method, $body);
    $request->headers->set('Accept', 'application/json');
    if ($token) $request->headers->set('Authorization', 'Bearer '.$token);
    $app->instance('request', $request);
    return $app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
};
$release = ['platform'=>'windows', 'architecture'=>'x64', 'channel'=>'stable', 'latestVersion'=>'1.2.0', 'latestBuild'=>2026100602,
    'minimumVersion'=>'1.0.0', 'downloadUrl'=>'https://fastdog.ws/download/FastAI.exe', 'sha256'=>str_repeat('a',64),
    'releaseNotes'=>'Release', 'publishedAt'=>'2026-10-06T00:00:00Z'];
$original = config('fastai');
$auth = null;
Illuminate\Support\Facades\DB::beginTransaction();
try {
    config(['fastai.fastai_releases'=>[$release], 'fastai.app_url'=>'https://fastdog.ws']);
    $response = $call('public/fastai/releases/latest?platform=windows&architecture=x64');
    $assert($response->getStatusCode()===200, 'Public release endpoint');
    $data = json_decode($response->getContent(), true)['data'];
    $assert($data['latestVersion']==='1.2.0' && $data['latestBuild']===2026100602 && $data['minimumVersion']==='1.0.0', 'Semantic release contract');
    $assert($data['sha256']===$release['sha256'], 'Release digest');
    $assert($call('public/fastai/releases/latest?platform=android&architecture=arm64')->getStatusCode()===404, 'No cross-platform installer fallback');
    $assert($call('public/fastai/releases/latest?platform=windows')->getStatusCode()===422, 'Architecture required');
    foreach ([['downloadUrl'=>'http://fastdog.ws/update.exe'], ['minimumVersion'=>'9.0.0'], ['sha256'=>'wrong']] as $patch) {
        try { App\Services\FastaiReleaseService::validateCatalog([array_merge($release,$patch)]); throw new RuntimeException('Invalid release accepted'); }
        catch (Illuminate\Validation\ValidationException $e) { $checks++; }
    }
    $service = new App\Services\FastaiReleaseService();
    $assert(!$service->supports('0.8.99','windows','x64') && $service->supports('1.0.0','windows','x64'), 'Minimum version policy');
    $assert(!$service->supports('0.8.99','windows',null), 'Legacy native requests still enforce platform minimum');
    $abisByPlatform = ['windows'=>['x64','arm64'], 'android'=>['x64','arm64','arm'], 'macos'=>['x64','arm64'], 'linux'=>['x64','arm64']];
    foreach ($abisByPlatform as $platform => $abis) {
        $universal = array_replace($release, ['platform'=>$platform, 'architecture'=>'universal', 'latestBuild'=>5000]);
        App\Services\FastaiReleaseService::validatePublication([$universal], null);
        config(['fastai.fastai_releases'=>[$universal]]);
        foreach ($abis as $abi) {
            $response = $call("public/fastai/releases/latest?platform=$platform&architecture=$abi");
            $body = json_decode($response->getContent(), true)['data'];
            $assert($response->getStatusCode()===200 && $body===array_replace($data, ['platform'=>$platform, 'architecture'=>$abi, 'latestBuild'=>5000]), 'One installer serves '.$platform.' / '.$abi.' with the native response ABI');
        }
        $assert($call("public/fastai/releases/latest?platform=$platform&architecture=x86")->getStatusCode()===404, 'Unsupported ABI cannot use a universal package');
        $assert($call("public/fastai/releases/latest?platform=$platform&architecture=universal")->getStatusCode()===422, 'Clients must report their actual ABI');
        $assert(!$service->supports('0.8.99',$platform,'arm64'), 'Universal release enforces its minimum version');
        $specific = array_replace($universal, ['architecture'=>'arm64', 'downloadUrl'=>'https://fastdog.ws/download/specific', 'latestBuild'=>5100]);
        foreach ([[$specific,$universal],[$universal,$specific]] as $catalog) {
            config(['fastai.fastai_releases'=>$catalog]);
            $assert($service->release($platform,'arm64')===$specific, 'Higher build wins in either catalog order');
        }
        $specific['minimumVersion'] = '1.1.0';
        foreach ([['latestVersion'=>'1.3.0', 'latestBuild'=>1], ['latestBuild'=>5101]] as $change) {
            $newer = array_replace($universal, $change);
            config(['fastai.fastai_releases'=>[$specific,$newer]]);
            $response = $call("public/fastai/releases/latest?platform=$platform&architecture=arm64");
            $body = json_decode($response->getContent(), true)['data'];
            $assert($response->getStatusCode()===200 && $body['architecture']==='arm64' && $body['downloadUrl']===$newer['downloadUrl'] && $body['latestBuild']===$newer['latestBuild'], 'Newer universal release reaches existing ABI installations');
            $assert($body['minimumVersion']==='1.1.0' && !$service->supports('1.0.0',$platform,'arm64'), 'Older per-ABI minimum still applies');
        }
        $tie = array_replace($universal, ['latestBuild'=>5100, 'minimumVersion'=>'1.2.0']);
        config(['fastai.fastai_releases'=>[$tie,$specific]]);
        $assert($service->release($platform,'arm64')===array_replace($specific,['minimumVersion'=>'1.2.0']), 'Exact ties use the per-ABI file and preserve the higher universal minimum');
    }
    $installers = new App\Services\FastaiInstallerService();
    foreach (['windows'=>'FastAI.exe','android'=>'FastAI.apk','macos'=>'FastAI.pkg','linux'=>'FastAI-1.0.1-Linux-Setup.run'] as $platform=>$filename) {
        $fixture = 'local installer fixture for '.$platform;
        $upload = ['name'=>$filename,'platform'=>$platform,'architecture'=>'universal','size'=>strlen($fixture),'latestVersion'=>'1.2.0','latestBuild'=>5100];
        if ($platform === 'linux') {
            foreach ([['architecture'=>'x64'],['platform'=>'macos']] as $invalidTarget) {
                try {
                    $installers->create(array_replace($upload, $invalidTarget));
                    throw new RuntimeException('Linux universal installer accepted for a different target');
                } catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {
                    $assert($e->getStatusCode()===422, 'Linux .run format is restricted to the matching target');
                }
            }
        }
        $stored = $installers->create($upload);
        $temp = tempnam(sys_get_temp_dir(), 'fastai-installer-');
        try {
            file_put_contents($temp, $fixture);
            $installers->chunk($stored['id'], 0, new Illuminate\Http\UploadedFile($temp, 'fixture', null, null, true));
            $ready = $installers->complete($stored['id']);
            $published = array_replace($release, [
                'platform'=>$platform,'architecture'=>'universal','latestBuild'=>5100,
                'downloadUrl'=>$ready['downloadUrl'],'sha256'=>$ready['sha256'],
            ]);
            $installers->validateRelease($published);
            config(['fastai.fastai_releases'=>[$published]]);
            $assert($ready['sha256']===hash('sha256',$fixture), 'One upload has one verified digest');
            $download = $service->publicDownloads(includeInstallHints: true)[0];
            $assert(($download['installerFormat'] ?? null) === ($platform === 'linux' ? 'run' : null), 'Only a verified hosted Linux .run gets installation instructions');
            $assert(!array_key_exists('installerFormat', $service->publicDownloads()[0]), 'Native catalog entries remain free of website-only hints');
            if ($platform === 'linux') {
                $assert(!$installers->isHostedLinuxRun(array_replace($published, ['sha256'=>str_repeat('f',64)])), 'A mismatched upload hash cannot enable shell instructions');
            }
            foreach ($abisByPlatform[$platform] as $abi) {
                $assert($service->release($platform,$abi)['downloadUrl']===$ready['downloadUrl'], 'Each supported ABI resolves to the same stored installer');
            }
            $assert($installers->serve($ready['id'])->getFile()->getContent()===$fixture, 'Published universal installer serves the uploaded bytes');
        } finally {
            if (is_file($temp)) unlink($temp);
            Illuminate\Support\Facades\File::deleteDirectory(storage_path('app/fastai-installers/'.$stored['id']));
        }
    }
    config(['fastai.fastai_releases'=>[$release]]);
    $user = App\Models\User::create(['email'=>bin2hex(random_bytes(8)).'@example.com', 'password'=>password_hash(bin2hex(random_bytes(16)),PASSWORD_DEFAULT),
        'uuid'=>App\Utils\Helper::guid(true), 'token'=>App\Utils\Helper::guid()]);
    $auth = new App\Services\AuthService($user);
    $token = $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $assert($call('me/login-links', ['redirect'=>'dashboard'], null, 'POST')->getStatusCode()===401, 'Login link requires session');
    $response = $call('me/login-links', ['redirect'=>'dashboard'], $token, 'POST');
    $assert($response->getStatusCode()===200, 'Login link creation');
    $url = json_decode($response->getContent(),true)['data'];
    $assert(!str_contains($url,$token) && !parse_url($url,PHP_URL_QUERY), 'No long-lived credentials in URL');
    parse_str(explode('?',parse_url($url,PHP_URL_FRAGMENT),2)[1], $query);
    $code = $query['verify'];
    $assert(strlen($code)===64 && $query['redirect']==='dashboard', 'Cryptographically random one-time code');
    $response = $call('auth/session-exchanges',['verificationToken'=>$code],null,'POST');
    $assert($response->getStatusCode()===200 && json_decode($response->getContent(),true)['data']['tokenType']==='Bearer', 'Browser exchange creates independent session');
    $assert($call('auth/session-exchanges',['verificationToken'=>$code],null,'POST')->getStatusCode()===409, 'Code cannot be replayed');
    $assert(App\Services\AuthService::decryptAuthData($token)!==false, 'Web login preserves app session');
    $response = $call('me/login-links',['redirect'=>'dashboard'],$token,'POST');
    parse_str(explode('?',parse_url(json_decode($response->getContent(),true)['data'],PHP_URL_FRAGMENT),2)[1], $query);
    $user->update(['banned'=>1]);
    $assert($call('auth/session-exchanges',['verificationToken'=>$query['verify']],null,'POST')->getStatusCode()===403, 'Ban checked at redemption');
    echo "FastAI releases and login: {$checks} checks passed\n";
} finally {
    if ($auth) $auth->removeAllSession();
    config(['fastai'=>$original]);
    Illuminate\Support\Facades\DB::rollBack();
}
