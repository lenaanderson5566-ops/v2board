# Laravel 13 升级

本分支从 Laravel 12 升级至 13，并在同主版本内继续更新依赖；具体版本以提交的 composer.lock 为准。项目要求 PHP 8.4+、Composer 2.2+、MySQL 5.7+（本地验证使用 MySQL 8）；生产部署使用 install，不在服务器直接 update。CLI、PHP-FPM、Horizon、调度器应使用同一 PHP 版本。保留现有 .env、APP_KEY、config/fastai.php、数据库、上传目录与 GeoIP 数据，不重新安装面板。

## 上线步骤

1. 在测试环境复制数据库和配置，备份生产数据库、代码、vendor、配置及上传文件。先确认 CLI 与 FPM 均满足 `composer check-platform-reqs --lock --no-dev`，PHP 扩展满足锁文件要求。
2. 使用本分支的 update.sh，从网站目录外执行。先 `bash /private/update.sh --project /path/to/site --branch codex/payment-icon-picker --php /path/to/php --composer /path/to/composer.phar --check`。脚本默认读取目标提交的 composer.lock；有额外本地 Composer 包时，应在隔离环境生成并测试合并锁，再用 `--lock-file /private/tested-composer.lock`。不要关闭安全检查来在线解析依赖。
3. 预检通过后执行相同命令去掉 `--check`。默认自动模式备份文件、维护停机、排空本网站队列、安装锁定依赖、执行批准的迁移、验证前端，确认后台进程稳定后恢复原本开放的站点；`--jobs-stopped` 或升级前已维护时成功后也保留维护。数据库备份可通过 `--database-backup` 一并归档。外部进程管理器应使用自己的停止/启动流程，避免自动拉起旧队列。
4. 验证 `php artisan --version` 与目标锁文件中的 Laravel 版本一致，检查登录、注册验证码、后台编辑、支付回调、节点配置与流量上报、DDNS和日志清理；用受控邮箱确认真实 SMTP 发送。
5. 失败时保持维护模式。框架依赖回退应同时恢复旧代码与对应 vendor/lock；已经执行的数据库迁移（尤其旧节点表删除）不可盲目回滚，应根据备份和迁移内容人工恢复。

## 兼容性变化

- 保留原有应用目录、Kernel、服务提供者和既有 API 合约，不重新安装面板。
- 继续使用 Carbon 3；日期调用明确指定时区，额度到期与流量重置通过业务回归验证。
- 保留已有缓存前缀、分布式锁及显式本地磁盘根目录 storage/app，避免缓存命名空间和文件路径变化。
- 项目不使用 HasUuids、默认依赖注入日期或数据库密码令牌构造器；原有 UUID 和认证流程继续使用。
- Banner 上传原本就不允许 SVG，继续只允许指定的位图格式。
- 测试依赖更新至 PHPUnit 12（开发环境 PHP 8.4+）、Collision 8.9，当前 PHPUnit 仅运行纯单元测试；框架及 HTTP 集成检查归入 tests/suites.json 的独立测试脚本。
- Tinker 3 仅作为开发依赖保留；生产 `--no-dev` 安装不提供 `artisan tinker`，部署和健康检查不依赖该命令。未使用的 Linfo 已移除；Horizon/Carbon 的包发现及既有业务依赖保留。
- 框架使用的主要 Symfony 组件为 8，YAML 等独立库保留既有主版本；生产 PHP 最低要求为 8.4。更换开发/生产安装配置后须重新生成自动加载与包发现清单，不能复用残留开发 Provider。
- cache.serializable_classes=false：缓存只恢复数组和标量，不恢复任意 PHP 对象；节点在线状态、登录会话和验证码继续使用原有数据格式。
- 框架会话显式保留 PHP 序列化格式，避免此次升级强制失效旧会话；V10 自定义浏览器会话的 CSRF、Origin 和 HttpOnly 规则继续执行。
- 浏览器 API 由 `App\Http\Middleware\BrowserSession` 按路由和客户端类型执行 Origin 与 CSRF 校验。支付回调和节点 API 沿用各自的验证流程。
- 原有 upsert 使用明确的唯一键；模型 boot 回调不在启动过程中递归实例化模型。

## 部署失败后保留维护模式

