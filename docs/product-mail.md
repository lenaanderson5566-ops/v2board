# 邮件发送与多语言模板

此更新不新增数据库字段。拉取并执行正常升级流程后，重启本站 Horizon / Supervisor 队列进程，使长驻进程载入新代码和配置。修改 SMTP 或限速配置后也需要重启。不要同时给同一个队列重复增加大量独立 worker。

## 后台入口

- 系统配置 → 邮件发送：SMTP、默认语言、三项发送间隔、八语言 HTML / 纯文本预览、发给当前管理员的测试邮件。
- 用户管理 → 群发邮件：默认正文必填，其他语言可选；每个版本必须同时填写主题和正文。确认筛选范围和人数后加入队列。预览不会实际发送。
- 预览与真实发送使用同一渲染服务。自定义正文保留基础段落、列表、强调和 HTTP(S) 链接；脚本、远程图片、样式、表单及事件属性不保留。

## 语言

支持简体中文、繁体中文、英语、日语、韩语、越南语、俄语、波斯语（RTL）。
验证码优先采用请求的界面语言；账户提醒和群发在发送时读取收件人的账户语言；邀请采用邀请人的账户语言，缺失时使用本次界面语言。最终回退到后台默认语言（初始为简体中文）。不根据邮箱域名推断语言。
系统邮件的主题、说明、按钮及页脚均翻译；用户工单内容不自动翻译。群发按用户语言选择管理员填写的版本；缺少版本时沿用默认主题和正文。旧 email_template 设置不再影响邮件，旧模板文件保留以兼容外部引用，但内置发送入口统一使用 product 模板。发件品牌使用站点名称，默认 V2Board 名称回退为 Studio。

## 限速与失败

Redis 对同一应用的同一 SMTP 账号统一限速，多个进程共享配额：

| 配置 | 默认 | 范围 |
| --- | --- | --- |
| 普通邮件间隔 | 2 秒 | 除验证码外的内置邮件 |
| 群发间隔 | 10 秒 | 管理员/员工群发、定时用量与到期提醒 |
| 服务商群发间隔 | 30 秒 | QQ/Foxmail、163/126/yeah、Gmail/googlemail 分组，其他按域名 |

邮件任务明确使用 Redis 队列，不受默认 sync 连接影响；Horizon 配置适用于所有 APP_ENV。Horizon 的群发队列使用独立单进程，验证码使用独立的 send_email_priority 队列与两个专用进程，不受普通邮件/群发限速和群发拒收冷却影响；邀请及普通通知使用 send_email。自行配置 Supervisor 时，必须新增 send_email_priority 的独立消费者，同时保留 send_email 和 send_email_mass 消费者。仅设置一个混合队列进程不能保证验证码不被群发占用。Redis 不可用时不会绕过限速直接群发。
达到限额的任务释放回队列，不 sleep 占用进程。临时 SMTP / 网络失败重试，普通邮件服务商冷却 60–900 秒；验证码独立冷却 5–60 秒、快速重试，申请端原有频率和人机验证限制保留；识别到 SMTP 5xx 永久拒收时终止，日志保留原因。发送异常最多 5 次；普通任务期限 24 小时，群发 7 天，验证码 5 分钟且发送前校验当前缓存。任务期限是投递截止时间，长队列应观察 Horizon 延迟并合理拆分批次。服务商接受 SMTP 不代表最终进入收件箱；网络断开导致确认丢失时重试也可能重复投递。
到期提醒按用户及到期时间去重；发送时再次检查用户是否已续费、关闭提醒或被封禁。用量提醒发送前也重新检查使用量。

