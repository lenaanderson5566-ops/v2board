# 安全检查（2026-10-05）

范围：当前工作区的应用路由、中间件、用户业务与支付适配层、订阅、上传下载、外部请求、前端 HTML 渲染及锁定依赖。采用源码检查、既有测试、定向回归和依赖公告审计；不是生产渗透测试，也不保证不存在其他漏洞。未发送真实付款、邮件或攻击线上服务。已有文档清理改动保持独立。

## 已修复

| 优先级 | 发现 | 修复及验证 |
|---|---|---|
| P1 加固 | PaymentService 使用回调路径的 method 选择验签适配器，却不匹配数据库渠道的 payment 字段；可能把渠道密钥交给错误的验签器，是否可利用取决于适配器组合 | 按 ID/UUID 加载后必须匹配配置的支付商，否则拒绝。MGate 及其他供应商签名代码未改。HTTP 测试验证错配不会开通订单 |
| P2 | 自定义订阅路径没有明确禁止缓存，内容包含节点凭证；代理配置不当时可能缓存敏感配置 | Client 中间件对原生响应设置 private, no-store，V10 原有禁止缓存保持。自定义订阅 HTTP 测试通过；CDN 强制缓存仍需运维关闭 |
| 测试缺口 | 认证安全测试仍请求已退役用户入口，且默认异常处理可能使脚本失败却返回 0 | 改测 V10 会话、凭证轮换、退出；异常退出码设为 1。21 项通过 |

## 尚未解决，不能视为安全通过

### P1：部分历史支付适配器没有检查到账事件

`app/Payments/BTCPay.php::notify` 验签后读取 invoice 并直接返回订单号，未检查 webhook type 和发票结算状态。`app/Payments/Coinbase.php::notify` 同样未按事件类型区分成功、创建、失败事件。若支付商发送未到账事件，当前处理链可能把订单标记为已支付。未核实线上是否启用了这些渠道及订阅事件类型。

BTCPay 官方将 InvoiceProcessing 与 InvoiceSettled 分开，后者才允许交付：[官方集成说明](https://docs.btcpayserver.org/Development/ecommerce-integration-guide/)。建议逐支付商核对实际版本，增加到账状态、金额/币种、商户和订单归属检查及签名样例测试。共享回调目前也未统一核对返回金额与订单应付金额。此次未擅改供应商 SDK 的原生协议。

### P1：部分 USDT 适配器关闭 TLS 证书验证

`app/Payments/Epusdt.php` 和 `app/Payments/BEasyPaymentUSDT.php` 设置 CURLOPT_SSL_VERIFYPEER=0。网络被拦截时存在中间人风险。MGate 已开启证书与主机名验证。应为上述网关恢复证书校验并验证实际证书链；此轮未修改它们。

### P1/P2：后端锁定依赖仍命中公告

执行 `composer audit --locked --no-dev --format=json` 得到 8 条公告；表示版本命中范围，不等同于每项在本项目均可利用。锁定包为 laravel/framework 8.x-dev、league/flysystem 1.x-dev、symfony/yaml 4.4.x-dev。swiftmailer/swiftmailer v6.3.0 被标记 abandoned。

| 包 | 公告 | 级别 |
|---|---|---|
| laravel/framework | PKSA-d5tc-s1qs-h781：调试页 XSS | low |
| laravel/framework | PKSA-m5cs-t1y6-qpcs：临时签名 URL 路径混淆 | medium |
| laravel/framework | PKSA-3r5d-mb8f-1qw9：默认邮箱规则 CRLF 注入 | high |
| laravel/framework | PKSA-8qx3-n5y5-vvnd：文件校验绕过 | medium |
| league/flysystem | PKSA-w9tt-7782-78jx：路径控制字符校验绕过 | low |
| symfony/yaml | PKSA-v5yj-8nmz-sk2q：别名展开内存耗尽 | low |
| symfony/yaml | PKSA-ft77-7h5f-p3r6：正则拒绝服务 | low |
| symfony/yaml | PKSA-b14r-zh1d-vdrc：嵌套递归栈耗尽 | low |

生产必须关闭 APP_DEBUG；当前主要邮箱入口使用 email:strict、图片上传仅管理员可用、YAML 模板来自服务器文件，这些限制减少部分暴露面，但不等于公告已修复。composer.json 还存在已有 audit.ignore 项，本结果按当前工具配置报告。框架与跨主版本依赖升级需要兼容性迁移，不在此次直接升级。

### P2：部署信任边界

- CORS 反射任意 Origin 且允许 credentials。当前网页登录依靠手动 Authorization、未启用会话 Cookie，因此不能据此直接断言可窃取登录态；应按实际前端域名设置允许列表，在引入 Cookie 前必须收紧。
- 后台/客服保留 auth_data 参数鉴权，查询参数可能被访问日志记录。前端当前使用 Authorization，建议后续停用查询参数鉴权并确认外部调用方。
- 后台自定义页脚允许脚本，是现有受信任管理功能；管理员或客服脚本一旦被攻陷可接触同源登录凭证。应严格限制管理账户、第三方客服脚本和后台访问范围。
- 订阅 token 位于 URL；应用 V10 日志记录路由模板，但 Nginx/CDN 访问日志需另行脱敏。应用代码无法保证生产代理日志和缓存策略。

## 本轮检查与验证

- V10 HTTP 契约 112 项、认证安全 21 项、路由审计 565 项通过。
- Apple 账号 26 项、镜像 23 项、Banner 22 项、MGate 14 项通过。
- 前端生产依赖 `npm audit --omit=dev --json` 返回 0 条已知漏洞；不涵盖业务逻辑或未公开漏洞。
- 已检查用户订单/工单归属、JWT 签名/过期/撤销、权限即时读取、Apple 服务 DNS 固定与私网拒绝、镜像来源限制、图片路径白名单、Markdown 的 DOMPurify 清理、查询筛选校验。
- 定向扫描未发现已跟踪私钥文件或所扫描源码中的 AWS/GitHub token 特征；不是全量秘密扫描，也未审计 Git 历史。

优先处理未到账回调与关闭 TLS 的支付适配器，再规划受支持依赖升级和生产配置收敛。当前不能宣称全项目无安全问题。
