# 邮件邀请与账户设置

通知设置与账户安全通过右上角头像菜单进入，也可从账户页的两个独立按钮进入。通知设置仅修改原有 `remind_expire`、`remind_traffic` 字段，账户安全沿用修改密码并退出旧会话的流程。两项功能不增加主导航。

邀请好友页使用发送邮件、跟踪邀请两个入口。邮件绑定收件邮箱，链接7天内有效且只能注册一次；数据库只保存令牌哈希，API和邀请记录不返回令牌。重发会使旧链接失效。每个收件邮箱60秒内不能重发，每位用户每天最多发送20次，同时有效的待接受邀请受 `invite_gen_limit` 控制。邀请跟踪支持最近7、30、90天，最多100条，展示排队、发送、接受、过期、发送失败状态。已发送表示邮件服务接受发送，不保证进入收件箱。

旧公开邀请码不再展示、生成或用于新注册；旧链接不再生效。历史邀请码记录没有批量删除，已有用户邀请关系和佣金计算保留。`invite_force` 仍控制是否必须受邀注册，但改为要求有效邮件邀请；`invite_never_expire` 不再用于新邀请。

## 部署

本次新增 `v2_email_invitation` 表，不增加用户表字段。请先备份数据库，再按已有发布流程更新代码。新版 `update.sh` 已包含这项迁移；使用脚本完成升级后无需再执行。若使用手动发布，在开放站点前执行：

```bash
/www/server/php/81/bin/php artisan migrate --path=database/migrations/2026_10_02_000001_create_email_invitations.php --force
/www/server/php/81/bin/php artisan route:clear
/www/server/php/81/bin/php artisan view:clear
```

迁移支持重复执行。静态资源已打包在 `public/console`，生产无需 Node.js。重启 PHP-FPM 和原队列进程以加载新任务代码，并确认 SMTP 配置、站点 `app_url` 正确，队列消费 `send_email`。注册关闭时禁止发送邀请；邮件验证、验证码和邮箱白名单规则仍然适用。

## 验证

`php tests/email-invitations.php` 仅允许本地环境，模拟邮件和队列，所有数据库写入回滚。验证邮箱绑定、强制邀请、公开码停用、注册归属、一次性接受、过期、重发令牌轮换、失败回滚、发送失败、发送限额与隔离访问。真实 SMTP 投递需在部署后单独验收。
