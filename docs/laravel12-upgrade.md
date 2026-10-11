# Laravel 12 升级

本分支从 Laravel 11 升级至 12.69.3。项目要求 PHP 8.2+、Composer 2.2+、MySQL 5.7+（本地验证使用 MySQL 8）；依赖锁定在提交的 composer.lock，生产部署使用 install，不在服务器直接 update。CLI、PHP-FPM、Horizon、调度器应使用同一 PHP 版本。保留现有 .env、APP_KEY、config/v2board.php、数据库、上传目录与 GeoIP 数据，不重新安装面板。

## 上线步骤

1. 在测试环境复制数据库和配置，备份生产数据库、代码、vendor、配置及上传文件。先确认 CLI 与 FPM 均满足 `composer check-platform-reqs --lock --no-dev`，PHP 扩展满足锁文件要求。
2. 使用本分支的 update.sh，从网站目录外执行。先 `bash /private/update.sh --project /path/to/site --branch codex/payment-icon-picker --php /path/to/php --composer /path/to/composer.phar --check`。脚本默认读取目标提交的 composer.lock；有额外本地 Composer 包时，应在隔离环境生成并测试合并锁，再用 `--lock-file /private/tested-composer.lock`。不要关闭安全检查来在线解析依赖。
3. 预检通过后执行相同命令去掉 `--check`。脚本备份文件、维护停机、排空本网站队列、安装锁定依赖、执行批准的迁移、验证前端、重启后台进程并恢复访问。数据库备份可通过 `--database-backup` 一并归档。外部进程管理器应使用自己的停止/启动流程，避免自动拉起旧队列。
4. 验证 `php artisan --version` 显示 12.69.3，检查登录、注册验证码、后台编辑、支付回调、节点配置与流量上报、DDNS和日志清理；用受控邮箱确认真实 SMTP 发送。
5. 失败时保持维护模式。框架依赖回退应同时恢复旧代码与对应 vendor/lock；已经执行的数据库迁移（尤其旧节点表删除）不可盲目回滚，应根据备份和迁移内容人工恢复。

## 兼容性变化

- 保留原有应用目录、Kernel、服务提供者和既有 API 合约，不重新安装面板。
- Laravel 12 使用 Carbon 3；日期调用明确指定时区，额度到期与流量重置通过业务回归验证。
- 保留已有缓存前缀、分布式锁及显式本地磁盘根目录 storage/app，避免缓存命名空间和文件路径变化。
- 项目不使用 HasUuids、默认依赖注入日期或数据库密码令牌构造器；原有 UUID 和认证流程继续使用。
- Banner 上传原本就不允许 SVG，继续只允许指定的位图格式。
- 测试依赖更新至 PHPUnit 11.5（开发环境 PHP 8.3+）、Collision 8.9，保留事件订阅扩展与独立测试缓存。
- 本次不新增数据库迁移。

## 部署失败后保留维护模式

升级脚本要求本站后台进程能够自动重启。先在宝塔 Supervisor 开启本站 Horizon/队列和调度器的 autorestart，并确认 PHP 路径与站点 PHP-FPM 一致。若出现 restart-jobs 失败，检查对应进程日志并修复启动，不必重复安装依赖；确认运行正常、重启本站 PHP-FPM 后再执行 php artisan up 恢复访问。不要在任务仍未恢复时自动解除维护模式。

## 依赖与测试

依赖解析保持 Composer 安全阻断开启，生产使用已验证 composer.lock 执行 install。部署前运行 composer check-platform-reqs --lock --no-dev。update.sh 不会安装系统 PHP，PHP 8.4 可用于本次升级。保留 APP_KEY、配置、数据库与上传目录。

框架回归：php tests/framework-upgrade.php；缓存兼容：php tests/cache-prefix-upgrade.php；日志回归：php tests/log-management.php；部署回归：bash tests/update-script.sh。真实 SMTP 和支付回调仍应在上线后使用受控账号验证。

官方升级指南：https://laravel.com/framework/docs/12.x/upgrade

当前锁文件 Composer audit：无安全公告、无废弃包，未新增忽略项。

本地验证：PHP 8.4.26、MySQL 8、Redis 7。框架/缓存/日志、额度到期/周期/重置/订阅日期、V10/认证/权限、节点/独立路由/DDNS/Naive、邮件/支付/后台/Banner/注册全部通过。PHPUnit 11 严格检查通过（2 tests、2 assertions，无 risky 或 warning）；扩展准备应用在缓存预热后清理全局处理器状态。升级脚本 25 个隔离场景与本站队列排空检查通过，生产依赖平台检查及 install dry-run 通过。未发送真实邮件或支付请求。
