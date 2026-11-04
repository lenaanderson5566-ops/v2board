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
            'request_key' => 'required|uuid',
            'audience_token' => 'required|string|regex:/\A[a-f0-9]{64}\z/',
            'expected_count' => 'nullable|integer|min:1',
            'purpose' => 'required|in:service,marketing',
            'subject' => 'required|string|max:200',
            'content' => 'required|string|max:100000',
            'source_language' => 'sometimes|in:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR,es-ES,pt-BR,fr-FR,de-DE,id-ID,th-TH',
            'translations' => 'sometimes|array:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR,es-ES,pt-BR,fr-FR,de-DE,id-ID,th-TH',
            'translations.*' => 'array:subject,content',
            'translations.*.subject' => 'required|string|max:200',
            'translations.*.content' => 'required|string|max:100000',
        ];
    }

    public function messages()
    {
        return [
            'subject.required' => '主题不能为空',
            'audience_token.required' => '请先检查收件范围',
            'content.required' => '发送内容不能为空'
        ];
    }
}
