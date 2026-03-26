# 用户近期登录日志接口文档

本文档描述新增的用户日志接口：

- `GET /api/v1/user/log/login/recent`：返回当前登录用户最近 5 次“成功登录”时间与 IP

> 接口在 `user` 中间件下，需要携带有效登录态。

---

## 1. 最近 5 次成功登录日志

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
| `data` | array | 最近 5 次成功登录记录（按时间倒序） |
| `data[].login_at` | integer\|null | 登录时间戳（Unix 秒） |
| `data[].ip` | string\|null | 登录 IP |

---

## 说明

- 登录日志来自 `v2_login_log`，通过当前用户 `user_id` + `is_success=1` 过滤，并限制最多 5 条。
- 返回数据只包含时间与 IP 字段，便于前端用户中心直接渲染。
