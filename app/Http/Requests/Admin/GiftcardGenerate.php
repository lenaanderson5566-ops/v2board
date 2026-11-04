<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class GiftcardGenerate extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        $minimumValue = in_array($this->integer('type'), [1, 2, 3], true) ? 1 : 0;
        $boundedWindow = $this->integer('started_at') > 0 && $this->integer('ended_at') > 0;

        return [
            'id' => 'nullable|integer|min:1',
            'generate_count' => $this->filled('id') ? 'prohibited' : 'nullable|integer|min:1|max:500',
            'name' => 'required|string|max:255',
            'type' => 'required|in:1,2,3,4,5',
            'value' => "required_if:type,1,2,3,5|nullable|integer|min:$minimumValue|max:2147483647",
            'plan_id' => 'exclude_unless:type,5|required|integer|min:1|exists:v2_plan,id',
            'started_at' => 'required|integer|min:0|max:2147483647',
            'ended_at' => 'required|integer|min:0|max:2147483647'.($boundedWindow ? '|gt:started_at' : ''),
            'limit_use' => 'nullable|integer|min:0|max:2147483647',
            'code' => 'nullable|string|max:255'
        ];
    }

    public function messages()
    {
        return [
            'generate_count.integer' => '生成数量必须为数字',
            'generate_count.max' => '生成数量最大为500个',
            'name.required' => '名称不能为空',
            'type.required' => '类型不能为空',
            'type.in' => '类型格式有误',
            'value.required_if' => '数值不能为空',
            'value.integer' => '数值格式有误',
            'value.min' => '金额、延长天数或增加流量必须大于零，套餐天数不能为负数',
            'plan_id.required' => '订阅不能为空',
            'plan_id.exists' => '该套餐不存在，请重新选择',
            'started_at.required' => '开始时间不能为空',
            'started_at.integer' => '开始时间格式有误',
            'ended_at.required' => '结束时间不能为空',
            'ended_at.integer' => '结束时间格式有误',
            'ended_at.gt' => '结束时间必须晚于开始时间',
            'limit_use.integer' => '最大使用次数格式有误'
        ];
    }
}
