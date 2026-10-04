# 项目文档

接口入口与兼容范围以 [V10 规范](api-v10/README.md) 和 [保留接口清单](api-v10/retained-endpoints.md) 为准。功能文档中的内部 action 名称不应直接当作公开 URL。

- [安全检查与待修复风险](security-review.md)

## 功能与运维

- [账户进入界面与 Laravel 状态规则](account-entry-states.md)
- [iOS 下载账号](apple-accounts.md)
- [登录安全检查与升级兼容](authentication-security.md)
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
- [宝塔分支升级脚本](update-script.md)
- [账单、使用情况和重置](usage-resets.md)
- [用户语言偏好](user-language-preference.md)
- [用户导航与快速开始](user-setup-navigation.md)

## 接口与生成文件

- [接口验证与发布检查](api-v10/audit.md)
- [OpenAPI](api-v10/openapi.json)
- [历史功能映射](api-v10/mapping.md)

`api-v10/endpoints.json` 是路由生成输入，`contracts.json` 同时是运行时字段映射；`retained-legacy.json` 用于兼容审计。不能将这些 JSON 当作历史报告删除。生成方式见 V10 规范。

旧后台 HTML/JSON 对照报告、列提取快照及对应一次性生成脚本已移除；历史内容通过 Git 查阅。
