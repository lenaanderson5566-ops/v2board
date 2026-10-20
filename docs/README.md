# 项目文档

接口入口与兼容范围以 [V10 规范](api-v10/README.md) 和 [保留接口清单](api-v10/retained-endpoints.md) 为准。功能文档中的内部 action 名称不应直接当作公开 URL。

- [安全检查与待修复风险](security-review.md)

- [目录边界与契约生成](project-structure.md)

## 当前说明与历史记录

日常部署以 [安装升级流程](update-script.md)、[浏览器会话](browser-sessions.md) 和 [多币种计费](billing-currencies-coupons.md) 为入口。Laravel 9–12 文档及测试/安全记录中的旧日期章节保留当时的事实和验证数量，不能作为当前部署命令；无需逐版重做旧升级。当前路由与字段以生成契约和代码为准。

核对文档时优先查看实际执行源：浏览器认证为 `app/Http/Middleware/{BrowserSession,BrowserOrigins,CORS}.php` 与 `config/browser.php`；计费为 `app/Services/{BillingCurrency,PaymentQuote,ExchangeRate}.php`；安装为 `app/Console/Commands/V2boardInstall.php` 和 `database/install.sql`；升级顺序及恢复访问规则为根目录 `update.sh`。通用框架配置文件或历史报告不能替代这些实际入口。

## 功能与运维

- [性能监控、后台告警与功能维护入口](observability-governance.md)

- [账户进入界面与 Laravel 状态规则](account-entry-states.md)
- [iOS 下载账号](apple-accounts.md)
- [登录安全检查与升级兼容](authentication-security.md)
- [浏览器 Cookie 会话与独立部署限制](browser-sessions.md)
- [人民币／美元计费与优惠券](billing-currencies-coupons.md)
- [Banner 管理](banner-management.md)
- [客户端导入语言](client-import-language.md)
- [本地客户端镜像](client-mirrors.md)
- [公告和群发邮件多语言](content-translations.md)
- [关键配置复查](critical-config-review.md)
- [邮件邀请与账户设置](email-invitations.md)
- [前后台验证](frontend-validation.md)
- [MGate 支付接口](mgate-payment.md)
- [Azure 套餐自动翻译](plan-auto-translation.md)
- [邮件发送与多语言模板](product-mail.md)
- [注册策略与前端联动](registration-policy.md)
- [风控与客户端维护](risk-and-client-updates.md)
- [风控复核与配置检查](risk-review-and-config-checks.md)
- [sing-box template requirements](sing-box-template.md)
- [用户导航与订阅支付流程](subscription-checkout.md)
- [独立流量额度与老用户迁移](traffic-credits.md)
- [Laravel 13 升级与 PHP 要求](laravel13-upgrade.md)
- [宝塔分支升级脚本](update-script.md)
- [账单、使用情况和重置](usage-resets.md)
- [用户语言偏好](user-language-preference.md)
- [用户导航与快速开始](user-setup-navigation.md)

## 接口与生成文件

- [接口验证与发布检查](api-v10/audit.md)
- [OpenAPI](api-v10/openapi.json)
- [历史功能映射](api-v10/mapping.md)

`api-v10/endpoints.json` 是生成的路由审计清单，不生成 PHP 路由；路由与控制器仍显式维护。`contracts.json` 是生成的运行时字段映射；`retained-legacy.json` 用于兼容审计。不能将这些 JSON 当作历史报告删除。生成方式见 V10 规范。

旧后台 HTML/JSON 对照报告、列提取快照及对应一次性生成脚本已移除；历史内容通过 Git 查阅。
