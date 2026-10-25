<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class PlanSort extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'plan_ids' => 'required|array|max:1000',
            'plan_ids.*' => 'required|integer|min:1|distinct'
        ];
    }

    public function messages()
    {
        return [
            'plan_ids.required' => '订阅计划ID不能为空',
            'plan_ids.array' => '订阅计划ID格式有误'
        ];
    }
}
