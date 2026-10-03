<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class UserSendMail extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'subject' => 'required|string|max:200',
            'content' => 'required|string|max:100000',
            'source_language' => 'sometimes|in:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR',
            'translations' => 'sometimes|array:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR',
            'translations.*' => 'array:subject,content',
            'translations.*.subject' => 'required|string|max:200',
            'translations.*.content' => 'required|string|max:100000',
        ];
    }

    public function messages()
    {
        return [
            'subject.required' => '主题不能为空',
            'content.required' => '发送内容不能为空'
        ];
    }
}
