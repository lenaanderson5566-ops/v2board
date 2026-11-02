# 目录边界与契约生成

## FastAI 名称与升级兼容

项目展示名称和主元数据使用 FastAI，业务配置使用 `fastai.*`。`config/fastai.php` 是唯一保存目标；文件存在时整份优先，即使为空也不与旧文件逐字段合并。仅当新文件不存在时读取旧 `config/v2board.php`，避免已删除配置从旧文件重新出现。保存会写完整的新配置，不自动修改或删除旧文件；部署及备份应保留两者，不提交其中的私密内容。

后台保存从当前完整站点树开始，仅覆盖提交并通过校验的设置；未提交的自定义扩展、嵌套字段及 null、false、零、空数组保持原值。既有主题等退役字段仍按原规则清理，秘密字段的空占位仍按原规则保留已有凭据。自定义站名、URL、路径、页脚及支付渠道配置不因更名重置；手工修改配置文件后须刷新缓存，避免把旧缓存当作最新配置保存。

公开的签名 loader 独立放在受 Git 管理的 `config/entrypoint-signing.php`，读取 `entrypoint-signing.entrypoint_signing_seed`，不占用私密站点配置命名空间。它保留原 `FASTAI_ENTRYPOINT_SIGNING_SEED` 环境变量、`storage/app/fastai-entrypoint.seed` 路径和环境优先规则；修复文件名冲突不生成或替换密钥，客户端固定公钥及 serviceId 不变。历史公开 loader 曾使用 `config/fastai.php` 文件名，不能将其 seed-only 数组当作新站点配置保存或恢复。

旧缓存仅在 canonical 文件不存在且 `fastai` 树恰为单个 `entrypoint_signing_seed` 时识别为历史公开占位：签名值转入缺失的独立公开根，原 cached `v2board` 树（含空数组）优先恢复；旧缓存连该树也没有时，才读取 legacy 文件。存在 canonical 文件或多字段站点树时不触发特殊识别，已有独立签名根也不被覆盖。升级仍正常清理并重建配置缓存，不泛化合并用户配置。

配置 Repository 将旧 `v2board.*` 作为同一存储的兼容别名，旧调用的读写即时反映到 `fastai.*`，显式 null、false、零和空数组不当作缺失。配置缓存只导出主命名空间，并兼容读取旧缓存。新安装与操作文档使用 `fastai:*` 主命令，已有 `v2board:*` 命令保留别名；`fastai:update` 和旧别名均只提示使用安全的 `update.sh`，不会重放历史 SQL。

Horizon 的主 supervisor 展示名为 FastAI，现有队列名、Job 类及序列化载荷、Redis 计数/缓存/会话标识、DNS 所有权标记和每日任务持久 identity 保持兼容。网页以 `window.FASTAI` 输出运行配置，并以同一对象提供旧 `window.V2BOARD` 别名，供滚动升级或缓存中的旧资源使用；旧 boot 输入仍可读取。不要为清除旧名称而更换密钥、清缓存、改数据库表或重置任务状态。

浏览器偏好兼容读取旧存储名，跨标签会话变更、待完成退出及统计同意撤回继续同步；原 JavaScript 可读 token 只清理，不读取或迁移为认证凭据。存储不可写时不得据此绕过撤权，统计同意按有效记录时间核对，同一时刻拒绝优先。

初始化后的新旧 boot 名指向同一对象。统计同意只响应对应 API 来源的本地存储事件，忽略明确来自 sessionStorage 的事件；同一键已重新写入或 clear 后任一代已重新写入时，排队的旧删除事件不清空新选择。不能证明先后顺序的跨代删除仍优先停止采集，不以另一代残留的允许记录恢复授权。

仓库尚未改名：实际 GitHub 仓库 URL、外部协议字段、客户端构建变量及其他仓库的真实源路径保持原值。这些是升级兼容或来源引用，不是当前展示品牌；修改它们需要对应消费者迁移，不能通过文本替换虚构新地址。第三方许可和归属说明不变。

## API 契约

`api/v10/openapi.json` 是 V10 契约的模块清单与全局元数据入口；唯一可编辑定义位于 `api/v10/modules/*.json`，按业务归属维护路径与 schema，公共响应、响应头、参数及基础类型集中在 `common.json`。发布文件、PHP 字段投影和前端映射/类型均由 `python scripts/generate-v10.py` 生成。`--check` 只检查漂移，不写文件。具体元数据与七项输出见 [V10 维护说明](api-v10/README.md)。路由、控制器、请求校验和业务逻辑仍显式维护，生成结果不能代替真实路由及行为测试。

## 服务与前端组件

邮件投递、限流、模板、活动、退订和反馈服务集中在 `app/Services/Mail/`，命名空间为 `App\Services\Mail`。共享业务 Action 保留 `app/Services/Actions/`，队列入口保留 `app/Jobs/`；Job 类名、构造参数、序列化属性和队列名称保持兼容，命令主名与旧别名的规则见上节。

