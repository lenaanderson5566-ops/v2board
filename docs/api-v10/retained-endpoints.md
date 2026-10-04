# 后台之外的保留接口

此清单由实际注册路由生成：`php tests/api-route-audit.php --write-inventory`。不包含 V10 新接口、管理/风控/客服后台接口。GET 路由同时支持 HEAD，表中省略 HEAD。仅表中入口继续保留；其余旧用户业务与公共内容 API 已移除。认证入口供现有后台使用。

## 后台依赖的认证接口（4 条路由）

| 方法 | 保留路径 | V10 对应入口 |
|---|---|---|
| POST | `/api/v1/passport/auth/register` | POST /api/v10/auth/registrations |
| POST | `/api/v1/passport/auth/login` | POST /api/v10/auth/sessions |
| POST | `/api/v1/passport/auth/forget` | POST /api/v10/auth/password-resets |
| POST | `/api/v1/passport/comm/sendEmailVerify` | POST /api/v10/auth/email-verifications |

## 后台依赖的账户接口（3 条路由）

| 方法 | 保留路径 | V10 对应入口 |
|---|---|---|
| GET | `/api/v1/user/info` | GET /api/v10/me |
| POST | `/api/v1/user/update` | PATCH /api/v10/me |
| POST | `/api/v1/user/logout` | DELETE /api/v10/me/session |

## 旧公共接口与回调（2 条路由）

| 方法 | 保留路径 | V10 对应入口 |
|---|---|---|
| POST | `/api/v1/guest/telegram/webhook` | POST /api/v10/webhooks/telegram |
| GET/POST | `/api/v1/guest/payment/notify/{method}/{uuid}` | GET/POST /api/v10/webhooks/payments/{provider}/{endpointId} |

## 旧订阅与客户端接口（2 条路由）

| 方法 | 保留路径 | V10 对应入口 |
|---|---|---|
| GET | `/api/v1/client/app/getConfig` | GET /api/v10/subscriptions/{subscriptionToken}/application-config |
| GET | `/api/v1/client/app/getVersion` | GET /api/v10/subscriptions/{subscriptionToken}/application-version |

## 节点通信（继续使用，不迁移）

V1 实际注册通配路由 `/api/v1/server/{class}/{action}`，支持 GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS。下表列出当前控制器自身声明的业务方法，不代表新增静态路由，也不包括构造函数或框架继承方法。认证仍由各节点控制器校验节点凭证。

| 控制器段 | 业务 action |
|---|---|
| `deepbwork` | `user`, `submit`, `config` |
| `shadowsocksTidalab` | `user`, `submit` |
| `trojanTidalab` | `user`, `submit`, `config` |
| `uniProxy` | `user`, `push`, `alivelist`, `alive`, `config` |

V2 保留 `/api/v2/server/config`（同样接受以上方法），使用节点 token 和 node_id；当前没有 V2 用户接口。

## 其他保留入口

| 方法 | 路径 | 用途与条件 |
|---|---|---|
| GET/HEAD | 管理员配置的 `subscribe_path` | 自定义订阅路径，使用原 token 规则；与 V10 同时可用；旧默认路径已移除 |
| GET/HEAD | `/api/v10/public/client-installers/{installerId}/content` | 镜像下载新版入口；原 `/client-mirrors/{id}` 已移除 |

`/` 与 `/app` 是网页入口而非 API，也继续保留。后台安全路径、运营路径和客服 `/api/v1/staff/*` 不在本清单范围内。

## 兼容说明

- 上表旧用户/登录/公共/客户端路由共 11 条；前端用户业务已通过集中传输层使用 V10，仅保留后台依赖、历史回调及订阅入口。
- 旧用户业务 API（包括 `invite/save`）已移除；使用 V10。
- 支付与 Telegram 的旧回调继续验证原签名并返回供应商要求的响应；新生成地址使用 V10。
- 不再注册旧用户业务中的 GET 写操作。
- 原节点动态分发属于明确保留的历史协议，未将这种设计带入 V10。
