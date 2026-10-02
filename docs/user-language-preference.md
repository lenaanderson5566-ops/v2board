# 用户语言偏好

账户语言存储在 `v2_user.language`，可空的 varchar(10)，支持 zh-CN、zh-TW、en-US、ja-JP、ko-KR、vi-VN、ru-RU、fa-IR。

- 未登录：本地选择优先于浏览器自动识别；主动切换标记只在当前浏览器会话保留。
- 注册：保存当前界面语言。
- 登录：数据库中已有语言优先；字段为空时初始化为当前界面语言。只有当前匿名会话中主动选择过语言时，才通过 `language_selected=true` 覆盖账户偏好。
- 登录恢复：从 user/info 应用账户语言，不再发起保存请求。
- 已登录主动切换：通过 user/update 保存成功后更新界面和本地缓存；失败保留原语言、显示错误并允许重试。语言切换期间阻止重复提交。
- 请求中的 Content-Language 仅控制当前请求翻译，不能修改账户偏好。管理员界面保留中文，不覆盖用户偏好。

生产升级请运行 update.sh；脚本包含 `2026_10_02_000002_add_language_to_users.php` 的指定路径迁移。新安装的 install.sql 同样包含字段。已有用户不批量回填，不改变密码、订阅、余额、登录凭证或已有会话。切换到 Cookie 会话不属于此次修改。

此字段用于用户界面语言，不改变邮件模板翻译。将来若要根据此偏好发送通知邮件，需要在队列任务中显式应用收件人语言。

验证：frontend npm test / npm run build；本地 php tests/language-preference.php；bash tests/update-script.sh。
