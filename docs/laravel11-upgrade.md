# Laravel 11 过渡升级

历史记录；当前升级说明见 [Laravel 12](laravel12-upgrade.md)。

本分支从 Laravel 10 升级至 11.57.0。项目要求 PHP 8.2+、Composer 2.2+、MySQL 5.7+（本地验证使用 MySQL 8）；依赖锁定在提交的 composer.lock，生产部署使用 install，不在服务器直接 update。CLI、PHP-FPM、Horizon、调度器应使用同一 PHP 版本。保留现有 .env、APP_KEY、config/v2board.php、数据库、上传目录与 GeoIP 数据，不重新安装面板。

## 上线步骤

1. 在测试环境复制数据库和配置，备份生产数据库、代码、vendor、配置及上传文件。先确认 CLI 与 FPM 均满足 `composer check-platform-reqs --lock --no-dev`，PHP 扩展满足锁文件要求。
2. 使用本分支的 update.sh，从网站目录外执行。先 `bash /private/update.sh --project /path/to/site --branch codex/payment-icon-picker --php /path/to/php --composer /path/to/composer.phar --check`。脚本默认读取目标提交的 composer.lock；有额外本地 Composer 包时，应在隔离环境生成并测试合并锁，再用 `--lock-file /private/tested-composer.lock`。不要关闭安全检查来在线解析依赖。
3. 预检通过后执行相同命令去掉 `--check`。脚本备份文件、维护停机、排空本网站队列、安装锁定依赖、执行批准的迁移、验证前端、重启后台进程并恢复访问。数据库备份可通过 `--database-backup` 一并归档。外部进程管理器应使用自己的停止/启动流程，避免自动拉起旧队列。
4. 验证 `php artisan --version` 显示 11.57.0，检查登录、注册验证码、后台编辑、支付回调、节点配置与流量上报、DDNS和日志清理；用受控邮箱确认真实 SMTP 发送。
5. 失败时保持维护模式。框架依赖回退应同时恢复旧代码与对应 vendor/lock；已经执行的数据库迁移（尤其旧节点表删除）不可盲目回滚，应根据备份和迁移内容人工恢复。

## 兼容性变化

- 保留现有应用目录、Kernel 和服务提供者结构，遵循官方升级建议。
- Redis、Memcached、DynamoDB 显式保留 Laravel 10 自动添加的缓存前缀冒号，已有缓存与锁继续使用原来的键；其他缓存驱动保持原前缀。
- Carbon 显式锁定在 2.73 系列，保留到期时间、流量周期和日期差值的既有行为。
- Symfony 组件升级至 7，PHPUnit 升级至 10.5、Collision 升级至 8；测试扩展迁移到事件订阅接口。
- 原有 Monolog 3、安全日志、邮件校验和代理信任配置继续使用。
- 本次不新增数据库迁移，部署迁移白名单继续包含 sing-box 配置、独立路由、DDNS 和日志索引迁移。

## 安全限制

Laravel 11 已停止常规安全支持，本次升级是过渡，不是最终安全升级。Composer audit 当前报告 4 条框架公告（其中两条指向同一邮件 CRLF 问题）；未在项目配置增加忽略项或关闭安全阻断。本地生成过渡锁时临时使用 `--no-security-blocking`，生产安装使用已验证的锁，不能把安装成功理解为审计通过。

- GHSA-5vg9-5847-vvmq：邮件地址 CRLF 注入。应用校验器拒绝 ASCII 控制字符和空白，邮件任务发送前重新验证旧地址；这是应用层缓解，不是框架补丁。
- GHSA-jh5r-qr3c-85q8：调试页 XSS。生产必须设置 APP_DEBUG=false，并清理旧配置缓存后确认生效。
- GHSA-crmm-hgp2-wgrp：临时签名 URL 路径混淆。当前应用未使用签名 URL 业务路由，未来引入前须升级框架或修复。
- Laravel 11.57.0 已包含 GHSA-78fx-h6xr-vch4 文件校验绕过的上游修复。

后续应继续逐个大版本升级到仍受支持的 Laravel，重新评估 PHP 版本和所有框架公告。

官方指南：https://laravel.com/docs/11.x/upgrade

数据库支持：https://laravel.com/docs/11.x/database

## 测试兼容

框架回归入口为 `php tests/framework-upgrade.php`，缓存和分布式锁兼容验证为 `php tests/cache-prefix-upgrade.php`，日志回归为 `php tests/log-management.php`。PHPUnit 10 使用独立配置缓存并在执行结束后清理。部署脚本回归为 `bash tests/update-script.sh`。

update.sh 会根据目标锁文件预检 PHP 与扩展要求；PHP 8.1 的服务器应先升级到 PHP 8.2 或更高版本。脚本不会安装系统 PHP，也不会替代 PHP-FPM 的重启。升级完成后确认 CLI、FPM、队列和调度器版本一致，并重启 PHP-FPM。

本地验证环境：PHP 8.2.34、MySQL 8、Redis 7。框架 19 项、升级前 Redis 缓存与锁 7 项、日志 43 项、PHPUnit 2 项，以及 V10/登录/节点/DDNS/邮件/支付/后台/额度到期与重置回归全部通过。升级脚本 25 个隔离场景及队列排空检查通过，生产依赖平台检查和 install dry-run 通过。SMTP 使用测试传输，未发送真实邮件或支付请求。
