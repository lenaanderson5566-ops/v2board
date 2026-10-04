<?php
namespace App\Http\Controllers\V1\User;

class KnowledgeController extends \App\Http\Controllers\Controller
{
    public function fetch(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\KnowledgeActions::class)->fetch($request);
    }
    public function getCategory(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\KnowledgeActions::class)->getCategory($request);
    }
}
