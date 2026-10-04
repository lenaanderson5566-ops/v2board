<?php
namespace App\Services\Actions\Public;

class MirrorActions
{
    public function download($id)
    {
        return app(\App\Services\ClientMirrorService::class)->serve($id);
    }
}
