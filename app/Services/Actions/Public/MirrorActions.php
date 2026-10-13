<?php
namespace App\Services\Actions\Public;

class MirrorActions
{
    public function download($id)
    {
        if (str_starts_with($id, 'fastai-')) return app(\App\Services\FastaiInstallerService::class)->serve($id);
        return app(\App\Services\ClientMirrorService::class)->serve($id);
    }
}
