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

## Passkey 登录

后台「系统设置 → 安全」新增「允许 Passkey 登录」，默认关闭。安装 Composer 锁定依赖和 `2026_10_19_000002_create_passkeys.php` 迁移后才能开启；update.sh 已纳入该迁移。Google reCAPTCHA 的配置控件、公开字段、验证逻辑、浏览器脚本与 Composer 依赖已移除，TOTP、邮箱验证和登录限流保留。保存后台配置时删除旧 reCAPTCHA / Google Analytics 配置键；当前项目没有实际接入 Google Analytics 的脚本，已有第一方统计保持原功能。

开启后，用户和管理员可在各自安全中心绑定最多 10 个 Passkey，在登录页使用「使用 Passkey 登录」。绑定或删除需要当前密码，以及最近 5 分钟内完成的登录（包括已启用的 MFA）；超时请重新登录。令牌迁移、浏览器链接和客户端授权兑换均继承原始验证时间，不能刷新这 5 分钟。没有可信验证时间的旧会话需重新登录。登录仍需完成账户已有 MFA。取消设备验证可继续使用密码。删除凭据撤销账户全部会话和未完成的安全/授权挑战（包括使用其他凭据发起的 MFA）；关闭站点开关阻止新的绑定和登录，但已有凭据仍可查看、移除。

生产站点必须使用 HTTPS 和稳定域名，配置的 `app_url` 决定 RP ID 与精确浏览器 Origin（非默认端口保留，HTTPS 443 / HTTP 80 按浏览器规则省略）。当前仅支持该站点 Origin，独立前端也应部署到相同 Origin；不接受任意 CORS 来源进行 Passkey 操作。开发环境仅允许 HTTP localhost。变更域名后旧 RP 的凭据不能登录，应先使用密码登录并在新域名重新绑定。独立部署修改开关后需重新导出运行时配置并刷新页面。

API：GET /api/v10/me/security/passkeys；POST /api/v10/me/security/passkeys/registration-options；POST /api/v10/me/security/passkeys；DELETE /api/v10/me/security/passkeys/{passkeyId}；POST /api/v10/auth/passkeys/options；POST /api/v10/auth/passkeys/sessions。写入使用 JSON、浏览器 Cookie、CSRF 与精确 Origin。挑战 300 秒、绑定发起浏览器、一次消费，校验 RP、Origin、UP/UV、签名与计数器。只保存凭据 ID、公钥和必要元数据，不保存私钥或 attestation 证书。既有 MFA 挑战在凭据被撤销或开关关闭后不能完成登录。原生客户端继续使用原有认证方式。

自动化用 ES256、RSA 和 Ed25519 真实签名及零计数器同步凭据覆盖用户及管理员的浏览器登录、绑定、无效证明和 MFA 衔接；设备凭据管理器、指纹 / 人脸及实体安全密钥尚需部署环境真机验收。

依据：https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html 及 https://www.rfc-editor.org/rfc/rfc6238 。邮件弱于 TOTP，因此在 MFA 变更时不允许邮件降级替代已启用的 TOTP；前台仅把邮件展示为用户已明确开启的登录选项。


Passkey 复核补充：删除在取得账户行锁后重新检查原会话、密码、邮箱及验证时间，随后提升账户安全版本，避免等待锁期间已撤销的会话继续删除或待验证挑战重新生成登录会话。畸形 clientData / CBOR / authenticatorData 返回 422 并消费挑战，不向客户端暴露解析错误；拒绝跨来源上下文和无 BE 的 BS 标志。新密码策略不用于验证历史账户的当前密码。

前端为挑战和证明请求设置超时，组件卸载取消设备验证及后续证明提交；删除错误保留在确认弹窗中且清空已输入密码。管理请求收到 401 时回到登录，单次 Passkey 登录失败不会退出其他已有会话。兼容性依据：[WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) 与 [WebKit 的用户手势和异步挑战说明](https://webkit.org/blog/11312/meet-face-id-and-touch-id-for-the-web/)。自动化不代表 Safari、Firefox 或实体设备已经真机验收。
