[本项目功能、接口与运维文档](docs/README.md)

<img src="https://avatars.githubusercontent.com/u/56885001?s=200&v=4" alt="logo" width="130" height="130" align="right"/>

[![](https://img.shields.io/badge/TgChat-@UnOfficialV2board讨论-blue.svg)](https://t.me/unofficialV2board)

## 本分支支持的后端
 - V2Box（本工作区的节点后端）
 - [V2Box](https://github.com/lenaanderson5566-ops/v2box)

后台仅保留这两类节点；底层协议在节点内选择。旧独立节点类型已退役，旧配置表将在升级时删除，升级前请迁移仍在使用的线路。参见 [节点接入与类型说明](docs/v2box.md)。

## 本分支安装与升级

以 [当前分支升级流程](docs/update-script.md) 为准。目标分支为 `codex/payment-icon-picker`；不要切换到上游 master 或更改远程地址来升级此分支。

升级前统一 CLI、PHP-FPM、队列和调度使用的 PHP 8.4+，完成数据库备份，并先运行新版 `update.sh --check`。正式升级按脚本白名单执行迁移、更新依赖、验证前端产物和处理工作进程。自动维护与 `--jobs-stopped` 手动维护的差别、外部脚本下载方式及回滚要求见上述文档。

新安装使用 [全新安装流程](docs/update-script.md#全新安装空数据库) 和本分支 SQL，由 `php artisan v2board:install` 创建环境与管理员；不要对旧站重跑安装器。部署站点的 Web 根目录必须指向 `public`。前后台使用配套的 `public/console` 构建资源，不再使用旧版主题切换步骤。目录边界和 API 契约生成见 [项目结构说明](docs/project-structure.md)。

# **V2Board**

- PHP 8.4+（CLI、PHP-FPM、队列使用相同版本）
- Laravel 13.35.0（升级说明见 [Laravel 13 升级](docs/laravel13-upgrade.md)）
- Composer 2.2+
- MySQL 5.7+
- Redis
- Laravel

## Demo
[Demo_user](https://v2bdemo.v-50.me/)
[Demo_admin](https://v2bdemo.v-50.me/admindashboard)
邮箱和密码可随意输入

## Document
本分支操作以 [项目文档](docs/README.md) 为准；[上游文档](https://v2board.com) 仅供历史背景参考，不能直接套用其分支、PHP 或升级命令。

## Sponsors
Thanks to the open source project license provided by [Jetbrains](https://www.jetbrains.com/)

## Community
🔔Telegram Group: [@unofficialV2board](https://t.me/unofficialV2board)  

## How to Feedback
Follow the template in the issue to submit your question correctly, and we will have someone follow up with you.
