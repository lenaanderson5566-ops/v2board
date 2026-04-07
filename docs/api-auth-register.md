# `/api/v1/passport/auth/register` 接口文档

## 概述
注册接口，创建用户后返回登录凭据。

- 方法：`POST`
- 路径：`/api/v1/passport/auth/register`
- Content-Type：`application/json`

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| email | string | 是 | 用户邮箱 |
| password | string | 是 | 登录密码，最少 8 位 |
| invite_code | string | 否 | 邀请码（当系统开启邀请码强制时为必填） |
| email_code | string | 否 | 邮箱验证码（当系统开启邮箱验证时为必填） |
| recaptcha_data | string | 否 | 人机验证数据（当系统开启 recaptcha 时为必填） |

## 成功响应

- HTTP 状态码：`200`

```json
{
  "code": "OK",
  "data": {
    "token": "user-token",
    "is_admin": 0,
    "auth_data": "jwt-auth-data"
  }
}
```

## 失败响应

失败时统一返回：

```json
{
  "code": "AUTH_REGISTER_EMAIL_ALREADY_EXISTS",
  "message": "邮箱已在系统中存在"
}
```

参数校验失败（`422`）会携带 `errors`：

```json
{
  "code": "AUTH_REGISTER_EMAIL_FORMAT_INVALID",
  "message": "邮箱格式不正确",
  "errors": {
    "email": [
      "邮箱格式不正确"
    ]
  }
}
```

## 错误码

| HTTP 状态码 | code | 说明 |
|---|---|---|
| 422 | AUTH_REGISTER_EMAIL_REQUIRED | 邮箱不能为空 |
| 422 | AUTH_REGISTER_EMAIL_FORMAT_INVALID | 邮箱格式不正确 |
| 422 | AUTH_REGISTER_PASSWORD_REQUIRED | 密码不能为空 |
| 422 | AUTH_REGISTER_PASSWORD_TOO_SHORT | 密码长度不足 |
| 422 | AUTH_REGISTER_VALIDATION_FAILED | 其他参数校验失败 |
| 500 | AUTH_REGISTER_IP_RATE_LIMITED | 同 IP 注册频繁 |
| 500 | AUTH_REGISTER_RECAPTCHA_INVALID | 人机验证失败 |
| 500 | AUTH_REGISTER_EMAIL_SUFFIX_NOT_ALLOWED | 邮箱后缀不在白名单 |
| 500 | AUTH_REGISTER_GMAIL_ALIAS_NOT_SUPPORTED | Gmail alias 不被允许 |
| 500 | AUTH_REGISTER_CLOSED | 系统已关闭注册 |
| 500 | AUTH_REGISTER_INVITE_CODE_REQUIRED | 需要邀请码 |
| 500 | AUTH_REGISTER_EMAIL_CODE_REQUIRED | 需要邮箱验证码 |
| 500 | AUTH_REGISTER_EMAIL_CODE_INVALID | 邮箱验证码错误 |
| 500 | AUTH_REGISTER_EMAIL_ALREADY_EXISTS | 邮箱已存在 |
| 500 | AUTH_REGISTER_INVITE_CODE_INVALID | 邀请码无效 |
| 500 | AUTH_REGISTER_FAILED | 注册失败 |

## 备注

- 前端应优先使用 `code` 进行国际化映射，`message` 作为兜底展示。
- `message` 的具体语言受服务端 locale 影响。
