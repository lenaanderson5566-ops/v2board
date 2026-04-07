# `/api/v1/passport/comm/sendEmailVerify` 接口文档

## 概述
发送邮箱验证码接口。用于注册/找回密码等流程。

- 方法：`POST`
- 路径：`/api/v1/passport/comm/sendEmailVerify`
- Content-Type：`application/json`

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| email | string | 是 | 接收验证码的邮箱 |
| isforget | int | 否 | 场景标记：`0`=注册场景，`1`=找回场景 |
| recaptcha_data | string | 否 | 人机验证数据（当系统启用 recaptcha 时使用） |

请求示例：

```json
{
  "email": "user@example.com",
  "isforget": 1
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
  "code": "AUTH_SEND_VERIFY_TOO_FREQUENT",
  "message": "验证码已发送，请过一会儿再请求"
}
```

参数校验失败（`422`）会携带 `errors`：

```json
{
  "code": "AUTH_SEND_VERIFY_EMAIL_FORMAT_INVALID",
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
| 422 | AUTH_SEND_VERIFY_EMAIL_REQUIRED | 邮箱不能为空 |
| 422 | AUTH_SEND_VERIFY_EMAIL_FORMAT_INVALID | 邮箱格式不正确 |
| 422 | AUTH_SEND_VERIFY_VALIDATION_FAILED | 其他参数校验失败 |
| 429 | AUTH_SEND_VERIFY_TOO_MANY_REQUESTS | IP 请求过于频繁 |
| 500 | AUTH_SEND_VERIFY_RECAPTCHA_INVALID | 人机验证失败 |
| 500 | AUTH_SEND_VERIFY_EMAIL_SUFFIX_NOT_ALLOWED | 邮箱后缀不在白名单 |
| 500 | AUTH_SEND_VERIFY_GMAIL_ALIAS_NOT_SUPPORTED | Gmail alias 不被允许 |
| 500 | AUTH_SEND_VERIFY_EMAIL_ALREADY_REGISTERED | 注册场景下邮箱已注册 |
| 500 | AUTH_SEND_VERIFY_EMAIL_NOT_REGISTERED | 找回场景下邮箱未注册 |
| 500 | AUTH_SEND_VERIFY_TOO_FREQUENT | 邮箱验证码发送过于频繁 |

## 备注

- `isforget` 仅在传入时生效；不同场景下邮箱存在性校验逻辑不同。
- 前端应优先使用 `code` 映射展示文案。
