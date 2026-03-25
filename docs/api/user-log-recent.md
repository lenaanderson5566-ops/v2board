# 用户近期登录与连接日志接口文档

本文档描述新增的 2 个用户日志接口：

- `GET /api/v1/user/log/login/recent`：返回当前登录用户最近 5 次登录时间与 IP
- `GET /api/v1/user/log/connection/recent-24h`：返回当前登录用户近 24 小时连接时间与 IP

> 两个接口均在 `user` 中间件下，需要携带有效登录态。

---

## 1. 最近 5 次登录日志

### 接口信息

- **URL**: `/api/v1/user/log/login/recent`
- **Method**: `GET`
- **Auth**: 必须（用户登录态）

### 请求参数

无。

### 请求示例

```bash
curl -X GET 'https://example.com/api/v1/user/log/login/recent' \
  -H 'Authorization: <auth_data_jwt>'
```

### 响应示例

```json
{
  "data": [
    {
      "login_at": 1760000000,
      "ip": "198.51.100.10"
    },
    {
      "login_at": 1759999000,
      "ip": "203.0.113.20"
    }
  ]
}
```

### 响应字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `data` | array | 最近 5 次登录记录（按时间倒序） |
| `data[].login_at` | integer\|null | 登录时间戳（Unix 秒） |
| `data[].ip` | string\|null | 登录 IP |

---

## 2. 近 24 小时连接日志

### 接口信息

- **URL**: `/api/v1/user/log/connection/recent-24h`
- **Method**: `GET`
- **Auth**: 必须（用户登录态）

### 请求参数

无。

### 请求示例

```bash
curl -X GET 'https://example.com/api/v1/user/log/connection/recent-24h' \
  -H 'Authorization: <auth_data_jwt>'
```

### 响应示例

```json
{
  "data": [
    {
      "connected_at": 1760000200,
      "ip": "198.51.100.10"
    },
    {
      "connected_at": 1759999800,
      "ip": "198.51.100.10"
    }
  ]
}
```

### 响应字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `data` | array | 近 24 小时连接记录（按时间倒序） |
| `data[].connected_at` | integer | 连接时间戳（Unix 秒） |
| `data[].ip` | string\|null | 连接 IP |

---

## 说明

- 登录日志来自 `v2_login_log`，通过当前用户 `user_id` 过滤，并限制最多 5 条。
- 连接日志来自 `v2_user_connection_log`，通过当前用户 `user_id` + `connected_at >= now - 86400` 过滤。
- 返回数据只包含时间与 IP 字段，便于前端用户中心直接渲染。