使用升级脚本的自动模式时，先在本站进程管理器（如宝塔 Supervisor）启用 Horizon/队列和调度器的自动重启，并确认 PHP 路径与站点 PHP-FPM 一致。若 `restart-jobs` 失败，检查对应进程日志并修复启动。确认后台进程正常并重启本站 PHP-FPM 后，再执行 `php artisan up` 恢复访问。使用 `--jobs-stopped` 手动模式时，按[升级脚本的恢复步骤](update-script.md)恢复进程和访问。

## 依赖与测试

依赖解析保持 Composer 安全阻断开启，生产使用已验证 composer.lock 执行 install。部署前运行 composer check-platform-reqs --lock --no-dev。update.sh 不会安装系统 PHP，PHP 8.4 可用于本次升级。保留 APP_KEY、配置、数据库与上传目录。

框架回归：php tests/framework-upgrade.php；缓存兼容：php tests/cache-prefix-upgrade.php；日志回归：php tests/log-management.php；部署回归：bash tests/update-script.sh。真实 SMTP 和支付回调仍应在上线后使用受控账号验证。

官方升级指南：https://laravel.com/framework/docs/13.x/upgrade

旧 `audit.ignore` 项 `PKSA-y2cr-5h3j-g3ys` 已移除。发布前须对最终锁文件分别执行生产和全依赖的 Composer audit，并记录实际结果；历史审计无公告或废弃包的输出不代表当前锁文件已验证，也不是持续安全保证。静态测试只检查旧例外不再存在，不能替代公告审计。

`framework-upgrade` 支持独立的开发和生产安装树，检查直接依赖与锁文件一致、Laravel 至少为 13.39 且与安装版本一致，并验证邮件、代理、调度、旧任务和迁移的兼容性。生产安装排除 Tinker 和 Linfo，开发安装保留 Tinker。首页和后台入口的 `console-smoke` 使用开发测试依赖，在隔离的开发安装中运行。执行入口见[测试组织](test-organization.md)。

## 本次实际采用的特性

Lightsail 静态 IP 任务使用 Laravel 13 队列属性 Connection、Queue、Tries、Timeout，让连接、队列、单次执行和超时配置随任务定义，并通过真实队列 payload 验证。事务 afterCommit 与原子锁用于消除提交竞态、重复操作；它们已有历史版本支持，不应误称为 13 独有特性。

目前可以逐步沿用这套声明方式完善邮件、下载和节点维护任务，但这些队列已有不同的超时与连接约定，不做机械转换。现有 V10 明确资源投影与客户端合同保持不变；JSON:API 会改变响应合同，现阶段不替换。AI SDK 与向量搜索暂无新增业务需求，未引入额外依赖和开销。

官方发布说明：https://laravel.com/docs/13.x/releases

框架升级时曾保留的 UniProxy 和 V2 配置接口现已退役。节点使用 V10 通信。

## 旧版一次性流量迁移失败后恢复

如果 `2026_10_02_000005_create_traffic_credits` 报 `v2_credit_batch` 不存在，使用修复后的代码重新运行完整 `bash update.sh`（保留原有参数）。
早期转换迁移会先创建批次表；后续批次补录仅补尚未覆盖的余额，重跑不会重复发放，已存在的过期批次也不会被续期。
不要删除已完成迁移记录或直接运行无路径限制的 `artisan migrate`。
升级失败后的维护状态会保留；仅在完整升级成功并确认队列、计划任务恢复后，使用对应 PHP 执行 `php artisan up`。

旧版数据库缺少 `v2_login_log` 等早期运维表时，升级脚本先执行 `2026_10_11_000000_ensure_operations_schema` 补齐日志、风控、客户端策略、在线快照与套餐翻译结构。
已有表、策略和黑名单保留，不重放历史默认 UA 黑名单；在线快照只保留每用户/来源最新记录。
`index_log_metadata` 可恢复部分完成的字段/索引创建，失败后重新运行完整升级脚本即可，无需手动删列、删索引或删迁移记录。

## 旧升级文档归并

Laravel 9–12 的过渡部署步骤不再单独保留，完整历史可通过 Git 查阅。仍适用的兼容边界为：保留可信代理白名单、SMTP 地址控制字符校验、安全日志脱敏、原缓存前缀与锁命名空间，以及已有会话和额度日期语义。当前框架、Carbon 和 PHP 依赖以 composer.lock 及平台预检为准，不沿用旧版约束或历史临时安全审计参数。

PHPUnit 的断言工具测试位于 `tests/Unit/AssertionsTest.php`。
