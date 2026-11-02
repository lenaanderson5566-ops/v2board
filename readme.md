# FastAI

[功能、接口与运维文档](docs/README.md) · [项目仓库](https://github.com/lenaanderson5566-ops/v2board)

FastAI 提供账户、订阅、订单支付、流量额度、节点和运营管理。项目使用 FastAI 名称；实际 GitHub 仓库地址保持不变，升级不要更改远程地址。

## 运行要求

- PHP 8.4+（CLI、PHP-FPM、队列和调度使用相同版本）
- Laravel 13（具体版本以 `composer.lock` 为准，见 [升级说明](docs/laravel13-upgrade.md)）
- Composer 2.2+、MySQL 5.7+、Redis

## 节点后端

支持 [V2Box](https://github.com/lenaanderson5566-ops/v2box)，底层协议在节点内选择。旧独立节点类型已退役，升级前迁移仍在使用的线路；旧表清理和接入要求见 [节点说明](docs/v2box.md)。

## 安装与升级

以 [当前分支升级流程](docs/update-script.md) 为准。目标分支为 `codex/payment-icon-picker`，不要切到其他分支或更改远程地址来升级此分支。

新安装使用 [空数据库安装流程](docs/update-script.md#全新安装空数据库)，通过 `php artisan fastai:install` 创建环境与管理员；旧站不要重跑安装器。Web 根目录必须指向 `public`，前后台使用配套 `public/console` 资源，不采用旧主题切换步骤。

旧站先备份数据库，统一 PHP 版本，再运行新版 `update.sh --check`。正式升级按白名单迁移、安装锁定依赖、核对前端产物并处理工作进程。自动维护、`--jobs-stopped`、下载脚本及回滚条件见升级文档。

业务配置主命名空间为 `fastai.*`，保存文件为 `config/fastai.php`；旧配置和命令通过明确兼容入口保留，不能为改名删除现有私密文件或清空状态。规则见 [名称与升级兼容](docs/project-structure.md#fastai-名称与升级兼容)。

## 反馈

请使用仓库 Issue 模板，附复现步骤及脱敏的版本和日志，不公开账号凭据、订阅链接或实例配置。
