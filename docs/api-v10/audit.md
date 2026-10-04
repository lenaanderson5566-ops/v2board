# 接口检查记录

检查日期：2026-10-04。本地测试环境；未部署，未调用真实支付、邮件或节点服务器。

## 范围与结果

- 初次枚举 332 条已注册路由；经用户授权清理 6 条失效后台路由后，当前为 326 条。核对显式控制器和公共方法存在性，检查用户、管理、风控、客服路由的鉴权中间件。
- 53 个 V10 用户接口逐个经 HTTP Kernel 验证未登录返回 401。此项不等于对每个接口的所有业务分支完成穷举。
- V10 契约测试 98 项；V10 路由/OpenAPI/旧功能映射检查 334 项。
- 前端全部 47 个测试文件、310 项测试通过。用户请求由集中 API 层转换为 V10；旧 API 网络请求入口仍用于后台。组件中的旧符号名称不等于实际请求旧 URL。
- 登录、注册、邀请、账户状态、订单替换、支付回调、额度、重置、公告、Banner、Apple 账号、翻译、语言、客户端配置、镜像下载、风控的现有测试执行结果见运行输出。
- 节点动态路由核对注册、控制器方法及凭证检查代码，未向真实节点发送配置或流量请求。

## 本轮修复

1. 管理员设置自定义订阅路径后，旧默认订阅路由曾不再注册。现在 `/api/v1/client/subscribe` 始终保留，自定义路径额外注册；两者与 V10 并行。测试覆盖空路径、旧默认路径、自定义路径三种配置。
2. 账户没有套餐流量额度时曾被标记为“额度已耗尽”。增加正额度判断，已有账户状态测试 21 项通过；不改变订阅或额度访问授权。

## 已清理的历史后台路由

全路由审计发现以下 6 条路由对应的方法不存在（5 个不同方法）。已对照 HEAD 确认是重构前即存在的问题。经用户明确授权，核对当前后台调用和替代功能后删除这些无效注册。没有删除用户旧 API、节点入口或现有后台功能。

`{adminPath}` 代表配置的后台 API 前缀，不在文档中写入部署值。

| 方法 | 路径 | 缺失方法 |
|---|---|---|
| POST | `/api/v1/{adminPath}/user/setInviteUser` | `Admin\UserController::setInviteUser` |
| GET | `/api/v1/{adminPath}/stat/getStat` | `Admin\StatController::getStat` |
| GET | `/api/v1/{adminPath}/stat/getRanking` | `Admin\StatController::getRanking` |
| GET | `/api/v1/{adminPath}/stat/getStatRecord` | `Admin\StatController::getStatRecord` |
| POST | `/api/v1/{adminPath}/notice/update` | `Admin\NoticeController::update` |
| POST | `/api/v1/staff/notice/update` | `Admin\NoticeController::update` |

现有功能与入口：

- 设置邀请人：用户管理 → 编辑 → 邀请人邮箱；通过 `user/update` 保存，留空解除关联。
- 公告编辑：公告管理 → 编辑；通过 `notice/save` 携带 `id` 更新。客服的 `notice/save` 也保留。
- 概览统计：仪表盘调用 `stat/getOverride`。
- 统计趋势：仪表盘调用 `stat/getOrder`，展示注册、收款和佣金数据。
- 排行：仪表盘使用 `getServerTodayRank`、`getServerLastRank`、`getUserTodayRank`、`getUserLastRank`。未为失效的通用路由另外创建重复入口。

前端审计脚本的邀请人设置项已改为检查实际 `user/update`。全路由审计继续将任何缺失方法视为失败，清理后不再存在这六条发现项。无需重建前端产物，因为本次未修改运行时界面代码。

清理后复测：全路由审计 647 项通过（326 条路由、53 个 V10 未登录校验），后台冒烟测试 185 项通过，覆盖邀请人修改/解除、公告新建/编辑、仪表盘趋势和排行。后台测试中的周期订阅样例补上已有流量额度，以符合当前“零额度用户不通过强制更新获得订阅额度”的规则，业务逻辑未修改。

## 保留范围和上线验证

[非后台保留接口逐项清单](retained-endpoints.md) 包含方法、路径、对应新版入口，以及节点和下载协议说明。旧邀请码生成入口仍返回既有 410；“保留”不表示重新启用。

付款与 SMTP 使用模拟服务测试；上线仍需确认支付商能访问新回调路径、真实签名通过、Horizon 正常开通订单，以及真实客户端成功刷新配置。自定义域名、反向代理、WAF 与生产凭证无法由本地测试证明。
