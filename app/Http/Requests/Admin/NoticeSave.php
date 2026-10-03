<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class NoticeSave extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'title' => 'required|string|max:200',
            'content' => 'required|string|max:100000',
            'img_url' => 'nullable|url',
            'tags' => 'nullable|array',
            'source_language' => 'sometimes|in:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR',
            'translations' => 'sometimes|array:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR',
            'translations.*' => 'array:subject,content',
            'translations.*.subject' => 'required|string|max:200',
            'translations.*.content' => 'required|string|max:100000'
        ];
    }

    public function messages()
    {
        return [
            'title.required' => '标题不能为空',
            'content.required' => '内容不能为空',
            'img_url.url' => '图片URL格式不正确',
            'tags.array' => '标签格式不正确'
        ];
    }
}
