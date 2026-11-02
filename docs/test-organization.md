# 测试组织与执行

本文维护执行入口、隔离要求、领域覆盖和验收边界。当前是否通过必须绑定目标提交及实际执行结果；历轮数量、旧发布结果和本机临时目录通过 Git 与原始日志查阅，不累积为操作说明。交互及人工检查详见 [前后台验证](frontend-validation.md)。

## 执行入口

| 类型 | 维护位置与用途 |
| --- | --- |
| 后端 | `tests/suites.json` 登记 unit、integration、api、security、regression；`tests/run.php` 校验清单、筛选并启动独立进程。 |
| 辅助项 | 工作进程、浏览器夹具、配置导出和公共工具登记在 `helpers`，不作为独立测试。 |
| PHPUnit | `tests/Unit/AssertionsTest.php` 验证公共断言工具，不启动 Laravel。 |
| 前端 | Vitest 与 `frontend/src` 组件/模块就近存放；专题命令以 `frontend/package.json` 为准。 |
| V10 生成器 | `scripts/test_generate_v10.py` 验证生成规则；源和发布物边界见 [项目结构](project-structure.md)。 |
| 客户端与节点 | FlClash 的 Flutter 根测试不自动覆盖全部插件；Go 包内测试、节点脚本及构建矩阵按各自仓库说明和 CI 执行。 |

以下命令均在已经准备好的可销毁副本中运行，实际后端执行还须满足下一节条件：

```sh
php tests/run.php --validate
php tests/run.php --list
php tests/run.php --suite=security
php tests/run.php --only=mfa,mfa-api,mfa-concurrency
python scripts/generate-v10.py --check
python -m unittest discover -s scripts -p test_generate_v10.py
cd frontend
npm ci --include=dev --ignore-scripts
npm test
npm run build
```

`npm run build` 包含 TypeScript、Vite 和前后台资源拆分，会写副本的 `public/console`；不要在正在服务的目录运行它。生成契约只能修改模块源和映射源，再生成全部七份发布物，不能为让测试通过而直接编辑生成结果。接口清单、路由和互操作验证见 [V10 审计](api-v10/audit.md)。

## 隔离与清理

- 后端实际执行必须使用独立、可销毁的项目副本、local/testing 环境及 `TEST_DISPOSABLE_WORKSPACE=1`。副本不携带生产 `.env`、站点配置、实例自定义模板或 bootstrap 缓存；需要模板的测试自行创建合成夹具。部分检查会改文件或迁移 schema，仅换数据库名不足以隔离。
- MySQL 测试账号须能创建/删除随机测试库；不为测试提升线上应用账号权限。普通事务场景共享可销毁 schema，安装/迁移场景单独建库，各入口独立进程运行，结束清理本次创建的库。
- 运行器在副本缺少 `.env` 时创建空白环境文件；仅当 canonical 和 legacy 站点配置都不存在时创建空 canonical，不能用它遮蔽 legacy-only 测试。保留所有真正的公开配置文件，特别是独立签名 loader；不得按旧冲突文件名把公开代码排除出源清单。控制台集成测试需提供 `storage/geoip/` 下公开 Country、City、ASN MMDB 的只读副本，不复制其他生产存储。
- Redis 使用专用实例或专用测试数据库，每个入口使用独立前缀；不得清空应用或其他任务的 Redis。邮件、支付、Telegram、AWS、Cloudflare、ACME、下载和服务管理使用测试替身或临时服务，不连接生产。
- 生成器和前端也使用可销毁副本或可写临时目录，使用独立依赖安装和输出。浏览器夹具登记为 helper，其 setup/cleanup 及恢复要求见 [前后台验证](frontend-validation.md)。
- 日志与报告放在忽略的 `storage/app/test-organization/`，不含凭据或生产数据。清理仅针对本次临时资源；安装包、校验文件、回滚快照、生产日志及应用数据不属于测试垃圾。

## CI、依赖与发布资源

