<?php

namespace App\Http\Requests\User;

use App\Services\LocaleService;
use Illuminate\Foundation\Http\FormRequest;

class UserUpdate extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'auto_renewal' => 'in:0,1',
            'remind_expire' => 'in:0,1',
            'remind_traffic' => 'in:0,1',
            'language' => [
                'nullable',
                'string',
                'max:16',
                function ($attribute, $value, $fail) {
                    $localeService = new LocaleService();
                    if (!$localeService->resolveToSupported($value)) {
                        $fail(__('Unsupported language'));
                    }
                }
            ]
        ];
    }

    public function messages()
    {
        return [
            'show.in' => __('Incorrect format of expiration reminder'),
            'renew.in' => __('Incorrect traffic alert format')
        ];
    }
}
