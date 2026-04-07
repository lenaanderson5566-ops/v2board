# `/api/v1/passport/auth/forget` 接口文档

## 概述
重置登录密码接口。校验邮箱验证码后，重置用户密码并使已有会话失效。

- 方法：`POST`
- 路径：`/api/v1/passport/auth/forget`
- Content-Type：`application/json`

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| email | string | 是 | 用户邮箱 |
| password | string | 是 | 新密码，最少 8 位 |
| email_code | string | 是 | 邮箱验证码 |

请求示例：

```json
{
  "email": "user@example.com",
  "password": "new-password-123",
  "email_code": "123456"
}
```

## 成功响应

- HTTP 状态码：`200`

```json
{
  "code": "OK",
  "data": true
}
```

## 失败响应

失败时统一返回：

```json
{
  "code": "AUTH_FORGET_EMAIL_CODE_INVALID",
  "message": "邮箱验证码有误"
}
```

参数校验失败（`422`）会携带 `errors`：

```json
{
  "code": "AUTH_FORGET_PASSWORD_TOO_SHORT",
  "message": "密码必须大于 8 个字符",
  "errors": {
    "password": [
      "密码必须大于 8 个字符"
    ]
  }
}
```

## 错误码

| HTTP 状态码 | code | 说明 |
|---|---|---|
| 422 | AUTH_FORGET_EMAIL_REQUIRED | 邮箱不能为空 |
| 422 | AUTH_FORGET_EMAIL_FORMAT_INVALID | 邮箱格式不正确 |
| 422 | AUTH_FORGET_PASSWORD_REQUIRED | 新密码不能为空 |
| 422 | AUTH_FORGET_PASSWORD_TOO_SHORT | 新密码长度不足 |
| 422 | AUTH_FORGET_EMAIL_CODE_REQUIRED | 邮箱验证码不能为空 |
| 422 | AUTH_FORGET_VALIDATION_FAILED | 其他参数校验失败 |
| 500 | AUTH_FORGET_REQUEST_RATE_LIMITED | 重置请求过于频繁，请稍后再试 |
| 500 | AUTH_FORGET_EMAIL_CODE_INVALID | 邮箱验证码错误 |
| 500 | AUTH_FORGET_EMAIL_NOT_REGISTERED | 邮箱未注册 |
| 500 | AUTH_FORGET_RESET_FAILED | 密码重置失败 |

## 备注

- 前端应优先使用 `code` 做多语言映射，`message` 作为兜底展示。
- 成功后服务端会清除该用户历史会话（强制重新登录）。
