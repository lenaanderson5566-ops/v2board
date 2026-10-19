<?php

namespace App\Services\Actions\User;


use App\Models\User;
use App\Services\ServerService;
use App\Services\UserService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class ServerActions
{
    public function previews(Request $request)
    {
        $nodes = [];
        foreach (['v2node' => \App\Models\ServerV2node::class, 'v2box' => \App\Models\ServerV2box::class] as $type => $model) {
            // Older V2Box tables may lack optional display metadata. Keep the explicit projection safe.
            $columns=array_values(array_intersect(['id','name','region_code','city_code','display_label','tags','sort'],\Illuminate\Support\Facades\Schema::getColumnListing((new $model)->getTable())));
            foreach ($model::where('show', 1)->orderBy('sort')->orderBy('id')->get($columns) as $node) {
                $nodes[] = \App\Services\NodeDisplayService::enrich([...$node->toArray(), 'type' => $type]);
            }
        }
        usort($nodes, fn ($a, $b) => ($a['sort'] ?? 0) <=> ($b['sort'] ?? 0));
        return response()->json(['data' => $nodes])->header('Cache-Control', 'private, no-store');
    }

    public function fetch(Request $request)
    {
        $user = User::find($request->user['id']);
        $servers = [];
        $userService = new UserService();
        if ($userService->isAvailable($user)) {
            $serverService = new ServerService();
            $servers = array_map(fn ($server) => \App\Services\NodeDisplayService::enrich($server), $serverService->getAvailableServers($user));
        }
        $eTag = sha1(json_encode(array_column($servers, 'cache_key')));
        if (strpos($request->header('If-None-Match'), $eTag) !== false ) {
            if ($request->is('api/v10/*')) return response('',304)->header('ETag', '"'.$eTag.'"');
            abort(304);
        }

        return response([
            'data' => $servers
        ])->header('ETag', "\"{$eTag}\"");
    }
}
