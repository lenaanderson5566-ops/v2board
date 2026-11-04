<?php

namespace App\Http\Requests\Admin;

use App\Support\KnowledgeAccess;
use Illuminate\Foundation\Http\FormRequest;

class KnowledgeSave extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'id' => 'nullable|integer|min:1',
            'category' => 'required',
            'language' => 'required',
            'title' => 'required',
            'body' => ['bail', 'required', 'string', function ($attribute, $value, $fail) {
                if (KnowledgeAccess::publicBody($value) === null) {
                    $fail('内容中的订阅可见区域标记必须成对。');
                }
            }],
            'sort' => 'nullable|integer|min:0'
        ];
    }

    public function messages()
    {
        return [
            'title.required' => '标题不能为空',
            'category.required' => '分类不能为空',
            'body.required' => '内容不能为空',
            'language.required' => '语言不能为空'
        ];
    }
}
