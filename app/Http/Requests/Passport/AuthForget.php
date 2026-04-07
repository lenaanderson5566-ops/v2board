<?php

namespace App\Http\Requests\Passport;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Http\Exceptions\HttpResponseException;

class AuthForget extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'email' => 'required|email:strict',
            'password' => 'required|min:8',
            'email_code' => 'required'
        ];
    }

    public function messages()
    {
        return [
            'email.required' => __('Email can not be empty'),
            'email.email' => __('Email format is incorrect'),
            'password.required' => __('Password can not be empty'),
            'password.min' => __('Password must be greater than 8 digits'),
            'email_code.required' => __('Email verification code cannot be empty')
        ];
    }

    protected function failedValidation(Validator $validator)
    {
        $errors = $validator->errors();
        $field = array_key_first($errors->toArray()) ?? 'request';
        $failed = $validator->failed();
        $rule = strtolower((string)array_key_first($failed[$field] ?? []));

        $codeMap = [
            'email.required' => 'AUTH_FORGET_EMAIL_REQUIRED',
            'email.email' => 'AUTH_FORGET_EMAIL_FORMAT_INVALID',
            'password.required' => 'AUTH_FORGET_PASSWORD_REQUIRED',
            'password.min' => 'AUTH_FORGET_PASSWORD_TOO_SHORT',
            'email_code.required' => 'AUTH_FORGET_EMAIL_CODE_REQUIRED'
        ];

        $lookupKey = "{$field}.{$rule}";
        $code = $codeMap[$lookupKey] ?? 'AUTH_FORGET_VALIDATION_FAILED';

        throw new HttpResponseException(response()->json([
            'code' => $code,
            'message' => $errors->first(),
            'errors' => $errors->messages()
        ], 422));
    }
}
