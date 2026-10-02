# 宝塔分支升级脚本

`update.sh` 默认目标为 `codex/react-typescript-console`，适用于已运行的 Git 安装。保留 `.env`、APP_KEY、`config/v2board.php`、用户数据及既有会话，不删除 Composer 锁文件，不切回 master。使用现有 Composer 和与网站一致的 PHP。

## 先准备

1. 在与生产一致的 PHP 环境验证目标分支，准备对应的 `composer.lock`。本仓库忽略锁文件，所以脚本不会在生产自动解析依赖；锁文件与目标 composer.json 不一致会停止。
2. 暂停站点写入、原队列和定时任务，完成数据库备份，放在站点目录之外。可先用原代码执行 `php artisan down`；脚本接受并保留已有维护模式。
3. 使用网站服务账户执行；如用 root，默认仅将 `storage` 和 `bootstrap/cache` 属主设为 www，可用 `--web-user` 调整。不递归修改整个站点属主。
4. 把新版脚本下载至 checkout 之外；旧分支里的旧 update.sh 不能用于这次升级。脚本不接受有未提交 tracked-file 修改的 checkout。

示例路径均需替换为实际值，PHP 版本应与网站 PHP-FPM 一致：

```bash
curl -fL https://raw.githubusercontent.com/lenaanderson5566-ops/v2board/codex/react-typescript-console/update.sh \
  -o /tmp/v2board-update.sh

bash /tmp/v2board-update.sh \
  --project /www/wwwroot/你的站点 \
  --php /www/server/php/82/bin/php \
  --composer /实际路径/composer.phar \
  --lock-file /www/backup/目标分支已验证的composer.lock \
  --check
```

预检会 fetch 指定远程分支并固定该次提交，验证锁文件、PHP 扩展和迁移差异，并只读检查手动赋额账户。它不切换代码、不进入维护、不安装依赖、不迁移数据库。

如果有未绑定套餐、但未封禁且仍有正额度和有效期的账户，当前目标前端存在兼容限制；预检会停止，需先解决兼容，避免直接升级后隐藏这些老用户的导入入口。

完成写入暂停、队列／调度暂停、数据库备份后，执行正式升级：

```bash
bash /tmp/v2board-update.sh \
  --project /www/wwwroot/你的站点 \
  --php /www/server/php/82/bin/php \
  --composer /实际路径/composer.phar \
  --lock-file /www/backup/目标分支已验证的composer.lock \
  --database-backup /www/backup/本次维护窗口数据库备份.sql.gz \
  --backup-dir /www/backup/v2board-upgrades \
  --jobs-stopped
```

`--jobs-stopped` 是操作者对实际暂停状态的声明，脚本不猜测或停止其他站点的 Supervisor 进程，也不改 cron。数据库备份必须存在且非空；脚本不能证明该备份可恢复，应事先演练恢复。数据库备份与锁文件不上传到 Git。

## 执行范围

- 在私有目录保存原提交编号、原分支、配置校验和、数据库备份副本及站点归档（包含原 vendor、lock、配置、storage；排除 .git 和 node_modules）。归档校验失败即停止。
- 仅允许目标分支快进；本地目标分支若有额外提交会停止，不执行 reset --hard。
- 从经过预检的锁文件 install 依赖，检查运行平台；不下载 Composer、不执行 composer update 或 require。
- 仅运行 `2026_10_01_000001_add_trusted_x_forwarded_for_to_v2node.php`。该迁移已做字段存在检查，已执行或字段已存在时不会重复 ADD。发现其他迁移差异会停止并要求单独审查。
- 不运行历史 update.sql、v2board:update、migrate:fresh、cache:clear、optimize:clear 或 Redis 清空。配置、路由、视图缓存单独处理。
- 校验生产 `.env` 和业务配置内容没有变化。使用私有备份权限，同时确保新发布的 PHP／静态文件对网站进程可读。

## 完成及失败处理

脚本会运行 `php artisan console:verify` 校验清单引用的全部静态资源，以及首页、用户页、后台页实际生成的 React HTML。返回旧后台 HTML 或缺少静态资源时升级失败并保持维护；不会仅因文件存在就报告完成。该校验通过 CLI 执行页面动作，不关闭维护保护，不替代 PHP-FPM 重启及公网检查。

如首页返回 403，可执行 `php artisan console:verify --host=实际访问域名` 检查安全模式的域名匹配。若域名不是后台配置的 app_url 域名，应核对实际站点用途及域名设置，不直接关闭安全模式。公网仍加载 umi.js 时，检查宝塔实际运行目录、PHP-FPM 缓存及线上代码分支。

成功也保留维护模式。按输出提示在宝塔重启该站点 PHP-FPM，再执行指定 PHP 的 `artisan up`，验收登录、四类账户、订阅、节点、支付回调、后台及静态资源。验收通过再启动原队列和调度。

失败即停止；已进入维护时不自动开放站点、不自动恢复数据库或强制回滚代码。备份的 `DEPLOYMENT.txt` 和 `old-commit.txt` 提供回滚信息。原依赖、配置和源文件在 `site.tar.gz` 中，可有选择地恢复；不要覆盖上线后新增的上传或订单。新增可空字段通常可以保留，不必删除以回滚代码。

## 测试

`bash tests/update-script.sh /绝对路径/update.sh` 创建隔离 Git 仓库并使用 PHP／Composer／Artisan 替身，覆盖 8 个场景：只预检、脏工作区、锁校验失败、手动额度兼容阻断、未暂停任务、正常升级、依赖安装失败及已有维护模式。验证备份包含原依赖、配置不变、迁移范围、新资源读取权限、失败保持维护和无缓存清空。此测试不代表真实生产依赖或数据库备份已通过验收。
