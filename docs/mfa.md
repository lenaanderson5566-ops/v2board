# 可选 MFA

用户入口：账户菜单 → 账户安全；管理员入口：后台账户菜单或侧栏 → 账户安全。默认两种方式均关闭，不强制历史账号开启。

- 邮件验证：重新输入当前密码；有 TOTP 时还需 TOTP 或恢复码；验证新发送的邮件码后启用。
- TOTP：重新验证身份后，本地展示 QR 与手动设置密钥。验证新动态码后才启用，并生成 10 个 128 位随机恢复码；密钥加密存储，恢复码仅存哈希，原文仅显示一次，独立确认层在登录状态刷新后仍保留，保存前不可误关闭。
- 二者可共存，登录优先 TOTP。邮件是显式启用后的备选方式，不能用于替代更改 TOTP 时所需的旧 TOTP 或恢复码。
- 关闭、更换或重新生成恢复码，需要当前密码及已有的最强验证方式。有 TOTP 时必须验证 TOTP / 恢复码；只有邮件时必须验证独立、限定用途的邮件码。
- 更新后撤销所有登录会话，旧授权链接、待验证挑战和恢复码按版本/用途失效。邮件通知走事务邮件通道，不包含密钥、验证码或恢复码。邮件禁发名单仍禁止所有邮件。

TOTP 使用 SHA-1、6 位、30 秒，允许前后各一个时间步并防重放；服务器需正确同步时间，显示时区不影响计算。挑战 5 分钟、绑定浏览器会话/客户端与账号密码和邮箱指纹、一次性消费。登录、验证码尝试、邮件发送都有短时限流，使用数据库行锁和缓存锁处理并发。

用户 API：GET /api/v10/me/security/mfa；POST /api/v10/me/security/mfa/challenges；POST /api/v10/auth/mfa/emails；POST /api/v10/auth/mfa/verifications。最后两者也处理已经认证的设置挑战，服务端验证账号及用途。管理员账户设置保留现有管理员 API；管理员登录第二步保留仅管理员可用的 passport/mfa 路由，拒绝从查询参数读取验证数据。所有浏览器写请求要求 CSRF 和精确 Origin，验证前不签发会话，验证后旋转 HttpOnly Cookie；客户端收到明确 mfaRequired 挑战，必须完成 V10 第二步，不能使用密码直接获取会话。应用浏览器授权只从有效会话交换，不重复降级验证。

部署：update.sh 包含 2026_10_14_000011_add_optional_mfa.php；新安装 SQL 同步更新。备份 APP_KEY（用于已加密的 TOTP 密钥），禁止把密钥/动态码/恢复码写入日志或发往第三方二维码服务。现有配置 API 不包含 MFA 密钥。所有验证字段用 POST 请求体传输，响应 no-store。

测试：tests/mfa.php 覆盖 RFC 向量、启用证明、恢复码及动态码重放、撤销、两种角色、共存规则；tests/mfa-api.php 覆盖实际登录 Cookie、CSRF、Origin 和无凭据泄露；前端 MfaLogin / MfaSecurity 测试覆盖防重复、验证失败和一次性恢复码确认。财务回归在隔离数据库运行。

依据：https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html 及 https://www.rfc-editor.org/rfc/rfc6238 。邮件弱于 TOTP，因此在 MFA 变更时不允许邮件降级替代已启用的 TOTP；前台仅把邮件展示为用户已明确开启的登录选项。