`frontend/src/shared/ui.tsx` 保留公共导出，实现在 `shared/ui/` 内按 `layout`、`data`、`Modal`、`Editor`、`controls` 和 `Table` 拆分。弹窗堆栈及关闭 Context 只在 Modal 模块初始化一次，避免拆分后多弹窗失去协调。管理员专用状态文案集中在现有 `admin-status.tsx`，不进入用户翻译扫描范围。

用户页面实现按总览、连接配置、结算、知识库、邀请与账户设置分布在 `DashboardPage`、`SubscribePage`、`CheckoutPages`、`KnowledgePage`、`InvitePage`、`AccountPages`，`user.tsx` 仅保留兼容导出。`user-entry.tsx` 的显式页面映射同时决定分发和统计页名，订单详情单独映射为 `order_detail`，未知页面仍回总览；原懒加载边界、订单组件 key 和购买参数保持原职责。新增页面先扩展该映射，避免再维护一份平行路由名单或长条件链。

管理员分析表格统一实现在 `admin/ReportTable.tsx`。分析页面直接引用表格模块，不为复用表格依赖整个 `OperationsAnalytics` 工作区；原模块保留兼容导出。表格继续复用共享表格容器和分页组件，权限、查询和业务字段归各分析页面维护。

管理员协议展示统一使用 `admin/ProtocolBadge.tsx` 和 `protocol-badge.css` 的固定色板，未知协议保留原文字并使用中性样式，不以颜色代替协议名称。套餐引用统一由 `admin-plan-reference.ts` 根据现有关系名或页面套餐目录解析；显示名称与提交的 ID 分离，目录读取失败及已删除引用有明确回退，不能把未知选中 ID 自动变为空值。用户、订单工作区把已加载目录传给通用列表，避免重复获取，管理员组件不从共享用户入口静态导入。

`PlanAutoTranslation` 的 Azure 语言代码与配置校验集中于同一服务，套餐说明和通用正文翻译共用。配置与语言校验仍先于空内容或同语言短路；请求构造、数字保护和安全内容校验保留原边界，不以“无需翻译”为由绕过非法配置检查。

后续目录调整按业务边界逐块进行，先查完整调用链，再迁移类及引用；不按文件体积机械拆分。保留公开导入入口，避免同时改动展示、业务和持久化协议。测试继续归入现有领域测试及 `tests/suites.json`，不为每次整理新增平行审计脚本。

## 安装与升级

Laravel 配置加载后安装统一的站点配置 Repository，HTTP/Console Kernel、业务 SQL 和迁移继续按现有边界工作。部署按 `update.sh` 刷新 Composer 自动加载、配置缓存和 Horizon/长驻进程；已排队邮件仍以原 `App\Jobs\SendEmailJob` 消费。生产环境不需要 Python。

PHP 依赖按实际运行职责划分：`linfo/linfo` 已移除；`laravel/tinker` 仅在 `require-dev`，生产 `composer install --no-dev` 不提供 `artisan tinker`。Horizon 与 Carbon 的包自动发现仍需生效，不能把它们或有实际业务调用的 JWT、YAML、MessagePack、AWS、GeoIP、HTTP 与密码学库当作未使用依赖删除。Composer 的 `post-autoload-dump` 会运行包发现；更换安装配置后应重建自动加载与发现清单，避免沿用开发依赖的缓存。

依赖更新保留既有主版本和 PHP 8.4 平台要求，以提交的 `composer.lock` 安装；不在生产服务器直接解析最新依赖。旧安全例外 `PKSA-y2cr-5h3j-g3ys` 已移除，最终安全审计须使用对应锁文件重新执行，不能只以配置检查代替审计。

本轮后端直接依赖锁定为 Laravel 13.39.0、Horizon 5.50.1、AWS SDK 3.402.5、Guzzle 7.16.1、Carbon 3.15.1、Stripe PHP 14.10.1、YAML 6.4.49，以及开发用 PHPUnit 12.5.42、Ignition 2.12.1；Mime 8.1.10 安全修复保留。移除 Linfo，Tinker 3.0.2 及其专属依赖移到开发安装。`php-curl-class` 的 Telegram/支付调用和 `sodium_compat` 的 Reality 密钥及兼容函数仍在，移除它们需要先改写对应功能并验证平台扩展。

前端锁定 React/React DOM 19.3.1、i18next 26.7.1、react-i18next 17.1.11、Ace 1.45.2 与 Prettier 3.9.10，移除旧 `@types/markdown-it` 及其专属类型依赖；Markdown 编辑器的 Nano ID 5.1.16 安全覆盖保持不变。Vite 6、TypeScript 5、Stripe PHP 14/Stripe.js 9 等既有主版本继续保留，跨主版本迁移另行设计和验证。

