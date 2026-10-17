# 用户语言偏好

账户语言存储在 `v2_user.language`，可空的 varchar(10)，支持 zh-CN、zh-TW、en-US、ja-JP、ko-KR、vi-VN、ru-RU、fa-IR、es-ES、pt-BR、fr-FR、de-DE、id-ID、th-TH。

- 未登录：本地选择优先于浏览器自动识别；主动切换标记只在当前浏览器会话保留。
- 注册：保存当前界面语言。
- 登录：数据库中已有语言优先；字段为空时初始化为当前界面语言。只有当前匿名会话中主动选择过语言时，才通过 `languageSelected=true` 覆盖账户偏好。
- 登录恢复：从 `GET /api/v10/me` 应用账户语言，不再发起保存请求。
- 已登录主动切换：通过 `PATCH /api/v10/me` 保存成功后更新界面和本地缓存；失败保留原语言、显示错误并允许重试。语言切换期间阻止重复提交。
- 请求中的 Accept-Language 仅控制当前请求翻译，不能修改账户偏好。管理员界面保留中文，不覆盖用户偏好。

生产升级请运行 update.sh；脚本包含 `2026_10_02_000002_add_language_to_users.php` 的指定路径迁移。新安装的 install.sql 同样包含字段。已有用户不批量回填，不改变密码、订阅、余额、登录凭证或已有会话。切换到 Cookie 会话不属于此次修改。

通知邮件和 Telegram 优先使用账户语言；邮件默认语言、公告和套餐翻译选项支持同一语言集合。自定义套餐名称、描述和公告需由管理员提供翻译，缺少翻译时保留原文。新增语言包按需加载，不批量修改已有账户偏好。

验证：frontend npm test / npm run build；隔离副本中的 `php tests/run.php --only=api-v10,product-mail,client-import-language,node-display,content-translations,plan-translations,banners`；bash tests/update-script.sh。

新增法语（fr-FR）、德语（de-DE）、印尼语（id-ID）和泰语（th-TH）后，共支持 14 种语言。English 固定在首位，其余按语言代码稳定排列，显示语言本名。所有新增前端资源均独立按需加载；后端错误、邮件、Telegram、安全验证、退订与订阅提示均有对应资源。无需新增数据库迁移。套餐和公告的管理员自定义内容仍需单独提供翻译。

翻译完整性：用户端与公共组件的可见文案自动扫描；14 种语言的所有功能命名空间核对键及插值变量。后端从实际 `__()` 字面量调用核对资源，防止只有旧词条完整、新提示仍漏译。V10 问题响应的 title/detail 按 Accept-Language 显示，HTTP 状态、code、字段和客户端协议保持不变；调用方应根据 code 判断错误。微信／QQ 内置浏览器提示根据浏览器语言显示，波斯语使用 RTL。管理员界面保留中文，产品名、平台名、技术标识和服务商要求的署名保留原文。
