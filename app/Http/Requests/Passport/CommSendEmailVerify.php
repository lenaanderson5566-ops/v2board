<?php

namespace App\Http\Requests\Passport;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Http\Exceptions\HttpResponseException;

class CommSendEmailVerify extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'email' => 'required|email:strict'
        ];
    }

    public function messages()
    {
        return [
            'email.required' => __('Email can not be empty'),
            'email.email' => __('Email format is incorrect')
        ];
    }

    protected function failedValidation(Validator $validator)
    {
        $errors = $validator->errors();
        $field = array_key_first($errors->toArray()) ?? 'request';
        $failed = $validator->failed();
        $rule = strtolower((string)array_key_first($failed[$field] ?? []));

        $codeMap = [
            'email.required' => 'AUTH_SEND_VERIFY_EMAIL_REQUIRED',
            'email.email' => 'AUTH_SEND_VERIFY_EMAIL_FORMAT_INVALID'
        ];

        $lookupKey = "{$field}.{$rule}";
        $code = $codeMap[$lookupKey] ?? 'AUTH_SEND_VERIFY_VALIDATION_FAILED';

        throw new HttpResponseException(response()->json([
            'code' => $code,
            'message' => $errors->first(),
            'errors' => $errors->messages()
        ], 422));
    }
}
