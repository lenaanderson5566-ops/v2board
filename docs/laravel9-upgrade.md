# Laravel 9 过渡升级

这是上一阶段的历史说明；当前分支升级步骤见 [Laravel 10 升级](laravel10-upgrade.md)。

本分支从 Laravel 8 升级至 9.52.22。项目要求 PHP 8.1+；依赖锁定在提交的 composer.lock，生产部署使用 install，不在服务器直接 update。CLI、PHP-FPM、Horizon、调度器应使用同一 PHP 版本。保留现有 .env、APP_KEY、config/v2board.php、数据库、上传目录与 GeoIP 数据，不重新安装面板。

## 上线步骤

1. 在测试环境复制数据库和配置，备份生产数据库、代码、vendor、配置及上传文件。先确认 CLI 与 FPM 均满足 `composer check-platform-reqs --lock --no-dev`，PHP 扩展满足锁文件要求。
2. 使用本分支的 update.sh，从网站目录外执行。先 `bash /private/update.sh --project /path/to/site --branch codex/payment-icon-picker --php /path/to/php --composer /path/to/composer.phar --check`。脚本默认读取目标提交的 composer.lock；有额外本地 Composer 包时，应在隔离环境生成并测试合并锁，再用 `--lock-file /private/tested-composer.lock`。不要关闭安全检查来在线解析依赖。
3. 预检通过后执行相同命令去掉 `--check`。脚本备份文件、维护停机、排空本网站队列、安装锁定依赖、执行批准的迁移、验证前端、重启后台进程并恢复访问。数据库备份可通过 `--database-backup` 一并归档。外部进程管理器应使用自己的停止/启动流程，避免自动拉起旧队列。
4. 验证 `php artisan --version` 显示 9.52.22，检查登录、注册验证码、后台编辑、支付回调、节点配置与流量上报、DDNS和日志清理；用受控邮箱确认真实 SMTP 发送。
5. 失败时保持维护模式。框架依赖回退应同时恢复旧代码与对应 vendor/lock；已经执行的数据库迁移（尤其旧节点表删除）不可盲目回滚，应根据备份和迁移内容人工恢复。

## 兼容性变化

- 使用 Laravel 内置 TrustProxies 和明确的转发头位掩码，继续仅信任配置的代理。
- 邮件组件改为 Symfony Mailer，SMTP 拒绝通过异常处理；原有 MAIL_DRIVER 及后台 SMTP 设置继续有效，也支持 MAIL_MAILER。
- 使用 Laravel 原生视图异常及新版 Ignition、Collision；Flysystem 升级至 3，Symfony 组件升级至 6.4。
- 部署迁移白名单包含 sing-box 配置、独立路由、DDNS 和日志索引迁移。

## 安全限制

Laravel 9 已停止常规安全支持，本次升级是过渡，不是最终安全升级。Composer audit 仍会报告框架公告；未在项目配置增加忽略项或关闭安全阻断。本地生成过渡锁时临时使用 `--no-security-blocking`，生产安装使用已验证的锁，不能把安装成功理解为审计通过。

- GHSA-5vg9-5847-vvmq：邮件地址 CRLF 注入。应用校验器拒绝 ASCII 控制字符和空白，邮件任务发送前重新验证旧地址；这是应用层缓解，不是框架补丁。
- GHSA-jh5r-qr3c-85q8：调试页 XSS。生产必须设置 APP_DEBUG=false，并清理旧配置缓存后确认生效。
- GHSA-crmm-hgp2-wgrp：临时签名 URL 路径混淆。当前应用未使用签名 URL 业务路由，未来引入前须升级框架或修复。
- GHSA-78fx-h6xr-vch4：通配符文件校验绕过。当前上传接口使用明确的单文件字段；不要依赖通配符数组规则保护上传。

后续应继续逐个大版本升级到仍受支持的 Laravel，重新评估 PHP 版本和所有框架公告。

官方指南：https://laravel.com/docs/9.x/upgrade
