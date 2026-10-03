# 公告和群发邮件多语言

- 新建默认勾选 zh-CN（简体中文）、en-US（英文）。zh-TW（繁体中文）单独维护，可与其余 5 种语言按需勾选。编辑旧公告时保留已有语言。
- 勾选的是内容版本，不是收件人筛选；群发范围仍由用户筛选及人数确认控制。
- 填写原文并选择原文语言，再点击“生成缺失译文 / 重试”。沿用套餐翻译的 Azure 配置，不在发送时调用翻译服务。原文最多 20,000 字；普通保存仍支持 100,000 字正文。
- 已填写内容不会覆盖。单语言失败继续处理其余语言，45 秒前端超时，Azure 请求 35 秒超时，可重试缺失内容。修改原文后须手工检查已有译文；生成不是发布或发送。
- 保存前必须补全所选语言标题、正文，或取消勾选未完成的语言。未勾选的版本不发布。生成内容需要人工审核。
- 邮件按发送时用户数据库语言选择译文；没有对应译文时用原文，其 HTML lang、RTL、按钮与页脚跟随原文语言。旧邮件未传 source_language 保持旧回退行为。
- 公告优先当前页面语言，缺省使用用户保存语言；缺少对应版本则保留原公告。单条、分页、通知中心都使用同一规则。zh-Hant / zh_Hant / zh-HK 映射到 zh-TW，zh-Hans 映射到 zh-CN。
- 标题和正文共用一次 Azure 请求；HTML 邮件 / HTML 公告使用 textType=html，Markdown 公告使用 plain。数字与链接发生变化时拒绝自动译文，可手工填写。
- 公告在原表新增 translations JSON、source_language；原有标题、正文和读状态保留。update.sh 已包含定向迁移：database/migrations/2026_10_03_000001_add_notice_translations.php。
- 更新仍需停掉本站队列 / 定时任务并提供有效数据库备份，运行更新脚本已有的 --jobs-stopped 和 --database-backup 参数。迁移幂等，重复执行不会重复新增字段。

## 邮件文案

简体、繁体与英文统一为明确的事项、期限和操作。验证 / 登录邮件说明 5 分钟有效及不得分享；流量、到期、支持邮件使用对应操作按钮。所有语言保留纯文本版本、安全 HTML、统一模板及本地化操作按钮。群发正文不再插入重复的默认通知导语，摘要取自实际正文。

自动翻译生成、预览和测试均不发送真实邮件。验证码专用优先队列与群发限速机制保持原有配置。

## 本地验证

- npm test -- src/AdminMail.test.tsx src/ContentComposer.test.tsx src/AdminPlanAutoTranslation.test.tsx
- php tests/content-translations.php
- php tests/plan-auto-translation.php
- php tests/product-mail.php
- npm run build

PHP 测试只运行于 local 环境，数据事务回滚，Azure / SMTP 均模拟。
