# `/api/v1/user/update` 接口文档

## 概述
更新当前登录用户偏好设置（自动续费提醒、到期提醒、流量提醒、语言等）。

- 方法：`POST`
- 路径：`/api/v1/user/update`
- 鉴权：需要登录（`authorization` 请求头或 `auth_data` 参数）
- Content-Type：`application/json`

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| auto_renewal | int | 否 | 自动续费开关，`0` 或 `1` |
| remind_expire | int | 否 | 到期提醒开关，`0` 或 `1` |
| remind_traffic | int | 否 | 流量提醒开关，`0` 或 `1` |
| language | string | 否 | 语言标识；最大长度 16，且必须是系统支持语言 |

请求示例：

```json
{
  "language": "en-US",
  "remind_expire": 1,
  "remind_traffic": 1
}
```

## `language` 字段规则

`language` 校验规则：
- 可为空（`nullable`）
- 字符串（`string`）
- 最大长度 16（`max:16`）
- 必须可被 `LocaleService::resolveToSupported()` 解析为支持的语言，否则返回 `Unsupported language`

支持语言来源：
- 主题 i18n 文件
- `config('app.locale')`
- `config('app.fallback_locale')`

## 成功响应

- HTTP 状态码：`200`

```json
{
  "data": true
}
```

## 失败响应（当前实现）

> 该接口尚未改造成 `code + message` 风格，仍沿用历史返回方式。

### 鉴权失败
- HTTP 状态码：`403`
- 典型返回：`未登录或登陆已过期`

### 参数校验失败
- HTTP 状态码：`422`
- 典型返回（Laravel 验证错误结构）：

```json
{
  "message": "The given data was invalid.",
  "errors": {
    "language": [
      "Unsupported language"
    ]
  }
}
```

### 业务失败
- HTTP 状态码：`500`
- 典型 message：
  - `The user does not exist`
  - `Unsupported language`
  - `Save failed`

## 备注

- 如需与登录/注册接口保持一致，建议后续将本接口也改为统一 `code` 返回。
