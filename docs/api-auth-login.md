# `/api/v1/passport/auth/login` 接口文档

## 概述
账号密码登录接口，返回会话凭据（`auth_data`）以及用户 `token`。

- 方法：`POST`
- 路径：`/api/v1/passport/auth/login`
- Content-Type：`application/json`

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| email | string | 是 | 用户邮箱，必须为合法邮箱格式 |
| password | string | 是 | 登录密码，长度至少 8 |

请求示例：

```json
{
  "email": "user@example.com",
  "password": "12345678"
}
```

## 响应格式

### 成功响应

- HTTP 状态码：`200`

```json
{
  "data": {
    "token": "user-token",
    "is_admin": 0,
    "auth_data": "jwt-auth-data"
  }
}
```

### 失败响应

所有失败响应都包含 `code` 与 `message` 字段。

```json
{
  "code": "AUTH_LOGIN_INVALID_CREDENTIALS",
  "message": "邮箱或密码错误"
}
```

部分校验失败会同时返回 `errors`：

```json
{
  "code": "AUTH_LOGIN_EMAIL_REQUIRED",
  "message": "邮箱不能为空",
  "errors": {
    "email": [
      "邮箱不能为空"
    ]
  }
}
```

## 错误码

| HTTP 状态码 | code | 说明 |
|---|---|---|
| 422 | AUTH_LOGIN_EMAIL_REQUIRED | 邮箱不能为空 |
| 422 | AUTH_LOGIN_EMAIL_FORMAT_INVALID | 邮箱格式不正确 |
| 422 | AUTH_LOGIN_PASSWORD_REQUIRED | 密码不能为空 |
| 422 | AUTH_LOGIN_PASSWORD_TOO_SHORT | 密码必须大于 8 个字符 |
| 422 | AUTH_LOGIN_VALIDATION_FAILED | 其他参数校验失败 |
| 500 | AUTH_LOGIN_INVALID_CREDENTIALS | 邮箱或密码错误（账号不存在与密码错误统一） |
| 500 | AUTH_LOGIN_PASSWORD_RETRY_LIMITED | 密码错误次数过多，需等待后重试 |
| 500 | AUTH_LOGIN_ACCOUNT_SUSPENDED | 账号已被暂停使用 |

## 备注

- 文案会随服务端语言环境变化，前端请以 `code` 为准做多语言映射。
- `AUTH_LOGIN_INVALID_CREDENTIALS` 故意不区分“账号不存在”与“密码错误”，用于降低账户枚举风险。
