<?php
namespace App\Http\Controllers\V10;
class UserKnowledgeController extends ResourceController
{
    public function getKnowledgeArticles(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getKnowledgeArticles');
        $result = app(\App\Services\Actions\User\KnowledgeActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getKnowledgeArticles');
    }
    public function getKnowledgeCategories(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getKnowledgeCategories');
        $result = app(\App\Services\Actions\User\KnowledgeActions::class)->getCategory($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getKnowledgeCategories');
    }
    public function getKnowledgeArticlesArticleId(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getKnowledgeArticlesArticleId');
        $result = app(\App\Services\Actions\User\KnowledgeActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getKnowledgeArticlesArticleId');
    }
}
