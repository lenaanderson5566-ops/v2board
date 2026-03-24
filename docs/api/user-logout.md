# 用户登出接口文档

本文档描述新增的用户登出接口：

- `POST /api/v1/user/logout`：退出当前登录会话
- `POST /api/v1/user/logoutAll`：退出当前账号的全部会话

> 两个接口均在 `user` 中间件下，需要携带有效登录态。

---

## 1. 退出当前会话

### 接口信息

- **URL**: `/api/v1/user/logout`
- **Method**: `POST`
- **Auth**: 必须（`Authorization` 请求头或 `auth_data` 参数）
- **Content-Type**: `application/json`

### 请求参数

无必填业务参数。

可选传参：

| 参数名 | 位置 | 类型 | 说明 |
|---|---|---|---|
| `auth_data` | Body/Form | string | 可选。若不传，则读取 `Authorization` 请求头 |

### 请求示例

```bash
curl -X POST 'https://example.com/api/v1/user/logout' \
  -H 'Authorization: <auth_data_jwt>' \
  -H 'Content-Type: application/json'
```

### 响应示例

```json
{
  "data": true
}
```

### 响应说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `data` | boolean | `true` 表示成功移除当前 JWT 对应 session 并清理当前 JWT 缓存；`false` 表示未完成注销（如 token 无效） |

### 行为说明

1. 服务端解析当前 JWT，获取 `id` 与 `session`。
2. 校验 JWT 中用户 ID 与当前登录用户一致。
3. 删除当前 session。
4. 清理当前 JWT 的缓存键，确保当前 token 立即失效。

---

## 2. 退出全部会话

### 接口信息

- **URL**: `/api/v1/user/logoutAll`
- **Method**: `POST`
- **Auth**: 必须（`Authorization` 请求头或 `auth_data` 参数）
- **Content-Type**: `application/json`

### 请求参数

无。

### 请求示例

```bash
curl -X POST 'https://example.com/api/v1/user/logoutAll' \
  -H 'Authorization: <auth_data_jwt>' \
  -H 'Content-Type: application/json'
```

### 响应示例

```json
{
  "data": true
}
```

### 响应说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `data` | boolean | `true` 表示已清除该用户全部 session；`false` 表示清除失败 |

### 行为说明

1. 获取当前用户的全部 session 列表。
2. 逐个清理 session 内保存的 `auth_data` 缓存。
3. 删除该用户会话集合缓存键。

---

## 错误码（与现有风格保持一致）

接口异常时会返回 HTTP 500 + 错误消息，常见场景：

- 用户不存在
- 未登录或登录过期
- token 无效或不属于当前用户
