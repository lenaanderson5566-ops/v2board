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