本轮清单与锁文件已应用；运行验证使用独立的开发/生产 vendor 与前端安装树。经验证的隔离 `public/console` 产物配套纳入发布提交，供不执行 Node 构建的 `update.sh` 部署，不能只提交源码而继续发布旧 UI。资源通过 alternate work-tree 暂存到 Git index，原共享 vendor 和本地运行中的 `public/console` 文件保持原样；提交后本地资源与新 HEAD 的差异是有意保留的运行版本，不能用 reset/checkout 自动清掉。可销毁后端环境已清理，验证日志和隔离产物保留在忽略目录；实际站点升级仍按既有部署流程执行。

自动验证配置位于 [quality.yml](../.github/workflows/quality.yml)，依赖维护配置位于 [dependabot.yml](../.github/dependabot.yml)。推送到 `master`、`main`、`codex/payment-icon-picker` 或面向这些分支的 PR 会运行检查；依赖审计、V10 契约、前端及后端沿用已有入口。Actions 固定完整提交 SHA，工作流只有仓库内容读取权限，不自动部署、合并或更改仓库设置。

当前仓库默认分支为 `master`；本次只推送 `codex/payment-icon-picker`，因此推送/PR 检查可先运行，定时审计与 Dependabot 配置须合入默认分支后才生效。GitHub 手动运行入口也依赖默认分支已有工作流；以 [GitHub 事件规则](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) 和实际 Actions 记录为准，不把本地通过记录当作远端 CI 已完成。

验证包括发布契约一致性、真实路由清单、邮件模拟投递和旧任务载荷、全新安装、旧表迁移与升级脚本；前端运行全量 Vitest、类型检查及构建。验证结果记录于 [测试组织](test-organization.md) 和 [前端验证](frontend-validation.md)。


## 代码巡检与优化边界

逐文件扫描覆盖 app 下 404 个 PHP 文件、frontend/src 下 196 个实现文件及其测试，并检查开发脚本、配置、路由和数据库脚本。扫描包括文件规模、异常吞没、重复读取、类型逃逸与引用；语法、类型和测试工具提供全局检查，人工沿调用链重点核对确认的问题。扫描覆盖不等于所有业务分支已人工逐行证明正确。

- 安装命令拒绝已有环境或非空目标数据库，使用完整 SQL 导入并传播失败状态，避免手工分号切割破坏 SQL 字符串；环境文件一次写入并正确转义，密码输入隐藏。安装失败可能保留已创建结构和环境文件，不把 MySQL DDL 描述为可事务回滚。
- GeoIP 是可选展示依赖，缺失或损坏时返回空位置，不阻断日志与会话；保留原位置数据结构。
- 支付展示目录为随版本发布的静态数据，进程内复用解析结果；部署后按原流程重启长驻进程。
- 公共请求和 CSV 下载共享错误解析与会话过期处理，忽略畸形错误字段，保留 HTTP 状态，不重放网络失败的业务请求。
- V10 生成器验证维护模块的对象形状和引用类型，错误源在生成前失败；七份发布合同保持不变。

大文件仍以职责和调用链评估：风险日志控制器、后台入口及节点/订单页面存在进一步拆分空间。其长度本身不构成故障，涉及业务查询、路由或组件状态的拆分须独立设计和验证，不在容错修复中同时改写。

## 资源清理边界

旧用户主题、旧后台 JS/CSS、图标字体、Blade 页面及一次性提取脚本已经退役，历史删除清单通过 Git 查阅，不再维护单独的清理报告。当前页面入口为 console，前端源码位于 frontend，发布产物位于 public/console；旧入口返回或跳转行为由 tests/console-smoke.php 覆盖。

支付图标、国旗、邮件模板、生成契约和发布资源可能通过配置动态引用，不能仅因文本搜索无结果删除。环境配置、上传、数据库、GeoIP、客户端安装包、vendor、node_modules 及本地运行文件不属于文档与测试清理范围。


OnlineDeviceService 统一节点在线快照的来源 IP 规范化、有效期、模式计数、逐节点替换及并发保护。NodeCommunication 负责协议输入，后台用户、个人订阅与风控读取共用该投影；流量活跃计数继续由既有流量路径维护。节点索引与用户缓存使用不同作用域的锁，保留部分失败的待清理索引；历史记录与日志写入不占用逐用户缓存临界区。
配置更新记录使用独立的 V10 SubscriptionAccessController 和 Actions/User/SubscriptionAccessActions，只读本人既有 SubscribeLog；不新增采集、业务写入或数据表。输出明确的 camelCase 私有资源，只保留白名单客户端、脱敏 IP、历史地区与请求结果。保留期在读取时生效，空时间及未知结果按未知展示，越界页跳过偏移计算和记录查询。账户安全与配置中心只放入口，完整记录页由 user-entry 的 security/configuration-updates 子路径按需加载；组件使用生成的 DTO，ISO 时间由既有显示时区格式化器处理。
