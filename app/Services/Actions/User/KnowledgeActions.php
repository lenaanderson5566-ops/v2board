<?php

namespace App\Services\Actions\User;


use App\Models\Knowledge;
use App\Models\User;
use App\Services\UserService;
use App\Support\KnowledgeAccess;
use App\Utils\Helper;
use Illuminate\Http\Request;

class KnowledgeActions
{
    public function fetch(Request $request)
    {
        if ($request->input('id')) {
            $knowledge = Knowledge::where('id', $request->input('id'))
                ->where('show', 1)
                ->first();
            if ($knowledge) $knowledge = $knowledge->toArray();
            if (!$knowledge) abort(request()->is('api/v10/*') ? 409 : 500, __('Article does not exist'));
            $user = User::find($request->user['id']);
            $userService = new UserService();
            if (!$userService->isAvailable($user)) {
                $placeholder = '<div class="fastai-no-access">'.__('You must have a valid subscription to view content in this area').'</div>';
                $knowledge['body'] = KnowledgeAccess::publicBody($knowledge['body'], $placeholder) ?? $placeholder;
            }
            $subscribeUrl = Helper::getSubscribeUrl($user['token']);
            $knowledge['body'] = str_replace('{{siteName}}', \App\Support\Branding::name(config('fastai.app_name', config('app.name', 'FastAI'))), $knowledge['body']);
            $knowledge['body'] = str_replace('{{subscribeUrl}}', $subscribeUrl, $knowledge['body']);
            $knowledge['body'] = str_replace('{{urlEncodeSubscribeUrl}}', urlencode($subscribeUrl), $knowledge['body']);
            $knowledge['body'] = str_replace(
                '{{safeBase64SubscribeUrl}}',
                str_replace(
                    array('+', '/', '='),
                    array('-', '_', ''),
                    base64_encode($subscribeUrl)
                ),
                $knowledge['body']
            );
            $knowledge['body'] = str_replace('{{subscribeToken}}', $user['token'], $knowledge['body']);
            return response([
                'data' => $knowledge
            ]);
        }
        $builder = Knowledge::select(['id', 'category', 'title', 'updated_at'])
            ->where('language', $request->input('language'))
            ->where('show', 1)
            ->orderBy('sort', 'ASC');
        $keyword = $request->input('keyword');
        if ($keyword) {
            $builder = $builder->where(function ($query) use ($keyword) {
                $query->where('title', 'LIKE', "%{$keyword}%")
                    ->orWhere('body', 'LIKE', "%{$keyword}%");
            });
        }

        $knowledges = $builder->get()
            ->groupBy('category');
        return response([
            'data' => $knowledges
        ]);
    }

    public function getCategory(Request $request)
    {
        return response(['data' => Knowledge::where('show', 1)
            ->where('language', $request->input('language', app()->getLocale()))
            ->orderBy('category')->distinct()->pluck('category')]);
    }

}