上述数值是可调整的保守默认值，不是 163、QQ 或 Gmail 的官方固定上限。还需使用正确的发件域名与 SPF/DKIM/DMARC 配置，并观察退信调整频率。参考 [Google 发件人指南](https://support.google.com/mail/answer/81126?hl=en)。

## 验证

工单回复采用通知邮件：只显示本地化提醒、工单编号及帮助中心入口，不发送工单标题或回复正文。新队列任务不携带这些内容；更新后的渲染器也会忽略旧任务中的标题和正文。后台邮件预览使用示例编号。正文仍在登录后的工单页面查看，邮件不支持直接回复。部署后重启 Horizon 以加载新渲染逻辑；已经发送的邮件无法撤回。

本地 PHP：`php tests/product-mail.php`、`php tests/email-invitations.php`；均使用模拟邮件传输，不发送真实邮件。前端：`npm test -- --run src/AdminMail.test.tsx`，然后 `npm run build`。静态构建随仓库提交。

### 自行使用 Supervisor queue:work 的部署

如果运行 `artisan horizon`，更新后重启 Horizon 即加载仓库中的专用队列配置。若自行维护 `queue:work` 进程，请增加一个独立 Supervisor 程序，使用本站原有工作目录、运行用户及日志目录，命令示例：

```ini
command=/www/server/php/81/bin/php /www/wwwroot/api.adanalytics-service.com/artisan queue:work redis --queue=send_email_priority --sleep=1 --timeout=30
numprocs=2
process_name=%(program_name)s_%(process_num)02d
autostart=true
autorestart=true
stopwaitsecs=40
```

不要只把优先队列追加到群发队列后面。验证码会在专用进程可用时立即投递，群发不会产生额外等待；SMTP 响应、网络和收件服务商仍决定实际到达时间。

### 更新后验证码报 Undefined variable $preheader

Horizon 是常驻进程。仅 git pull 后，新 Blade 模板可能与旧进程已加载的 ProductMail 数据构造代码混用。preheader 为可选摘要，模板现已兼容其缺失；验证码和找回密码共用 verify 模板。

部署后执行 `php artisan view:clear`，然后通过 Supervisor 重启 Horizon。若 PHP-FPM 启用了不检查文件时间的 OPcache，也需重启对应 PHP-FPM。修复后重新申请验证码，不要批量重投已过期验证码任务。MaxAttemptsExceededException 本身不能确认是 SMTP 超时，应结合原始邮件日志判断。


## Mailgun API 与邮件发送日志（2026-10-14）

后台入口：系统配置 → 邮件发送；日志 → 邮件日志。

### 配置与升级

- 升级先执行 `2026_10_14_000002_add_mail_delivery_metadata.php`，已纳入 `update.sh`；新安装 SQL 同步包含字段。随后重启邮件队列。未执行迁移时不要启用新发送代码。
- 默认保持原 SMTP 配置。选择 Mailgun HTTP API 后填写发送域名、US/EU 区域、API Key 和发件人邮箱。发送域名应在 Mailgun 验证，区域必须匹配。
- 建议使用域名专用发送密钥。新密钥使用 Laravel Crypt 加密保存于服务端配置，配置 API 始终返回空值与 `email_mailgun_key_configured` 布尔值；留空表示保留，轮换时填入新密钥。
- 服务端仅访问 `https://api.mailgun.net` 或 `https://api.eu.mailgun.net`；禁止自定义 API 主机和重定向，TLS 校验保持开启。连接超时 5 秒，总超时 15 秒，不自动跨通道回退。
- 使用现有多语言邮件模板、验证码有效期检查和发送限流；Mailgun 关闭打开/点击追踪。测试发送仅由管理员主动点击，发送到当前管理员邮箱，限制每分钟 3 次。

### 日志契约

管理员 GET `mail-logs/fetch`，沿用现有管理接口前缀和管理员权限。查询参数：`current`、`page_size`（最多 100）、`email`（精确匹配）、`provider`（smtp/mailgun/ses/resend）、`status`、`template`、`from/to`（UTC Unix 秒）。响应 `data` 数组与 `total`，字段为 `id/email/template/provider/status/error_code/message_id/duration_ms/created_at`；无用户端新接口。

每条记录对应实际发送尝试；尚未发送的队列任务、限流延后、已过期验证码不生成发送尝试。新日志不保存主题、正文、验证码、链接或服务商原始响应；邮箱保存脱敏值，精确检索使用 APP_KEY 的 HMAC 摘要。密钥轮换后旧摘要不能按邮箱查询，但仍可按时间等条件查看。历史记录不回显主题和原始错误，统一标注历史状态；历史敏感数据不会因升级被自动删除，可通过日志保留策略清理。

- `sending`：正在发送；超过 120 秒仍未完成的记录在查询中显示为结果不确定。
- `accepted`：邮件服务接受请求，不代表投递到收件箱。
- `failed`：发送失败；Mailgun 429 使用现有队列有限重试，每次实际请求分别记一条日志。SMTP 沿用原有重试策略。
- `uncertain`：Mailgun 网络中断、5xx 或响应异常，可能已被接受，禁止自动重发；管理员应在 Mailgun 核查。
- `legacy`：旧记录，无可靠通道和投递状态。

未接入 Mailgun 投递/退信 Webhook，因此不展示“已送达”“已打开”或“已点击”。日志写入失败若发生在发送前则不发送；发送后的日志更新失败不能触发重复发送。记录不是全链路 exactly-once 保证，队列确认丢失等情况仍需服务商核查。

日志保留默认 0（保持历史记录），可在日志设置改为 30–365 天，建议 90 天，沿用定时分批清理。

官方接口参考：https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-http

2026-10-14 本地验证：

- 前端全量 90 个测试文件、519 项测试通过；包括邮件日志筛选、状态文案、错误展示、刷新禁用、密钥输入和通道切换。前端构建通过。
- `php tests/notification-delivery.php` 在 Docker PHP 8.4 的内存 SQLite 上通过 108 项检查；独立 MySQL 测试库通过 118 项，额外覆盖多进程通知竞争和并发绑定。同一迁移重复执行通过。
- `php tests/product-mail.php` 在导入新安装 SQL 的另一个独立 MySQL 库上通过 394 项，包含八语言模板、SMTP 错误分类、过期验证码与 Redis 限流。
- `bash tests/update-script.sh` 的 26 个隔离升级场景通过。迁移只在测试库执行，未修改业务库；未向真实邮箱或 Telegram 发送消息。

默认通知测试使用内存 SQLite。MySQL 模式需预先创建空的独立数据库，并通过 `NOTIFICATION_TEST_DATABASE=notification_test_<8位小写十六进制>` 指定；拒绝现有含用户表的数据库。该测试使用最小旧表夹具、真实增量迁移、HTTP/Curl 模拟和 MySQL 多进程竞争，完成后应删除测试库。现有 product-mail 脚本需在独立完整安装库和隔离缓存前缀下运行。

上线前仍需配置真实 Mailgun 域名和密钥，验收实际投递；模拟响应无法证明真实服务商配置及运营商投递质量。


## Amazon SES 与 Resend API（2026-10-14）

在系统配置 → 邮件发送选择 **Amazon SES API** 或 **Resend API**，填写发件人并保存，重启邮件队列后使用“发送测试邮件”。继续使用上述日志迁移，无额外数据库字段；不能跳过邮件日志迁移。保留原 SMTP/Mailgun 配置，切换通道须由管理员明确操作，不自动跨通道回退。

### Amazon SES

- 使用现有 AWS SDK 的 SES v2 SendEmail 和签名，未引入新依赖。区域填写 `us-east-1`、`ap-southeast-1` 等实际 SES 区域；该区域必须已验证发送域名/身份。当前使用 AWS 标准分区的 `email.<region>.amazonaws.com` HTTPS 端点，不支持中国分区和自定义端点。
- AWS 主机优先使用 IAM 角色；“IAM 角色 / 服务器凭据”使用 SDK 默认凭据链，支持服务器环境、容器/实例角色。不得向前端提供 AWS 凭据。普通服务器也可选择独立 IAM 访问密钥，不要填 SES SMTP 密码或 AWS root 密钥。
- 专用 IAM 身份仅授权 `ses:SendEmail`，资源限定为所需发送身份 ARN，并可用 `ses:FromAddress` 限制发件人；按实际配置集授权需求配置。区域、身份、权限必须匹配。静态密钥模式只接受长期 AKIA 密钥，成对填写并加密保存；短期 STS 凭据及轮换通过服务器凭据链管理。
- SES 配置集可选，适合在 AWS 侧关联投递、退信和投诉监控。本系统暂未接收这些事件，不将 API 成功标记为“已送达”。
- SES 沙盒及发送额度按区域管理；向普通用户发送前需申请生产访问。建议完成 DKIM、SPF/自定义 MAIL FROM 和 DMARC 配置，并监控退信/投诉与账户抑制列表。

### Resend

- 验证发送域名，使用仅发送权限并限制域名的 API Key。保存时加密，接口只返回空值与已配置标记。打开/点击追踪请在服务商域名设置中按隐私需要关闭。
- 固定调用 `https://api.resend.com/emails`，单封邮件同时包含 HTML 与纯文本，沿用八语言模板。
- 每个队列任务生成独立随机投递标识，序列化重试保持同一 Idempotency-Key。Resend 保留幂等键 24 小时；这不是永久去重保证。相同键的正文变化可能产生 409，停止自动发送并要求核查。

### 错误与安全边界

两种通道均设置 5 秒连接、15 秒请求超时，关闭重定向、保留 TLS 校验。SES 关闭 SDK 内置重试；明确限流才进入现有队列有限重试。网络中断、5xx、成功响应缺少有效消息 ID 均标记结果不确定并停止自动重发，避免已经受理后重复发送。不要批量重放不确定任务；先核查服务商记录。队列进程被强制终止、确认丢失或人工重投仍不能保证 exactly-once。

日志不保存邮件内容、凭据或服务商原始异常，只记录受控错误码和消息 ID。API Key/AWS 密钥留空保留，轮换 AWS 密钥须成对填写。保护 APP_KEY 和配置备份；更换 APP_KEY 前应迁移加密配置。

验证使用 Docker PHP 8.4、隔离 SQLite 和模拟 SDK/HTTP 请求，包含成功、429、拒绝、超时、无效响应、固定主机、队列序列化幂等性、通道分发和密钥不回显。没有真实服务商凭据，因此实际域名认证、IAM 权限、沙盒解除及最终投递仍需部署后发送测试邮件验收。

官方参考：[SES SendEmail](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html)、[SES 生产访问](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)、[SES IAM](https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html)、[Resend Send Email](https://resend.com/docs/api-reference/emails/send-email)、[Resend 幂等键](https://resend.com/docs/dashboard/emails/idempotency-keys)。

本次 SES/Resend 增量验证结果：Docker PHP 隔离测试 173 项通过；前端 90 个文件、520 项测试通过；前端生产构建及发布目录打包通过。构建仍有既有大分包提示，不影响构建完成。未执行真实邮件投递。


## 凭据展示与响应诊断

- 已保存的 SMTP 密码与 API 密钥均只返回空值和已配置布尔标记；后台使用固定 `********` 占位提示，不回填真实密钥或将星号作为值提交。留空保留旧凭据，输入新值保存后替换。SMTP 新密码使用 APP_KEY 加密，现有明文 SMTP 配置保持读取兼容；再次保存新密码时升级为加密。
- SMTP 与各 API 配置可并存，仅当前选择的发送通道生效，无自动回退。后台明确显示已保存的通道，切换后只展示对应配置。保存后重启邮件队列。
- 新迁移 `2026_10_14_000003_add_mail_transport_codes.php` 已加入 update.sh 和新安装结构。记录实际可获得的 HTTP/SMTP 响应码、SMTP 增强码及发送时关联的用户 ID。历史记录不推测或补造响应码，SMTP 成功无可靠返回码时留空。
- 邮件日志支持 `transport_code`（100–599）与 `enhanced_code` 筛选，并返回 `diagnosis`、`advice`、`user_id`。管理员可跳转对应用户核查；邮箱修改后需核对发送时间和当时地址。接口仍不返回原始服务商错误正文。
- `5.1.1/5.1.2/5.1.3/5.2.1` 提示地址核查；`5.2.2/4.2.2` 为邮箱空间不足；`5.7.x` 是策略拒绝，不推断为用户拉黑；HTTP 401/403 通常应检查发送凭据，429 等限流应等待。
- 此阶段原先仅提供同步发送诊断；后续已接入下文的投递、退信及投诉 Webhook。未配置回调时，API 接受之后的拒收仍需到服务商事件记录核查。邮件客户端静默拉黑可能没有发信端可见反馈。清理建议是核实后停止向无效地址发送非必要邮件，不能仅因单次失败删除网站用户或订阅。

状态语义参考：[RFC 3463](https://www.rfc-editor.org/rfc/rfc3463.html)；异步通知参考：[SES 退信与投诉通知](https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html)。


## 事务 / 公告分流与投递反馈（当前实现）

### 项目评估与行为变化

原有 `send_email_mass` 同时承担流量/到期提醒，不能用队列名字推断是否营销邮件。现在仅 `notify`（管理员群发公告）走公告用途，其余业务邮件继续走事务用途；测试邮件可显式选择通道。验证码与邮件登录使用优先队列。事务通道保持原有设置，公告可独立选择 SMTP/Mailgun/SES/Resend 和发件子域名；未开启独立配置时明确共用事务通道。

**公告订阅默认关闭**，包括升级时的现有账户，避免把历史注册当成公告订阅授权。用户在账户通知偏好中主动开启，管理员群发只选择已订阅、未禁用、未抑制的地址。执行排队任务前重新检查；全局“允许发送公告邮件”关闭也会跳过已排队公告。正常验证码、账单与服务通知不依赖公告偏好，但永久退信/投诉抑制名单会阻止继续向相同地址发送。此限制不禁用网站账号、套餐或节点。

独立通道配置只在单次发送内生效，`finally` 恢复常驻队列进程配置和邮件传输缓存。配置保存支持两套加密凭据，SMTP 加密标记也明确写入配置文件。更改后必须重启 PHP/邮件队列以刷新配置和模型字段缓存。

### 退订

配置“邮件回调与退订 API 地址”为实际提供后端接口的 HTTPS 根域名（例如 `https://api.example.com`），不能误填没有转发 API 的独立前端站点。公告提供 HTML/纯文本退订页脚和 RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post` 邮件头。各语言邮件有对应退订页面。GET/HEAD 只读确认，POST 才退订；不依赖登录 Cookie。令牌只授予公告退订权，与用户 ID 和当前邮箱绑定；更改邮箱或 APP_KEY 后旧链接失效。API/access logs 不应记录真实令牌路径，请在网关日志中脱敏这一路由。

需在服务商完成发件域名验证并确保 DKIM 签名覆盖退订相关邮件头；本地模拟测试不能验证服务商最终 DKIM 行为。

### 服务商回调配置

在邮件设置中配置独立回调凭据（不要误填发送 API Key），然后在服务商配置以下 HTTPS 地址：

- Mailgun：`/api/v10/webhooks/mail/mailgun`；填写账户 HTTP Webhook Signing Key，订阅 delivered / permanent_fail / temporary_fail / complained / unsubscribed。HMAC-SHA256 校验 timestamp+token，允许 24 小时重试时间窗并永久事件去重至保留期；不保存服务商原始响应。
- Resend：`/api/v10/webhooks/mail/resend`；填写端点 `whsec_` 签名密钥，订阅 email.delivered / email.bounced / email.complained / email.delivery_delayed / email.failed / email.suppressed。按 Svix 原始请求体及 ID、时间戳验证 HMAC，允许 5 分钟签名时间偏差（重试重新签名），事件 ID 去重。
- SES：`/api/v10/webhooks/mail/ses`；填写允许的 SNS Topic ARN，并将发送身份或配置集的 Delivery/Bounce/Complaint 发送到同一主题。使用 HTTPS 订阅、JSON 封装（不要启用 Raw Message Delivery）。验证主题、AWS 固定区域证书地址、证书有效期与 SNS RSA 签名；证书下载不跟随重定向。只为已配置主题自动确认经过签名验证的 SubscriptionConfirmation，确认请求重建固定 AWS URL。SNS 重试复用原始时间戳，因此允许最长 23 天并去重；过期重放需人工核查。

当前每个服务商一组回调凭据/主题；两条通道使用同一服务商时建议使用同一服务商账户下不同域名/配置集/发送密钥。不同服务商账户的独立回调凭据尚未支持同时配置。SMTP 没有通用异步反馈接口，不能伪造“已送达”。

### 状态、抑制与隐私

发送状态 `accepted/failed/uncertain` 与 `delivery_status` 独立。投递状态包括 delivered（收件服务器接受，不代表用户阅读）、temporary、rejected、bounced、complained、unsubscribed。回调必须匹配本站已有 provider/message ID/收件邮箱 HMAC 后才能修改日志或抑制用户；早于发送回执的事件先保存最小字段，回执写入及每五分钟任务会重新关联。采用安全优先状态顺序，迟到 delivered 不覆盖永久退信或投诉；API 接受也不会覆盖投递状态。

Resend/SES 明确 Permanent bounce 和投诉进入全用途抑制名单；Mailgun permanent failure 还要求明确无效地址增强码 5.1.1/5.1.2/5.1.3/5.2.1，避免把 5.7.x 发送信誉问题当成用户无效地址。临时延迟和普通策略拒绝不抑制地址。后台可按邮箱精确查询脱敏名单；只有核实永久退信地址有效后可恢复发送，操作留审计，投诉不允许一键恢复。恢复不会重放历史邮件或清除服务商自身名单，旧事件重放也不能重新覆盖人工复核；发生新的永久退信仍会再次抑制。

事件只保存受控状态、provider/message ID、邮箱 HMAC、时间及处理标记，90 天分批清理。抑制记录长期保留到人工审核，不因日志清理而失效。APP_KEY 改动需要迁移 HMAC 与加密凭据，不能直接换 key 后继续群发。

后台邮件日志新增最近 24 小时发送/反馈计数及未关联事件数；统计是发送尝试口径，可能包含重试，不据此宣称最终送达率。暂无自动百分比熔断与队列等待时长图；异常时管理员可关闭公告开关。

### 升级

新增 `2026_10_14_000004_add_mail_feedback.php` 已纳入 update.sh，新安装 SQL 同步。升级后重启队列、确认调度器运行 `mail:feedback`，再配置回调和测试实际投递。不要在迁移未完成时启动新队列代码。真实服务商凭据、域名 DNS、SNS 权限、网关放行及最终投递尚需生产环境验收。


### 本轮验证结果（2026-10-14）

前端 91 个文件、524 项测试通过；Docker PHP 隔离 SQLite 回归 224 项、MySQL 回归 237 项（含并发回调去重）通过；邮件模板与限流回归 394 项通过。新安装 SQL、升级脚本 26 个隔离场景和前端生产构建通过。补偿任务只选择能匹配本站发送日志的事件，避免外部未匹配事件占满处理批次。测试使用模拟服务商响应，未发送真实邮件，也未验证生产域名 DNS、DKIM 或真实投递。


## 必要服务群发、推广与群发记录（当前）

后台用户管理群发明确选择 `service`（维护、故障及影响已有服务的调整）或 `marketing`（优惠、活动和推广）。前者使用事务通道，不要求推广订阅；后者使用推广通道、要求主动订阅并附退订链接。所有用途均排除禁用账户及永久退信/投诉停发地址。排队后再次检查邮箱 HMAC、账户与订阅状态，不把原收件任务转交给修改后的邮箱。服务通知不得混入促销内容。原有 `notify` 排队任务未带用途时仍按推广处理。用户端开关改名“活动与推广邮件”，内部字段保持兼容。

群发前检查预计发送人数及跳过原因，确认后保存清理过活动内容的正文、多语言版本、管理员、创建时间及收件人快照。后台「邮件日志 → 群发记录」查看。内容归档仅管理员可读，逐封验证码及登录凭据不归档。前端固定 UUID 作为提交幂等键；重复提交复用记录，内容冲突返回 409。收件范围分批读取、批量查询停发名单与入库。记录不会反推此前历史群发。

`mail:campaigns` 每分钟投递持久收件任务，发送沿用群发限流；丢失的队列调度十分钟后可重新派发，数据库状态防止终态重复发送。发送中断、SMTP 网络异常或服务商结果不明确标为不确定，不自动重放。明确可重试的 API 失败最多五次，任务七天到期。退信反馈保存在群发收件记录中，不随单封日志清理消失。

统计按收件人而非尝试次数：排队、发送中、接受、失败、不确定、跳过及受控投递反馈。确认送达比例为 delivered/accepted，是异步反馈时点的确认比例，不是最终收件箱到达率或打开率；回调可能缺失或未完成，SMTP 通常没有送达反馈。迟到退信或投诉优先展示，不能把 HTTP 200 当作已送达。

工单客服回复在站内通知中按工单合并，不含正文；打开并加载工单后 POST 确认已展示的回复版本，较新的回复保持未读。不新增未支付订单站内信，订单页已有待付款状态，避免重复催付。现有工单尚无回执的客服回复会显示为未读。

升级需执行 `2026_10_14_000005_add_mail_campaigns.php`（已纳入 update.sh 与新安装 SQL），重启队列并保持调度器工作。

本轮验证：前端 92 文件 528 项测试，SQLite 241 项、MySQL 257 项邮件/通知检查（含双进程群发收件任务去重），完整新安装 SQL 与 update.sh 26 个隔离场景通过。邮件模板与限流 396 项检查及生产构建通过；真实邮件、DNS 和服务商投递仍需部署后联调。


## 人工邮件禁发名单

入口为后台「风控与黑名单 → 邮件禁发名单」，与自动退信/投诉抑制分开。支持按完整邮箱添加（备注选填，可在编辑时清空）、精确搜索、禁发/已解除筛选、修改备注、解除及查看管理员操作历史。邮箱去除首尾空白并按大小写不敏感匹配，不自动扩展到同域名、加号别名或其他账户邮箱。邮箱使用 APP_KEY 加密保存，匹配使用邮箱 HMAC；名单明文仅管理员接口返回且禁止缓存。备注仅后台可见，按文本转义，不能填写验证码、密码或密钥。审计只保存操作者、目标 HMAC、动作和时间，不记录完整地址或备注。

所有站内发信入口汇入 SendEmailJob，在队列执行和实际发送前重新检查；SMTP/Mailgun/SES/Resend 均受限制，API transport 另有防绕过检查。覆盖验证码、找回密码、邮件登录、必要服务通知、工单、邀请、推广和测试邮件。后台日志记 skipped / MAIL_MANUALLY_BLOCKED，不记为服务商接受，也不调用发信网络接口。群发预览与收件记录单列 manual_blocklist 原因；当前已提交给服务商的请求无法撤回。

用户端保持既有页面、请求响应、校验和限流，不额外返回名单命中、备注或拦截原因。不会禁用账户、套餐、节点或站内通知，但用户将无法经被禁发的邮箱接收验证码或找回密码。公开页面的“请求已受理”不表示实际送达；名单不是账户封禁机制。

解除人工禁发不解除自动退信/投诉抑制，反向也如此。已跳过任务不主动补发；解除之后的新请求及尚未处理的有效任务按照当前策略处理。修改和解除采用 revision 防止多管理员覆盖，全部管理接口位于现有管理员权限组，写入限流；审核操作在数据库事务内留痕。

新增迁移 `2026_10_14_000006_add_mail_blocklist.php` 已纳入 update.sh 和新安装 SQL。先迁移再重启队列；APP_KEY 不可随意更换，否则既有 HMAC 匹配及加密地址无法继续使用。名单与审计不随普通投递日志保留策略清理。

管理接口（现有管理员前缀）：GET mail-blocklist/fetch、GET mail-blocklist/history、POST mail-blocklist/add、POST mail-blocklist/change。未新增用户侧字段或接口。

公开响应不暴露内部限制的原则参考 [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)。该功能保持现有身份校验行为，并不代表对整个认证流程完成了枚举风险整改。

禁发名单验证结果：前端 93 个文件、531 项测试通过；SQLite 343 项、MySQL 359 项通知/邮件检查通过；邮件模板与限流 396 项检查通过；完整安装 SQL、update.sh 26 个隔离场景及前端生产构建通过。拦截测试覆盖全部邮件模板与四种发送通道，所有外部邮件均模拟，未发送真实邮件。

邮件禁发名单支持多行导入：每行一个邮箱，每批最多 200 行，忽略空行、规范化大小写并去重；共用选填备注。服务端先校验全批邮箱，使用事务写入，已禁发记录跳过且保留原备注，已解除记录重新禁发，每条实际变更保留审计记录。管理员接口 POST mail-blocklist/import，限流每分钟 5 次，返回 added、skipped、duplicates 计数。
