# 接口验证与发布检查

用户接口使用 V10；默认订阅及镜像下载使用新版资源路径。后台、风控和节点通信保持现有协议；未完成的 staff 接口已全部退役，不迁移至 V10。旧用户业务接口已退役，保留范围以 [实际路由清单](retained-endpoints.md) 和 [兼容白名单](retained-legacy.json) 为准。

支付新订单及后台回调地址统一使用 V10，旧回调继续接收历史交易通知。自定义订阅路径通过独立兼容控制器调用共享订阅服务，不跳转、不更换用户令牌。

## 退役接口实现引用复核

现存 V1/V2 控制器的 197 个公开处理方法均仍有显式路由引用；保留的后台、风控、登录、回调、订阅配置及节点适配器继续使用。V10 通过共享 Actions 和请求校验类执行业务，不能因旧 URL 退役而删除这些共享实现。映射表中的旧控制器符号用于记录迁移来源，不用于动态加载或转发。

已删除无调用的 `KnowledgeCategorySave`、`KnowledgeCategorySort`、`MailSend` 三个旧请求类，以及未启用的 Laravel 默认 `Authenticate`、`RedirectIfAuthenticated`、`EncryptCookies`、`VerifyCsrfToken` 四个应用中间件。Kernel 移除对应 auth/guest 别名、旧优先级和注释引用，清理控制器中 14 个未使用导入（含不存在的 PaymentSave 引用）。当前认证、Cookie 和 CSRF 仍由实际启用的 User/Admin、BrowserSession 和 V10 流程负责；没有删除这些安全检查。

路由审计增加全局中间件、优先级、别名及每条路由解析结果的可加载性与 handle 方法检查，防止删除文件后留下失效引用。此清理不修改 API 路径、请求/响应合同或数据库结构；安装和已有删列升级回归继续执行。

服务、模型与缓存定义的后续复核删除了无调用的 ServerLog/ServerStat 模型、ServerService 的旧日志写入方法、StatisticalService 的三个旧查询入口及其三个排行辅助方法、UserService 的三个用户批量查询辅助方法，以及 TelegramService 的旧目录扫描命令发现方法，共 11 个方法。现行日流量聚合、排行榜、节点用户授权、Telegram 固定命令菜单仍由已有调用链提供。

CacheKey 删除七种退役节点类型的 21 个定义，以及旧 TEMP_TOKEN、邮件登录链接时间戳两个无调用定义。V2Box 动态拼接缓存键、当前会话与一次性授权码继续有效；不清空缓存、不改会话密钥。邀请记录和现行 Stat/StatUser/StatServer 等模型仍有业务用途。框架的认证、会话、邮件等配置有框架级依赖，不因缺少应用内字面量引用而删除。历史 SQL 与升级迁移保留，未新增删表或数据删除操作。

队列、定时任务与命令脚本复核：13 个 Job 中，12 个仍有现行业务调用，SendTelegramJob 专门消费升级前遗留消息，必须保留；telegram:notify 同样保留为空操作兼容旧外部 cron。保留 Horizon 对应队列、全部业务调度、安装/升级入口、人工运维命令及 V10 生成/文档脚本。删除空的应用 Test 命令，避免覆盖框架测试入口，并清除任务/命令中 6 处无用导入。check:server 仍可人工检查现行节点，因此未删除。本轮不改变队列名称、序列化属性、调度频率或安装升级流程。

## 自动验证

在本地测试环境执行，PHP 数据库测试使用临时数据与事务回滚：

```sh
php tests/api-v10.php
php tests/api-v10-inventory.php
php tests/api-route-audit.php --write-inventory
php tests/api-retirement.php
php tests/mgate.php
php tests/order-replacement.php
php tests/registration-policy.php
php tests/console-smoke.php
cd frontend
npm test
npm run build
```

- 契约测试验证认证、字段校验、订单与充值、支付回调、订阅格式和对象归属。
- 路由审计检查处理方法存在性、后台权限及 V10 未登录行为；退役测试禁止旧入口和无用控制器重新出现。
- 保留历史映射用于功能追溯，映射中的旧路径或类名不表示仍可调用。
- 运行输出为本次验证结果，不维护会随功能变化而过时的累计测试数字。

## 上线验证边界

本地支付和邮件测试使用替身，不证明生产支付商签名、网络、防火墙、SMTP 或真实客户端工作正常。部署时同步后端和前端构建、清理缓存并重启队列；按 [部署说明](README.md#deployment-and-rollback) 执行。

生产验证需确认：支付商可访问新回调、重复通知不会重复开通、Horizon 正常消费任务、自定义订阅可以刷新，以及镜像下载可用。不要用真实批量发信或真实用户数据代替本地回归。
