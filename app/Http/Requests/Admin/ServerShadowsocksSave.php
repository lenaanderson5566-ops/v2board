<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class ServerShadowsocksSave extends FormRequest
{
    protected function prepareForValidation()
    {
        $this->merge(\App\Services\NodeDisplayService::normalizeInput($this->all()));
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'show' => '',
            'name' => 'required',
            'group_id' => 'required|array',
            'parent_id' => 'nullable|integer',
            'route_id' => 'nullable|array',
            'host' => 'required',
            'port' => 'required',
            'server_port' => 'required',
            'cipher' => 'required|in:aes-128-gcm,aes-192-gcm,aes-256-gcm,chacha20-ietf-poly1305,2022-blake3-aes-128-gcm,2022-blake3-aes-256-gcm',
            'obfs' => 'nullable|in:http',
            'obfs_settings' => 'nullable|array',
            'tags' => 'nullable|array',
            'region_code' => 'nullable|string|size:2|in:' . implode(',', \App\Services\NodeDisplayService::regionCodes()),
            'city_code' => 'nullable|string|max:64|regex:/^[a-z0-9][a-z0-9-]*$/',
            'display_label' => 'nullable|string|max:64',
            'rate' => 'required|numeric'
        ];
    }

    public function messages()
    {
        return \App\Services\NodeDisplayService::validationMessages() + [
            'name.required' => '节点名称不能为空',
            'group_id.required' => '权限组不能为空',
            'group_id.array' => '权限组格式不正确',
            'route_id.array' => '路由组格式不正确',
            'parent_id.integer' => '父节点格式不正确',
            'host.required' => '节点地址不能为空',
            'port.required' => '连接端口不能为空',
            'server_port.required' => '后端服务端口不能为空',
            'cipher.required' => '加密方式不能为空',
            'tags.array' => '标签格式不正确',
            'rate.required' => '倍率不能为空',
            'rate.numeric' => '倍率格式不正确',
            'obfs.in' => '混淆格式不正确',
            'obfs_settings.array' => '混淆设置格式不正确'
        ];
    }
}
