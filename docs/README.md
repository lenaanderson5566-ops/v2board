# 项目文档

日常部署从 [安装升级流程](update-script.md) 开始。公开接口及兼容范围以 [V10 规范](api-v10/README.md) 和 [保留接口清单](api-v10/retained-endpoints.md) 为准；功能文档中的内部 action 名称不应直接当作公开 URL。

## 阅读规则

本文按功能收录现有说明。部署版本和当前字段优先核对代码、锁文件及生成契约；历史审计和逐轮验证结果通过 Git、忽略的测试日志及 Actions run 查阅，不作为当前部署命令或通过保证。Laravel 9–12 的过渡说明已移除，当前要求见 [Laravel 13](laravel13-upgrade.md)，无需逐版重做旧升级。

实际执行入口：浏览器认证为 `app/Http/Middleware/{BrowserSession,BrowserOrigins,CORS}.php` 与 `config/browser.php`；计费为 `app/Services/{BillingCurrency,PaymentQuote,ExchangeRate}.php`；安装为 `app/Console/Commands/V2boardInstall.php` 与 `database/install.sql`；升级顺序和恢复访问规则为根目录 `update.sh`。历史报告不能替代这些入口。

## 部署、维护与验证

- [安装与分支升级](update-script.md)、[Laravel 13 与 PHP 要求](laravel13-upgrade.md)
- [项目目录、依赖与契约生成](project-structure.md)
- [用户端、后台与独立部署](frontend-deployment.md)、[用户端主题](frontend-theme.md)
- [测试组织与隔离执行](test-organization.md)、[前后台验收](frontend-validation.md)
- [安全修复与部署验收边界](security-review.md)、[关键配置复查](critical-config-review.md)

## 账户、登录与用户入口

- [账户进入状态](account-entry-states.md)、[账户体验与服务通知](account-experience.md)
- [认证安全](authentication-security.md)、[浏览器 Cookie 会话](browser-sessions.md)、[MFA 与 Passkey](mfa.md)
- [注册策略](registration-policy.md)、[邮件邀请](email-invitations.md)
- [用户导航与快速开始](user-setup-navigation.md)、[用户语言偏好](user-language-preference.md)
- [业务与界面时区](timezones.md)、[iOS 下载账号](apple-accounts.md)
- [Telegram 绑定与群资格](telegram-community.md)

## 套餐、支付与额度

- [订阅购买流程](subscription-checkout.md)、[结算界面与恢复](payment-checkout-ui.md)
- [人民币／美元计费与优惠券](billing-currencies-coupons.md)、[支付类别／币种／网络](payment-categories.md)
- [订单支付快照](order-payment-history.md)、[MGate 支付](mgate-payment.md)、[已移除支付渠道](retired-payments.md)
- [优惠券活动与多语言](coupon-activities.md)、[按用户范围发券](coupon-campaigns.md)
- [独立流量额度与老用户迁移](traffic-credits.md)、[账单／使用情况／重置](usage-resets.md)

## 节点、服务器与线路

- [V2Box 接入与节点类型](v2box.md)、[节点管理界面](node-management-ui.md)
- [节点当前 IP](node-current-ip.md)、[地区与城市目录](node-location-catalog.md)
- [服务器流量统计与额度](server-traffic-budgets.md)、[流量批次去重](node-traffic-dedup.md)
- [Lightsail 静态 IP 管理](lightsail-ip-management.md)

## 客户端、订阅与分发

- [订阅信息与安全提示](subscription-info.md)、[客户端导入语言](client-import-language.md)
- [DNS 策略](dns-client-policy.md)、[sing-box 模板要求](sing-box-template.md)
- [客户端维护与风控](risk-and-client-updates.md)、[本地客户端镜像](client-mirrors.md)
- [FastAI 发布与网站登录](FASTAI.md)、[签名服务入口与恢复](fastai-entrypoints.md)
- [FastAI 配置模板](fastai-configuration.md)、[FastAI sing-box 配置](fastai-singbox.md)

## 内容、邮件与后台运营

- [公告和群发邮件多语言](content-translations.md)、[邮件模板与投递](product-mail.md)
- [Azure 套餐自动翻译](plan-auto-translation.md)、[Banner 管理](banner-management.md)
- [后台经营、邀请和活动视图](admin-workspaces.md)、[后台共用组件](admin-components.md)
- [后台运行诊断](admin-diagnostics.md)、[性能／告警／功能维护](observability-governance.md)
- [日志管理与统计](log-management-review.md)、[风控复核与配置检查](risk-review-and-config-checks.md)

## 接口与生成文件

- [V10 规范](api-v10/README.md)、[接口验证与发布检查](api-v10/audit.md)
- [OpenAPI](api-v10/openapi.json)、[历史功能映射](api-v10/mapping.md)、[保留接口](api-v10/retained-endpoints.md)

`api-v10/endpoints.json` 是生成的路由审计清单，不生成 PHP 路由；路由与控制器仍显式维护。`contracts.json` 是生成的运行时字段映射，`retained-legacy.json` 用于兼容审计。这些文件有运行时或验证用途，不能作为历史报告删除。只修改 `api/v10/modules/*.json` 与 `api/v10/mapping-notes.md` 等维护源，再按 [项目结构](project-structure.md) 的流程生成并核对全部发布物。

旧后台 HTML/JSON 对照报告、列提取快照及对应一次性生成脚本已移除；需要追溯时使用 Git，不重新建立平行历史文档。
