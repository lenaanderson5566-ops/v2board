<?php
namespace App\Http\Controllers\V10;
class PublicMirrorController extends ResourceController
{
    public function getPublicClientInstallersInstallerIdContent(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getPublicClientInstallersInstallerIdContent');
        $result = app(\App\Services\Actions\Public\MirrorActions::class)->download($request->route('installerId'));
        return $this->respond($request, $result, 'getPublicClientInstallersInstallerIdContent');
    }
}
