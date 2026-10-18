# 目录边界与契约生成

## API 契约

`api/v10/openapi.json` 是 V10 契约的唯一维护源；发布文件、PHP 字段投影和前端映射/类型均由 `python scripts/generate-v10.py` 生成。`--check` 只检查漂移，不写文件。具体元数据与七项输出见 [V10 维护说明](api-v10/README.md)。路由、控制器、请求校验和业务逻辑仍显式维护，生成结果不能代替真实路由及行为测试。

## 服务与前端组件

邮件投递、限流、模板、活动、退订和反馈服务集中在 `app/Services/Mail/`，命名空间为 `App\Services\Mail`。共享业务 Action 保留 `app/Services/Actions/`，队列入口保留 `app/Jobs/`；本次不改变 Job 类名、构造参数、序列化属性、队列名称或定时命令。

`frontend/src/shared/ui.tsx` 保留公共导出，实现在 `shared/ui/` 内按 `layout`、`data`、`Modal`、`Editor`、`controls` 和 `Table` 拆分。弹窗堆栈及关闭 Context 只在 Modal 模块初始化一次，避免拆分后多弹窗失去协调。管理员专用状态文案集中在现有 `admin-status.tsx`，不进入用户翻译扫描范围。

后续目录调整按业务边界逐块进行，先查完整调用链，再迁移类及引用；不按文件体积机械拆分。保留公开导入入口，避免同时改动展示、业务和持久化协议。测试继续归入现有领域测试及 `tests/suites.json`，不为每次整理新增平行审计脚本。

## 安装与升级

本次保持 Laravel 启动骨架、Provider 注册、HTTP/Console Kernel、安装 SQL、迁移和 `update.sh` 不变。部署使用正常 Composer 自动加载刷新、缓存清理与 Horizon/长驻进程重启流程；已排队邮件仍以原 `App\Jobs\SendEmailJob` 消费。生产环境不需要 Python。

验证包括发布契约一致性、真实路由清单、邮件模拟投递和旧任务载荷、全新安装、旧表迁移与升级脚本；前端运行全量 Vitest、类型检查及构建。验证结果记录于 [测试组织](test-organization.md) 和 [前端验证](frontend-validation.md)。
