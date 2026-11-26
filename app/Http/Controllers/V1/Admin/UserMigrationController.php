<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Services\Actions\Admin\UserMigration;
use App\Services\AuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;

final class UserMigrationController extends Controller
{
    public function preview(Request $request, UserMigration $migration): JsonResponse
    {
        [$reference, $session] = $this->session($request);
        return response()->json(['data' => $migration->preview($this->contents($request), $reference['userId'], $session)]);
    }

    public function apply(Request $request, UserMigration $migration): JsonResponse
    {
        [$reference, $session] = $this->session($request);
        if (AuthService::authenticatedAt($reference) < time() - 300) {
            return response()->json([
                'code' => 'RECENT_LOGIN_REQUIRED',
                'message' => '请重新登录后台，并在 5 分钟内重新预览和确认导入。',
            ], 409);
        }

        $token = $request->post('preview_token');
        abort_unless(is_string($token) && preg_match('/\A[a-f0-9]{64}\z/', $token), 409, '请先预览迁移文件。');

        return response()->json(['data' => $migration->apply($this->contents($request), $token, $reference['userId'], $session)]);
    }

    private function session(Request $request): array
    {
        $browser = $request->attributes->get('browser.session');
        abort_unless(($browser['scope'] ?? null) === 'admin' && !empty($browser['credential']),
            403, '请通过已登录的后台浏览器会话导入。');

        $reference = AuthService::sessionReference($browser['credential']);
        abort_unless($reference && $reference['userId'] === (int)$request->user['id'], 403, '后台会话已失效。');

        return [$reference, hash('sha256', $browser['id'])];
    }

    private function contents(#[\SensitiveParameter] Request $request): string
    {
        $file = $request->file('file');
        abort_unless($file instanceof UploadedFile && $file->isValid(), 422, '请上传迁移 JSON 文件。');
        $size = $file->getSize();
        abort_unless($size > 0 && $size <= UserMigration::MAX_FILE_BYTES, 422, '请上传非空且不超过 5 MiB 的迁移 JSON 文件。');

        return $file->get();
    }
}