[GitHub Actions](../.github/workflows/quality.yml) 对配置分支的 push/PR 执行四项锁文件审计、V10 契约生成检查、前端全量测试/构建及显式列出的后端关键模块。前端当次 `public/console` 连同隐藏 `.vite` 清单作为短期 artifact 传给后端，避免检查旧产物。后端使用 PHP 8.4、临时 MySQL/Redis、随机且掩码的应用密钥和既有运行器；随后在同一安装树实际执行 `composer install --no-dev`，只运行生产兼容的 `framework-upgrade`、`console-verify`。

审计 job 不安装项目依赖，分别检查 Composer/npm 的全依赖和生产依赖；前一步失败后继续收集其余结果，任一步失败仍使 job 失败。每周三 UTC 03:23 的 schedule 只审计，完整应用回归用于 push/PR 和可用的手动触发。当前默认分支为 `master`；只推送 `codex/payment-icon-picker` 不会使计划任务或 Dependabot 在默认分支生效，须合入默认分支后再核对。[GitHub 计划任务规则](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

[Dependabot](../.github/dependabot.yml) 每周检查根 Composer、`/frontend` npm 和 Actions。Composer/npm 常规更新限同主版本 minor/patch 并分组，安全更新另组处理；各生态常规待处理 PR 上限为 3。更新需人工审阅和合并，不自动更改默认分支、安全设置或自动合并策略。

依赖回归复用 `framework-upgrade`：在开发及真实 `--no-dev` 安装中核对直接依赖与锁文件、实际 Laravel 加载版本、Linfo 不可自动加载、Horizon/Carbon 包发现、邮件传输、可信代理、调度、旧任务及迁移基线。Tinker 在开发安装保留命令，生产的包、类、Provider、发现清单及命令均须消失；须覆盖开发缓存升级到生产安装。真实健康检查读取数据库、Redis、缓存和 Horizon；新隔离环境无 worker/scheduler 时不伪造整机 healthy。`console-smoke` 夹具需要开发依赖 Mockery，不能向生产安装补回开发包或把未执行计为通过。`update-script` 的模拟 Composer 只证明控制流，不替代真实安装。

FastAI 命名兼容复用现有模块：`framework-upgrade` 核对配置单树别名、显式空值、整文件优先、新旧命令同实现及旧队列不变；`mail-install-schema` 验配置覆盖拒绝和新装 0640；`console-smoke` 验首次保存继承旧文件 0600、自定义站点名及新旧 boot 同对象。`update-script` 验旧/新/并存配置的字节、校验和与备份保护及缺失/损坏/被目标跟踪的拒绝。`timezone-scheduler` 检查新统计命令共用旧完成记录/锁，CLI 与经营报表读取旧状态但输出新命令名。前端既有模块覆盖偏好兼容、双代 revision、离线退出、裸 token 只清理，以及同意记录的两代删除/clear、最新选择和同时间拒绝优先。规则见 [名称与升级兼容](project-structure.md#fastai-名称与升级兼容)。

自定义设置回归在 legacy-only、canonical-only、两文件并存三种合成布局中实际启动 Laravel、只保存一个普通字段，再严格比较整棵持久配置并用独立进程执行 `config:cache` 和重新启动。保留自定义站名、URL/路径、页脚、加密邮件秘密占位、支付渠道配置、未知嵌套字段及 null/false/零/空数组；同时核对旧文件字节及私密权限。升级脚本回归另外覆盖三个私密路径的有效外部链接、内容快照/权限/校验和、依赖失败后的恢复材料，以及悬空/目录/空目标的维护前拒绝；归档保留链接，只有固定私密路径的内容单独解引用。

前端运行配置须在规范化后再次维持新旧 boot 同对象，自定义字段及非默认站名继续保留。统计同意检查对应 API 来源、localStorage/sessionStorage 事件作用域，以及同键重写或 clear 后重写可证过期的删除事件；保留原删除撤回及同时间拒绝优先断言。无法证明跨代撤回顺序时仍优先停止采集，不能将另一代残留 allow 当作新授权。

公开/私密配置冲突回归须覆盖真实文件布局：`framework-upgrade` 复制全部实际公共配置及原样签名 loader，在独立进程启动 Laravel，覆盖 legacy-only、canonical/空/单 seed 私密树、混合旧缓存、仅 seed 坏缓存、已有新签名根及真实 `config:cache` 重建；不以合成 loader 或纯 Repository 替代。两个 entrypoint 模块使用合成 seed 验签及 serviceId 连续性，bootstrap 回归核对环境优先、存储回退、临时 seed 文件字节和 0600 不变；不得读取真实站点 seed 或运行真实密钥生成器。Shell 夹具在旧提交真实跟踪两版公开 loader，再验证独立公共文件、私密配置保护和 dirty/未知 tracked 文件停止；物理字节校验还须拦截 assume-unchanged/skip-worktree 隐藏的修改。先前的纯数组及空文件夹具未覆盖这一仓库布局，不能将其通过结果当作此修复的证明。

本次命名及自定义设置复查在独立环境完成 24/24 个唯一 PHP 模块及一个 Shell 模块；12 个真实引导/缓存矩阵、三种布局的部分保存与缓存重建，以及最终升级脚本的 56 个场景均通过。最终控制台冒烟为 378 项检查，资源验证与运行配置模块分别为 4/159 项，使用同一份最终前端产物。初始冒烟因真实缓存重建切换连接而读不到旧事务夹具的失败日志保留；修正测试连接、增加专用付款夹具后，原断言完整通过，汇总按同一模块的最终结果计算。未读取真实站点配置或 seed、生成新密钥或执行实际站点升级。

同一隔离安装树实际执行含包发现脚本的 `composer install --no-dev` 后，生产兼容的 `framework-upgrade`、`console-verify` 两模块 2/2 通过，分别为 265/4 项检查；未补回开发依赖。699 份唯一 PHP 文件语法和 109 入口/15 辅助项清单检查通过，728 份显式源码及最终 385 份资源哈希一致。外层环境保持 legacy-only，未创建 canonical 占位或生成 seed；生产复验沿用上述两个模块，不计为新的测试入口。

前端复用现有模块，定向 4 个模块的 90 项检查及全量 115 个文件、155 个 suite、1,765 项测试全部通过，无失败、跳过或 todo；TypeScript、Vite 和前后台打包均通过。最终资源包含 385 个文件、379 个清单项，651 个引用与 381 个唯一资源齐全，111 份 JS 为 ASCII、14 语言及 JSON worker 可达，用户资源不混入后台代码。原本地运行资源逐字节保持不变；未做浏览器视觉或真实支付验收。后端与前端原始证据分别保存在忽略目录 `naming-settings-recheck/backend-abf0699be8` 和 `dependency-upgrade/frontend-tests/compatibility-fixes-*`，目录根为 `storage/app/test-organization/`。

发布需核对源码、清单锁和配套 `public/console`（含 `.vite`）一致，`update.sh` 不在生产执行 Node 构建。若用 alternate work-tree 将隔离产物纳入 Git index，同时保留原本地运行资源，提交后工作区差异是有意保留的，不能自动 reset 清掉。发布排除本地 Docker/启动/种子文件、`.env`、实例配置、storage 运行产物和 pycache。

## 后端领域覆盖

### 认证、权限与注册

`auth-security`、`browser-session`、`mfa`、`mfa-api`、`session-authorization`、`session-concurrency`、`registration-policy` 与 `api-route-audit` 保留正常协议及拒绝路径。覆盖邮箱排序规则碰撞、IDNA 等价/不同域名、验证码用途及状态绑定、过期/重放、双进程单次恢复、恢复后的会话撤销、Passkey 重绑归属、改密快照与当前会话复核、注册错码预算。`product-mail` 验证找回邮件的有效发送和过期队列拒绝，使用假队列/传输，不发送邮件；`api-v10` 从真实找回签发夹具取码，不能注入注册验证码代替恢复凭据。

真实路由回归验证 Cookie/CSRF/Origin、无效及伪造凭据、本人和他人资源、敏感字段投影、受限账户与退役 URL。拒绝后订单、工单、会话和用户状态必须不变。员工接口及角色退役仍需迁移和拒绝访问断言，不因实现删除而删除回归。四项应用问题与 Mime 拒绝测试的修前/修后证据要求见 [安全复核](security-review.md)。

### 订单、资金与业务报表

`commerce`、`commerce-concurrency`、`order-replacement`、`coupon-availability`、`payment-presentation`、`api-v10`、`api-v10-inventory`、`backend-security` 验证预报价不占资产、金额/币种/所有者绑定、过期与篡改拒绝、原子替换预览、重复创建/支付幂等、未知网关结果恢复查询、取消和渠道变化。缺少请求标识不能绕过未确认付款，处理中不能通过换标识重付；合法钱包/折抵和零价订单保留。返回路径只接受可信 Origin、已归属订单及正确编码，非订阅保留原路径，不能接受任意返回地址。有效重置规则只作派生投影，不修改原计划。

`commission-transfer-concurrency` 使用真实独立进程验证同一佣金只划转一次、流水和余额守恒、并发入账不被覆盖；历史内部奖励隔离保留原始审计字段，已发奖励不改，正常外部付费/钱包/折抵奖励不误伤。

`dashboard-revenue` 验证币种隔离、付款时间、缓存与排行榜；节点排行先汇总再取前 15 名，同流量按 ID 排序、批量查询名称并保留缺失节点历史。`admin-payment-diagnostics` 与前端 `OperationsAnalytics` 验证成熟注册批次的终身首次有价周期订单、试用后首购、零价/折抵/充值/额度/重置的独立分类。成熟边界按实际 168 小时计算后取业务区日期边界，覆盖 DST、起点包含/终点排除和付款秒边界。外部确认金额按可信快照分 CNY/USD，余额不重复记账，人工/缺失快照和重复回调可辨识，不伪造退款或净收入。

### 订阅、额度与配置记录

`credit-expiry`、`credit-access`、`traffic-credits`、`subscription-client-policy`、`api-v10`、`client-import-language` 和既有原生配置模块覆盖恰好到期、清理未运行、耗尽、缓存账户及渲染中状态变化。含静态代理/远程 provider 的合成模板不得进入无权益响应；所有公开格式安全提示为固定文档地址和假凭据，不含账号 UUID/token，原生保持 403/409。公开、自定义、application-config、旧 ETag、展示字段白名单及十四语言均覆盖；无效/轮换凭据、删除账号、未知 UA、访问拦截及限流继续硬拒绝。有效独立额度的合法基础组访问不能被周期套餐到期误禁。

模板无关列表覆盖协议过滤后的空输出、Shadowrocket 仅 STATUS，以及 QX、Shadowrocket、SIP008 有效节点不误报。YAML/JSON/URI/列表解析和安全断言不等于代理内核或第三方客户端验证。`api-v10`、`browser-session` 及风险/日志模块验证本人配置记录、保留期读时过滤、稳定分页和最大整数页码、无套餐/过期及受限状态、原始凭据/UA/异常不外露、GET 不写订阅日志或触发风险。

### 节点、路由与在线统计

`node-routes`、`node-v10`、`v2box`、`console-smoke` 和前端 `Nodes`/`admin-linkage` 验证原生与兼容路由、模板隔离、服务引用计数、跨片段标签合并、非法条件拒绝及失败回滚。可视化/高级 JSON 无损切换、复杂条件复制和搜索、引用明细、删除保护及未保存保护保留。面板 `resources/client/node-route-presets.json` 与节点 `core/testdata/panel-routing-presets.json` 同步，节点 `TestPanelRoutingPresets` 验证固定核心解析。

`NODE_ROUTING_FIXTURE` 可在一次性面板副本导出兼容/V10 响应，节点用 `V2BOX_ROUTING_FIXTURE` 验证解码和条件请求，不使用生产响应。真实本地核心覆盖阻断匹配、HTTP 代理/默认出口、DNS 命中/回退及测试证书 HTTPS 规则集，并与出站保护同时执行。`node-backends` 和 `retired-node-tables` 保留来源兼容、旧数据迁移及数据保护。

`node-v10`、`risk-activity`、`admin-user-activity-columns`、`node-traffic-batches`、`node-traffic-concurrency` 及既有 worker 验证空/遗漏快照清理、非法 JSON 不清理、IPv4/IPv6 映射去重、严格/宽松模式、动态有效期、陈旧缓存、部分失败索引恢复和无近期计费的在线用户。多进程重叠上报须同时保留节点、唯一历史快照、日志节流、逐节点清空和计费守恒；重复领取不重复计费，调度能恢复未处理批次。

### Lightsail、内容与任务

`lightsail`、`AdminLightsail`、`retired-node-tables`、`update-script`、`framework-upgrade` 和 `api-route-audit` 覆盖跨区域共享凭据、全体绑定轮换确认、worker 锁、运行中保护、删除引用保护、旧密文合并与失败回滚。SDK HTTP 处理器注入响应以验证真实错误解析、空/未知码 HTTP 400 的分页核验、申请/换绑/释放及失败保留旧 IP；畸形列表、循环分页和未知 404 不授权变更。诊断关联执行编号/AWS Request ID、排除秘密，日志不可写不得改变恢复行为。

`plan-auto-translation`、`content-translations`、`product-mail` 配合实际前端渲染测试，覆盖错误优先级、短路不请求、原 HTTP 参数/数字/正文保留、单回车/空行/CRLF、已有 HTML、过滤幂等和 HTML/纯文本一致。原文版本失效、字段回退、人工译文保护、并发冲突及迁移幂等保留；不用真实翻译或邮件服务。

`framework-upgrade` 统一检查任务超时、Horizon 停止上限与重投间隔余量、配置无输出、迁移基线和待执行迁移。`timezones`、`timezone-scheduler`、`subscription-info`、`usage-resets` 验证业务日跨 UTC、显式时区不改进程默认区、DST/非整点偏移、缺失/运行/失败任务、本人完成覆盖全局失败、所有者隔离及 GET 无写入。`fastai-template`/`node-display` 确保状态及业务区标签不变成连接节点。

## 前端回归归属

详细交互和桌面/窄屏清单集中在 [前后台验证](frontend-validation.md)，以下模块继续承载现有断言，不为每轮优化新增运行器。

| 领域 | 既有模块及重点 |
| --- | --- |
| 启动与导航 | app、UserAuth、runtime-config、UXResilience、shared/api/useData：账户/会话临时失败与认证失效区分、语言与 React 前恢复、旧响应/跨账户隔离、冷却不自动请求、焦点/路由恢复。 |
| 新用户与账户 | AccountEntry、UsageBilling、PendingOrderNotice、AccountSessions、HelpSupport/HelpGuides、QuickStart：有效试用与指定返回、待付款/处理中优先、错误不当空数据、单一搜索、安装返回和完成不虚构连接。 |
| 结算与优惠 | BillingFlow、CouponPicker/Center、PaymentMethodPicker、PaymentCheckout/Polling、app：安全选择意图、本人券包、缓存/重报价、单次确认、未知结果、渠道与二维码快照、冷却及 StrictMode 幂等。 |
| 次级页面 | ClientAuthorization、Notifications、PasskeyLogin、AnnouncementCenter、AppleAccounts、TrafficCredits、ClientDownload、UsageBilling：只读恢复、未知批准不重放、字段同步、关闭重开不绕过限流、刷新期间禁止额度下单、显式选择芯片。 |
| 后台与子窗口 | AdminApp、admin-shell、admin-workspaces、Editor、UXResilience、Banners、AdminRiskReview、AdminDictionary、Payments、AdminClients/Mirrors/MailCampaigns：搜索直达、列表/筛选、草稿、提交锁、关闭/焦点保护、429 退避及危险操作不重试。 |
| 名称与协议 | Nodes、AdminDiagnostics、ServerTrafficBudgets、admin-user-label、AdminCouponIssue：协议中性回退、关系名优先和目录复用、未知选择保留、名称显示仍提交 ID、失败不推断删除。 |
| 内置浏览器与懒加载 | user-experience、EmbeddedBrowserNotice、AdminBrowserPreview、admin-fields、现有构建边界与 navigation-intent：缺省/显式策略、识别不误拦、预览无副作用、安全交接、工作区和词库不进入公开初始依赖。 |
| 记录与隐私统计 | ConfigurationUpdates、AccountControls、QuickStart、JourneyAnalytics、OperationsAnalytics、AnalyticsCollectionSettings、product-analytics：入口不预取、分页失败/迟到响应、脱敏、只读刷新、匿名字段和同意/GPC/DNT/采样，payment_open 不作为付款或新增 PV。 |
| 时间与数量 | timezone、api、localization、UsageBilling/Chart、usage-data、NodeList、Editor、AdminLogFilters、user-filters、AdminEntrypoints/FastaiDownloads：非法/空日期、秒级往返和 DST 重复小时、统计日不移动、时区偏好隔离、数值边界与原始计费值不变。 |

账单筛选由 `UsageBilling`、`v10-api` 和后端 `api-v10` 验证完整历史分页、组合条件、UTC 包含/排除和毫秒边界、所有者隔离、无效输入及只读不变性。数量格式覆盖二进制单位进位、负零、极小倍率、百分比边界、ms/s 和十四语言；帮助搜索同时保留旧 GB 与新 GiB 关键词。CSV 响应头及正文读取都计入超时，失败不自动重放生成/导出。下载账户时间解析覆盖不同 PHP 默认时区及 V10 投影，CSV 保留明确偏移、秒、无期限空单元格和列顺序，不泄露码明文。

## 可选跨项目联调

- `v2box` 默认模拟传输；`V2BOX_BOOTSTRAP_TEST=1` 启用真实 Shell 夹具，`V2BOX_NETWORK_SCRIPT` 指向隔离节点上报脚本，`V2BOX_INDEPENDENT_DATABASE_SMOKE=1` 仅在可销毁 Linux 容器启用。多后台追加、重放、局部回滚、长连接与证书保留复用已有模块。
- 节点 `api/v2board`、`node`、`core` 保留用户全量快照、空/304、响应限额、大用户流式读取、伪造 MessagePack 长度、异常计数、取消保留采样及共享监听移除失败归属。执行矩阵沿用节点 CI 的 `with_quic,with_utls`、race、独立 Reality Vision、vet 与脚本测试。
- `node/reload_retry_test.go` 用本地 HTTPS/真实核心验证统计失败不丢撤销、准备失败缓存恢复；关闭测试覆盖真实 HTTPS 规则集转发、待处理连接取消、等待匹配结束及拒绝迟到连接。节点周期任务、证书子进程取消/期限、Retry-After、回滚和进程恢复边界不得删除。
- 长时间 soak、外部 padding preset、面板联调等需所需输入及显式开关；真实平台构建、Windows TUN/Helper、Android VPN/DNS/网络切换和设备 Passkey 在对应环境验收。测试不调用生产面板、ACME、DNS 商或服务管理器。

## 维护与结果记录

复用现有领域模块与 `tests/support`。新增/合并后端入口须更新清单并运行 `--validate`，保留业务、安全、迁移、并发及失败恢复断言，更新命令、CI 和文档引用。自动发现、旧接口拒绝或历史漏洞回归不能仅因缺少文本引用而判无用；单纯搬迁不新增镜像测试。PHP 经 `tests/support/run-script.php` 执行，未捕获异常必须非零退出，不能只看 Laravel 输出。

报告记录提交/锁摘要、工具版本、命令与退出码、失败/跳过及复验范围；环境故障不计通过，不混合不同快照声称全量通过。按源和产物核对 manifest 引用、前后台边界、worker 和语言完整性，实际核对结果写日志而非累积本页数字。自动测试、静态分析、构建、浏览器和真实服务联调分别说明，模拟 AWS/SMTP/支付/Cloudflare 不证明云权限、送达、结算、解析或签发。
