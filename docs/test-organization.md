## 节点部署入口与更新卸载（2026-10-23）

精简重复上报入口，修复操作收在域名页高级维护；已有健康上报、新节点和证书验证中不展示修复按钮。部署页增加更新、恢复、状态日志和卸载命令说明。V2Box 更新器保留配置/证书/自定义服务文件，安装失败恢复旧程序；停止状态保持停止，卸载需确认并保留配置证书，独立上报服务须显式选择停用。证书联系邮箱改为独立邮箱，新申请不再使用原 V2Board 邮箱。

前端 Nodes、AdminDDNS、node-options 共 42 项通过，TypeScript、生产构建及静态资源打包通过。部署助手 20 项和 V2Box 脚本 30 项在一次性 Alpine 容器通过，生命周期用例执行实际 Shell 脚本的临时路径副本，覆盖成功/失败升级、摘要和包缺失拒绝、停止状态保留、systemd/OpenRC、父子安装锁协调及并发拒绝、卸载失败保护、保留证书配置和可选停用上报。Go 节点 API 包回归通过；未修改代理核心，未运行全包网络性能测试。首次前端运行受沙箱临时目录权限限制，正常权限重跑通过；OpenRC 测试初次 PATH 缺少 install，修正测试环境后通过。

未操作生产服务、Cloudflare 或公网 CA，尚未发布节点新版；面板继续固定已发布的 v1.0.5，发布新版后再同步版本固定值。节点端命令及证书邮箱仅在安装新版后可用。无数据库或 API 合同改动，不增加迁移；保留原有 update.sh 路径。

## 部署恢复的浏览器防护诊断（2026-10-23）

推送前再次通过内嵌 Python 19 项及 `tests/update-script.sh` 的 26 个隔离升级场景，PHP 测试文件语法、update.sh Shell 语法及差异空白检查通过。升级测试在一次性容器内使用临时 Git 仓库和模拟 PHP/Composer/Artisan，不访问生产数据库。确认 bootstrap 控制器直接读取随 Git 更新的部署助手，无新增迁移或资源构建步骤；已下载到节点的旧 bootstrap 需重新下载后再执行 `--resume`。

部署助手增加明确的机器客户端 User-Agent，区分浏览器特征/挑战拦截与一般授权或网关拒绝；错误响应最多读取 16 KiB，只输出固定提示和经过格式限制的 Ray ID，不回显上游内容或凭据，错误响应资源及时关闭。保留 TLS 校验、禁止重定向、Bearer 鉴权及失败保留状态行为。

复用 `tests/v2box.php` 内嵌 Python 工作流模块，在只读挂载源码的一次性 Python 3.12 Alpine 容器中执行，19 项通过，包含真实临时证书检查。新增覆盖客户端标识、凭据不进入 URL、浏览器签名错误/挑战页识别、普通 403 不误判、响应关闭与敏感内容不回显。本轮没有数据库、接口合同或前端修改，未重跑完整 PHP 集成集；没有修改生产 Cloudflare 规则或验证生产部署成功，不需要发布新二进制。

## 代理响应下的配置哈希与域名切换（2026-10-23）

用户节点日志显示新监听启动后因 `invalid configuration hash` 回退。代码复现确认旧实现直接裁剪 ETag 引号，不能识别弱 ETag，缺失响应头也会使回执无效。尚未获取用户原始响应头，因此未断言代理具体进行了哪种改写。新版面板在配置响应正文提供 `meta.configurationHash`，保持原数据哈希及回执校验；V2Box 优先使用该版本，兼容强、弱 ETag，并在准备证书、停止监听前拒绝缺失或无效版本。拒绝响应不写入本地配置缓存。

复用现有测试：专用数据库 codex_hash_20261023 和一次性源码容器中，node-v10 290 项、node-ddns 113 项、V2Box 完整安装集成 59 项（内嵌 Python 16 项）、V10 inventory 1634 项通过。使用实际 PHP 配置响应作为 Go 测试夹具，验证没有 ETag 时仍读取面板版本；本地 Go API 竞态回归覆盖强/弱标签、删除/改写响应头、无效元数据、不污染缓存及确认回执。合同七份生成物一致，生成器 12 项通过（沙箱临时目录权限不足后正常权限重跑）。前端 39 项及生产构建、update.sh 26 个隔离升级场景通过。无数据库迁移，不修改 update.sh；不操作生产服务器、DNS 或 CA。

V2Box 44f5697 的 v1.0.5 发布工作流 39913021737 已通过完整竞态回归（含真实监听保持原运行对象的拒绝测试）、独立 Reality Vision、go vet、Shell 检查及 Python 测试。本地重复全量任务因 Windows 挂载缓存解压缓慢仍处于依赖准备阶段，CI 全量通过后已停止，不计为本地全量通过。

六个平台构建及发布成功，12 个包与校验文件已上传。一次性 Linux 容器安装实际 v1.0.4，再由面板控制器生成完整 bootstrap 入口升级至 v1.0.5，版本号、配置 SHA-256 保留及旧二进制备份均验证通过；服务管理器使用模拟命令，没有启动真实代理。初次直接执行未渲染模板遇到占位符错误，改用真实控制器输出后通过，未修改安装器绕过依赖检查。本轮专用数据库、授权及测试容器已清理。

## 域名启用指引与 V2Box v1.0.4 发布（2026-10-23）

部署页区分目标域名与当前生效域名，按 IP 上报、解析同步、节点能力和证书切换状态提示后续操作；发布成功后刷新节点列表。管理接口仅批量读取能力缓存并返回布尔能力，不暴露原始缓存或增加 Cloudflare 请求。面板安装、升级及上报助手入口固定至 v1.0.4。

复用现有模块：前端 AdminDDNS、Nodes、node-options 共 39 项通过，TypeScript、生产构建及静态包生成通过；一次性项目副本和专用 MySQL 数据库中，node-ddns 112 项、node-v10 288 项、V2Box 集成 59 项及内嵌 Python 16 项通过。没有修改迁移或 update.sh，沿用已通过的升级脚本回归；没有清空共享 Redis。验证完成后已清理本轮专用数据库、授权及测试容器。

V2Box 提交 a66b7c3 已发布 v1.0.4，GitHub Actions 39908945696 的竞态测试、独立 Reality Vision 回归、go vet、脚本检查、Python 测试及六个平台构建全部成功，12 个二进制压缩包与校验文件已上传。一次性 Linux 容器下载实际发布的安装脚本与 Linux amd64 包，安装器完成校验，首次安装及重复升级成功，版本输出 v1.0.4，原配置摘要一致且旧二进制备份存在。服务管理器使用模拟命令；未操作生产服务器、修改真实 Cloudflare 或申请公网证书，未进行真实浏览器视觉验收。

## 区分节点安装与自动 IP 上报入口（2026-10-23）

移除后台纯公网 IP 查询命令和 nodeIPCommand 导出；部署页增加通往现有域名管理的自动上报入口，手动安装归入高级折叠区，上报弹窗与缺少上报提示统一用途说明。不更改后端、上报协议、服务定时器或节点二进制，不增加后台请求。

复用 Nodes、AdminDDNS、node-options 三个测试模块，36 项通过；覆盖新入口跳转、未配置根域名提示、跳转不生成部署授权、已有自动上报及 V2Node 手动配置。修正导航测试的凭据接口夹具为实际对象结构。TypeScript、Vite 生产构建和前后端资源打包通过；沿用现有卡片、按钮、Modal 与折叠组件，未进行本轮真实浏览器视觉验收。

## 一次性 IP 上报配置授权（2026-10-23）

已评估独立上报与内置上报：保留可先于代理监听和证书申请运行的独立服务，复用既有一次性部署授权与安装依赖，新增 networkOnly 用途以自动配置已有 V2Box。无新数据表或二进制改动。

在 codex-network-test 一次性项目副本与 codex_network_20261023 专用数据库验证：node-v10 288 项通过（含网络用途授权、生成时不撤销旧密钥、仅返回上报密钥、节点接入凭据不变、保留 IP/退避与防重放）；启用 V2BOX_BOOTSTRAP_TEST 后 v2box 59 项集成检查及内嵌 Python 工作流 16 项通过。脚本使用假下载和假服务，验证无重启、原配置保留、错误节点在兑换前拒绝、私有恢复文件及失败重试不重复兑换。node-ddns 109 项、API V10 inventory 1634 项、合同生成器 12 项通过，七份生成文件同步。

前端 AdminDDNS/Nodes 31 项通过，TypeScript、生产构建与静态包生成通过。没有调用生产 Cloudflare、签发真实证书或操作用户服务器。本轮测试容器与专用数据库在验证后清理，不清空共享 Redis。真实服务器包源、网络与 DNS 连通性仍以部署结果为准。

## 节点 IP 显示与部署状态刷新（2026-10-23）

排查确认：节点列表允许使用请求来源 IP 回退，域名绑定读取独立地址上报；已有 IP 解析不影响地址接收。同名非托管 DNS 的归属冲突仅阻止解析修改。用户确认节点未部署 node-network，因此需要配置独立上报服务。

复用 AdminDDNS.test.tsx、Nodes.test.tsx，共 30 项通过；覆盖可见页面刷新、慢请求互斥、错误后停轮询、卸载清理、保留输入、认证成功后停止刷新、避免以出口 IP 冒充上报地址。TypeScript、生产构建、静态资源打包与 diff whitespace 检查通过。此轮未修改后端或节点上报协议，未操作用户服务器。

## 托管 TLS 域名同步与失败恢复（2026-10-23）

面板使用一次性容器副本与专用 MySQL 数据库 `codex_tls_20261023`，Redis 用例沿用随机前缀，没有清空共享 Redis。域名生命周期 109 项、V10 节点接口 280 项、V2Box 集成 32 项、V10 库存 1634 项通过。覆盖候选配置加密且不提前发布、旧版能力拒绝、失败/过期/配置变化撤回、缺失指纹及旧回执拒绝、带操作 ID 的真实机器接口确认和重复确认、普通 TLS 子节点同步、Reality 身份保留、SAN 证书生成，以及 TLS 一键部署重复完成。测试 Cloudflare 使用内存模拟，没有操作实际解析或请求公有 CA。

新增 `2026_10_23_000002_node_tls_transition.php` 已通过隔离迁移，install.sql 与 update.sh 的预检、白名单和执行列表同步；升级脚本 26 个隔离场景通过，并明确断言执行本次迁移。七份 V10 生成物检查及生成器 12 项回归通过。复用现有测试模块，未新增临时验证脚本或 suites 条目。

V2Box 在官方 Go 1.27.3 Linux 容器、`GOEXPERIMENT=jsonv2`、`with_quic,with_utls` 下进行全包竞态回归；全包竞态、go vet 及独立 Reality Vision 回归通过。新增真实 HTTPS 面板/真实监听端口占用回退，修正旧热重载测试夹具因 HTTP 地址被提前拒绝而未进入目标阶段的问题。证书测试覆盖身份、信任链拒绝、过期、私钥、版本目录及旧文件保护；明确面板确认和发布后免重复重载。Windows 包扫描与模块缓存元数据不完整影响首次运行，最终使用容器内完整模块源/原缓存摘要验证，未更改依赖版本。

后台 AdminDDNS 8 项、TypeScript 及生产构建打包通过；仍有已有代码编辑器大分块提示。未进行生产 CA 签发、真实 Cloudflare 修改、生产节点升级或 Release 发布。

## 套餐展示与续费开关整理（2026-10-23）

套餐列表移除展示/隐藏、开启/关闭续费的重复文字操作，沿用原有 AdminSwitch 与 plan/update 接口；“展示”和“允许续费”两列相邻，位于套餐名称后。未改变保存参数、权限或套餐销售逻辑。复用 admin-workspaces 的 123 项回归通过；初次测试受 Windows 沙箱临时文件重命名限制，正常临时目录权限下重跑通过。此类布局整理不新增仅匹配删除按钮的测试，无后端修改。

## 群发修复上线版本复核（2026-10-23）

用户反馈重启 Supervisor 后仍按分钟发送，核对服务器 Git 提交为 30e71f5c，尚未包含已发布的 33c36729 群发修复；重启不能替代代码更新。未据此修改生产限速逻辑或清理服务商冷却状态。

将 product-mail 中的真实 Redis 用例补充为真实 Illuminate Bus Dispatcher 和 Worker::process，覆盖任务反序列化、JobProcessing 设置刷新、任务执行与删除、延迟重新派发和 tries=1。独立随机 Redis 前缀、一次性代码副本与专用 MySQL 纯结构库中，702 项检查通过；2/3/5 秒设置下同服务商三封模拟邮件约 10.02 秒完成，未调用分钟调度器。传输仍为模拟，不代表 Mailgun 最终收件时间，也未运行生产 Supervisor。此次仅补充测试与验证记录，无新增业务代码变更。

## 自动证书与群发修复推送验证（2026-10-23）

提交前重新运行 update.sh 语法检查与 26 个隔离升级场景，全部通过；测试仅使用一次性目录、模拟 Artisan/PHP/Composer，不执行生产迁移。V10 七份生成物一致性检查通过。复用本轮已通过的自动证书、节点接口、邮件通知与 Redis 延迟队列测试，以及前端生产构建结果。此次两项修复无需新增迁移，update.sh 正常流程会重启本站受监督队列，使邮件修复生效；手动 jobs-stopped 模式仍须管理员自行恢复工作进程。

## 群发邮件秒级调度修复（2026-10-23）

定位 SendCampaignMailJob 限速分支仅更新 available_at、等待每分钟 mail:campaigns 再投递，导致一批任务首次成功后其余任务按分钟反复集中执行。修复为持久化等待状态后按实际剩余秒数投递新的 Redis 延迟任务，等待不计入发送尝试次数；队列投递失败恢复 scheduled_at=0，由原调度器兜底。保留收件人行锁、终态去重、服务商冷却与不确定发送不自动重试。Queue::before 对两个邮件 Job 刷新三项已保存的间隔设置，常驻进程不再长期保留旧间隔；既有已预约等待不提前撤销。

复用 notification-delivery/mail-cases 和 product-mail：SQLite 369 项、专用 MySQL 385 项（含并发收件任务认领）、邮件模板与限速 696 项通过。新增延迟队列、重复等待不消耗尝试、提前任务不发送、重复完成不发送、队列故障后调度恢复、真实 JobProcessing 设置刷新等验证。真实 Redis 使用独立随机队列前缀，设置普通/群发/同服务商间隔为 2/3/5 秒，三个同服务商收件任务在约 9.24 秒内完成模拟提交，全程未调用分钟调度器；同时验证服务商间隔和每收件人仅一次成功尝试。时间使用现有整秒限速，实测间隔受秒边界影响。

全部测试运行于一次性代码副本和专用空库/纯结构库，外部邮件与 Telegram 传输均模拟。初次测试修复了夹具复用 SQLite 查询对象导致选列变化，以及队列事件 mock 缺少 payload 的问题；没有放宽业务断言。未连接生产服务器或真实邮件服务商，未验证最终送达时间。无数据库迁移或前端变更，无需重新构建界面；上线须重启本站 Horizon/队列一次以加载代码，后续仅修改三项间隔无需重启。

## 自动证书部署闭环回归（2026-10-23）

复用 node-ddns、node-v10、v2box 和 api-v10-inventory。隔离项目副本与专用 MySQL 测试库中，域名 89 项、V10 节点 279 项、接口清单 1,634 项通过；最终 V2Box 45 项集成检查与内嵌 Python 16 项通过。覆盖上报先于启动、双解析器 A/AAAA 一致性、陈旧 AAAA、解析超时不申请证书、80 端口占用、失败配置回执、缺少新回执、令牌过期/撤销/管理员降权/配置变化、并发安装拒绝、私密状态和报告令牌清理、恢复不重复启动、完成响应丢失后的幂等确认。使用临时本地 CA/叶证书真实执行 OpenSSL，验证可信证书通过及错误主机名、未受信任证书拒绝。

初始隔离库仅导入 install.sql，缺少既有日志模块表；重建为本地库的纯结构副本并执行相关迁移后通过，未复制业务数据、修改业务库或清空共享 Redis。最终补充自动 HTTP/DNS 证书必须绑定托管域名的前置检查后，再次运行 V2Box 45 项与 Python 16 项通过。

V10 七份生成物一致性与生成器 12 项通过（Windows 沙箱临时目录权限失败后以正常临时目录权限复测）；前端相关 47 项、类型检查和生产构建通过。发布资源已更新。没有新增数据库迁移或修改 update.sh，本轮未重复执行此前已通过的 26 个升级场景。沿用已发布 V2Box v1.0.3，无需新二进制；部署助手随面板脚本交付。未连接真实 Cloudflare、申请公开 CA 证书或在公网节点安装，防火墙及公网连通性仍需部署环境验证。TCP TLS 验证本机握手，QUIC 节点验证证书及配置应用回执，未执行 QUIC 客户端端到端连接。前端日志位于 storage/app/test-organization/certificate-deploy-{frontend,build}.log。

## 节点域名生命周期回归（2026-10-23）

复用 node-ddns、node-v10、node-backends、node-address、v2box 和 update-script 测试。覆盖根域名与 Zone 验证、域名冲突、持久归属、显式接管、待同步 IP 禁止切换、TLS 名称保留、证书引用阻止删除、迁移预览失效、批量部分成功、24 小时保留、节点删除撤销上报、孤立记录清理、记录 ID/归属变化拒绝删除，以及凭据退避不阻塞其他清理任务。

后端在代码副本和专用 MySQL 测试库执行：node-ddns 88 项、node-v10 265 项、node-backends 798 项、node-address 8 项通过。v2box 常规集成 31 项；在一次性 Linux root 容器安装 bash/jq 后设置 V2BOX_BOOTSTRAP_TEST=1，包含模拟部署的 41 项通过。模拟下载、服务及上报助手，验证成功安装、IP 上报配置失败仍启动节点、配置 0600 权限、临时密钥清理及重复执行保留已有配置；不安装真实节点或变更系统服务。常规 PHP 测试无需增加 jq 依赖。

旧库定向迁移通过；另建空测试库导入 install.sql，再执行 DDNS 原始及生命周期迁移并重复执行，均通过。update-script 26 个隔离场景通过。V10 七项生成物一致，生成器 12 项通过。完整前端 901 项及最终 30 项相关回归、类型检查、生产构建与发布包通过，界面验收见 frontend-validation.md。Cloudflare 使用状态化假服务，未验证真实账户权限、DNS 传播、实际证书握手或远端服务器安装。本轮不需要重建 V2Box 二进制，辅助脚本固定已发布 v1.0.3。

## 用户选择控件回归（2026-10-23）

复用 CouponPicker、AccountPreferences 和 BillingFlow 测试，更新原生 select 的交互断言，新增取消草稿及恢复焦点、主动不使用优惠券、时区名称和偏移搜索、无结果、保存失败重试及保存期间防重复/禁止关闭验证。新增“确认选择”“上海”词条覆盖全部 14 种语言。初次本地化扫描发现中文搜索别名硬编码，改用翻译资源后相关 4 模块/117 项通过；完整前端 113 文件/897 项通过。类型检查及最终生产构建通过。

没有改动服务端接口、权限或金额计算；未重跑后端数据库测试。真实浏览器模拟数据验证范围见 frontend-validation.md。日志位于 storage/app/test-organization/selection-controls-{tests,full,build-final}.log。

## 结算说明书面化（2026-10-23）

检查结算、订单和支付提示，将“下一步确认”改为支付页面金额提示，“预占可用余额”改为余额抵扣及取消返还说明，“无需外部付款”改为无需额外支付；优惠说明简化为先计入周期优惠、再使用优惠券。同步 14 种语言，保留翻译查找键，不更改计费、手续费或退款行为。

本地化、BillingFlow、PaymentCheckout、order-price 四个现有模块共 106 项通过，覆盖语言键及插值、付款展示和金额计算。类型检查和生产构建通过，配套前端发布资源已更新。本轮未进行真实浏览器或实际付款验收。日志位于 storage/app/test-organization/payment-copy-{tests,build}.log。

## 结算金额展示精简（2026-10-23）

移除 PlanSelection 价格明细中的折合月价及无用样式，套餐选购页继续显示折合月价用于周期比较；周期总价、优惠及订单金额计算保持不变。复用 BillingFlow、PaymentCheckout 和 order-price 三个模块，50 项通过，包含套餐比较、订单创建、支付展示和金额计算。未新增仅验证元素删除的测试，未进行真实付款或浏览器验收。日志位于 storage/app/test-organization/checkout-total-{tests,build}.log。

## 客户端生产文案清理（2026-10-23）

移除下载和订阅导入页面共用的项目来源、更新责任及账户密码说明，移除镜像下载中重复的来源备注；同时删除 14 种语言中不再使用的词条。导入提示改为确认配置和未打开时的处理方式，仍不承诺导入已经成功。隐私披露、服务范围、订阅链接和 iCloud 安全提示保留。

复用本地化、ClientDownload、QuickStart 三个现有测试模块，合计 68 项通过，覆盖语言键与占位符、下载地址、架构选择、iOS 安全说明和导入交互；没有新增仅校验文案删除的测试。类型检查及生产构建通过，public/console 和独立 user/admin 包已更新。本轮未运行真实浏览器或后端数据库测试。日志位于 storage/app/test-organization/production-copy-{tests,import,build}.log。

## 更新分支提交前验证（2026-10-23）

本次发布范围包含节点维护与配置回执、用户购买流程和书面文案。重新运行 update.sh 语法检查及 26 个隔离升级场景，全部通过；新增节点维护迁移已进入目标完整性检查、迁移白名单及执行序列。测试使用一次性目录与模拟 PHP/Composer/Artisan，没有更新业务数据库。V10 七份生成物检查与 12 项生成器测试通过；生成器首次受沙箱临时目录权限限制，使用正常临时目录权限重跑通过。

沿用本轮已完成的前端 893 项全量测试、最终术语 77 项复测、生产构建，以及节点相关后端和 V2Box 竞态验证结果；未重复执行没有代码变化的业务测试。升级日志位于 storage/app/test-organization/push-update-final.log。仅发布源码分支及面板构建资源，本次不发布 V2Box 二进制或执行生产升级。

## 用户界面书面文案（2026-10-22）

复用 localization.test.ts，为简繁中文显示值添加口语回归及账户术语检查，服务端简繁中文和英文错误提示检查感叹式及含糊表达；继续核对 14 种语言的键、插值与可见文字。HelpGuides、ClientDownload、api 现有测试同步新的正式文案，保留行为和请求次数断言。

首次全量 113 文件/893 项中 5 项因旧文案断言失败，修正断言后相关 4 文件/97 项通过，随后完整 113 文件/893 项全部通过。浏览器发现的繁体术语混用修正后，本地化和注册相关 2 文件/77 项复测通过。TypeScript、最终生产打包和 FrontendRuntime.php 的 PHP 语法检查通过。没有改动业务接口、数据库、计费或权限逻辑，未重跑数据库集成测试。

日志位于 storage/app/test-organization/user-formal-copy-{full,focused,full-final,terminology,build-final}.log；浏览器验证范围见 frontend-validation.md。未新增独立测试脚本。

## 用户前端转化路径（2026-10-22）

复用 Landing.test.tsx、UserAuth.test.tsx、BillingFlow.test.tsx 和 localization.test.ts，覆盖简洁首页注册政策、取消滚动跳转、无需验证码时单页注册、条款有效性、购买目的地保留、注册重试/重复提交、套餐参数/周期总价、订阅状态失败时禁止操作、移动端默认避开售罄套餐以及付款后连接入口顺序。保留原有验证码、域名限制、邀请绑定和支付防重等断言。

完整前端 113 文件/890 项通过；最终本地化和注册布局修正后的 4 文件/125 项复测通过；TypeScript 与最终生产构建通过。初次 Vitest 执行被沙箱临时文件重命名权限阻止，在正常临时目录权限下重跑；曾发现硬编码速率单位，改为完整语言资源后通过。日志在 storage/app/test-organization/user-conversion-{full,focused-final,build-final}.log。本轮只修改前端及文案，没有修改后端接口、数据库或支付计费逻辑，未重跑后端数据库测试。浏览器使用仅本机模拟数据，未执行真实注册或付款；详见 frontend-validation.md。

## 节点管理、维护与配置回执（2026-10-22）

复用现有测试，隔离 MySQL 副本中最终 12 个相关后端模块通过：运行诊断 59 项、路由权限 2,672 项、V10 清单 1,619 项、V10 合同 206 项、控制台 212 项、V10 节点 264 项、节点后端 780 项、节点显示 5,700 项、节点路由 38 项、服务器额度 20 项、订阅策略 37 项，以及 update.sh 26 个隔离升级场景。覆盖旧哈希回执拒用、失败保留最近成功、原始错误字段拒绝、维护管理员权限/时间限制/父子继承/到期恢复、转换和删除时维护数据一致性，以及探测失败不误报恢复。

首次副本遗漏 docs、frontend/src 合同及 storage/app 目录，相关检查因此失败；补齐测试环境后针对失败模块重跑通过，未放宽生产校验。测试账号和临时数据库由运行流程清理。结果按每个模块最后一次运行合并，保存在 storage/app/test-organization/node-management-*.json/log。

前端全量 113 个文件/880 项测试通过，类型检查和生产构建通过。V10 七份生成物一致性检查及 12 项生成器单元测试通过。V2Box 在官方 Go 1.27.3 Linux 容器中完成全包带 QUIC/uTLS 的竞态测试和 go vet；新增回执校验、失败重试及配置解析失败上报测试通过。没有新增独立验证脚本，未发布 Release 或在生产节点部署。

## 全仓审查回归（2026-10-22）

复用现有测试模块，在一次性项目副本、专用 MySQL 测试库与临时数据库账号下执行完整 tests/run.php；结束后删除测试库和临时账号。未操作业务数据库。最终按每个模块的最后一次结果合并，111 个后端模块全部通过；测试清单 111 项和 12 个 helper 验证通过。

首轮 105/111 通过，六项失败来自过时测试夹具：注销接口的 JSON/字段白名单拒绝顺序、一次性节点部署要求空请求体、已移除用户生成接口遗留的批量删除测试数据、节点认证错误码，以及通知/旧节点迁移夹具遗漏 account_deleted_at。修复这些前置条件，保留拒绝伪造身份、批量删除范围和会话撤销断言。控制台复测另补入项目已有的 GeoIP 数据文件到隔离副本，未改生产 GeoIP 行为。

关键结果：真实路由审计 363 路由、69 个 V10 用户入口、202 个受保护旧入口/721 次拒绝探测，共 2,664 项；浏览器会话 527 项；控制台 smoke 203 项；节点 V10 247 项；update.sh 26 个隔离升级场景。V10 七份合同生成校验及 12 项生成器测试通过。删除旧令牌兑换后 POST browser-session 返回 405，既有 Cookie、原生 Bearer、MFA 与 Passkey 流程均保留验证。

前端全量 113 文件/876 项通过，随后管理员退出失败清屏补充回归的三模块 43 项通过；TypeScript 与最终构建通过。npm audit（含开发依赖）0 告警，Composer locked audit 0 告警。此前前端审计 4 条告警已通过版本修复；首次全量中唯一翻译遗漏补齐 14 种语言后完成最终全量复测。

日志保存在 storage/app/test-organization/review-*；节点 Linux 竞态/静态/依赖验证见相邻 v2box README 的依赖安全复核。没有新建独立测试脚本、提交运行凭据或执行生产升级。

## 日汇总与财务性能验证（2026-10-21）

复用 node-v10.php 和 dashboard-revenue.php 的显式性能模式；仅允许 local 环境/隔离 MySQL 库（库名必须以 v2board_test_ 开头），不在常规回归中自动灌入大数据。NODE 模式 TARGET_STATISTICS_PERF=1 生成 20 节点 × 30 天 × 500 目标 = 300,000 行；财务模式 DASHBOARD_FINANCIAL_PERF=1 生成 100,000 订单和 10,000 佣金记录。测试完成后由操作者删除整个专用测试库，不可对应用库运行。示例运行条件与代码中的拒绝条件保持一致。

本地 MySQL 8.0.46、Docker 隔离样本实测（单次观测，不是生产 SLA/P95）：
- 日汇总初次容量计数冷查询 362 ms，缓存后首页 8 ms，第 600 页 25 ms。查询计划 target_daily_lookup 反向范围扫描，估算读取 500 行，无 filesort；过期清理使用 expires_at 范围索引。
- 20 个节点各 500 目标的真实 Redis → SQL 归档 2.97 秒，PHP 进程峰值 52 MiB（含生成样本的开销）。每五分钟通常 20 个桶，单次上限仍为 48 桶。
- 无过期数据清理 1.9 ms，删除 1,000 行 79 ms；保留期缩短由原同步约 30 秒改为持久任务提交 46 ms、后台每轮改写最多 5,000 行约 594 ms。
- 样本日汇总 InnoDB 数据页约 79.98 MiB、索引约 86.53 MiB，共约 166.51 MiB；表行数为统计估计，样本经过少量清理。短目标名、插入顺序、页碎片会影响占用，不包含 binlog、备份或长期快照。
- 财务索引前 253 ms，索引后 62 ms；包含旧年度字段的缓存冷构建 381 ms，热缓存约 7 ms且零 SQL。索引前后汇总值完全一致，新增索引重复执行无副作用。

247 项 V10 节点检查、财务回归、124 项相关前端测试、26 个隔离升级场景通过，TypeScript 与生产构建通过。覆盖不均匀日期跨页无遗漏/重复、缩短后清理完成前禁止扩展、缓存命中不执行财务 SQL。新增索引迁移已纳入更新脚本，未执行生产升级。运行日志保存在 storage/app/test-organization/target-perf-*.log 和 financial-perf-mysql.log。未进行生产负载测试或真实浏览器视觉验收。

## 财务与节点日汇总回归（2026-10-21）

复用 dashboard-revenue.php、node-v10.php、update-script.sh 及已有前端测试模块，无新增独立测试脚本或测试清单变更。

- 隔离 SQLite：dashboard-revenue 验证订单状态、支付日期、CNY/USD 隔离、充值分类、零元订单、同期比较、30 天补零及财务四查询上限。
- 隔离 SQLite + 独立 Redis 前缀：node-v10 共 242 项通过，含日汇总无用户维度、分页/节点隔离、归档重试不重复、每日 500 目标/全局容量限制、500 目标少于 15 条 SQL、过期/缩短/重新开启、管理员权限与筛选校验。88 并发提交为回归检查，不是生产容量基准。
- 本地 MySQL 8.0.46 独立临时数据库：新增安装表/索引、唯一键更新及事务回滚通过；临时库已删除。未执行生产迁移，也未对完整 API 做 MySQL 压测。
- update-script.sh：26 个隔离升级场景通过，包括新增日汇总迁移；已有快照迁移先于日汇总迁移执行。
- 前端 admin-workspaces、AnalyticsCollectionSettings、OperationsAnalytics、JourneyAnalytics：137 项通过；TypeScript 和生产打包通过。未运行真实浏览器视觉验收。

运行结果仅在 storage/app/test-organization/daily-{finance-api,node-api,finance-frontend,finance-build,update,mysql}.log，不提交运行数据。

## 核心仪表盘与访问目标数据库汇总（2026-10-21）

前端相关四模块 147 项通过；数据库状态接入后的报表/导航两模块 120 项通过。移除搜索和年度/昨日重复指标，保留设置、分页、部署授权及导航安全断言。TypeScript 与生产构建通过，资源已更新。

隔离 SQLite 项目与独立 Redis 前缀执行 node-v10.php，215 项通过；新增保留时间校验、物理过期、缩短释放、延长不恢复、6000 项聚合上限、数据库归档释放缓存、重复归档、交接重叠不重复计数、数据库预算不足保留缓存等检查。最初归档测试发现 Redis 连接前缀重复，修正逻辑键转换后通过。数据库保存五分钟 JSON 汇总快照，不在节点上报请求中写 SQL；迁移与新安装表结构同步。

update-script.sh 的 26 个隔离升级场景通过，并断言新增快照表迁移执行。未在生产环境执行迁移，未进行真实浏览器视觉验收。日志：storage/app/test-organization/core-dashboard-{final-tests,build}.log、target-archive-{api,frontend,update}.log。

## 低频设置分类回归（2026-10-21）

复用 admin-workspaces 增加业务归属、侧栏高亮、设置标签直达、搜索关键词与不请求其他业务页数据检查；退役地址断言增加原充值规则和服务入口路径。admin-workspaces、Payments、AnalyticsCollectionSettings 共 121 项通过。TypeScript 与生产构建通过，发布资源更新。日志：storage/app/test-organization/admin-settings-consolidation-{tests,build}.log。

## 导航归位与旧地址退役验证（2026-10-21）

复用 admin-workspaces 测试覆盖新导航全部页面、16 个搬迁入口、标签地址切换、保存中禁止切换，以及 19 个旧地址不再重定向。全量 113 文件、845 项首轮 840 通过，5 项日志筛选/时区检查失败：重命名后旧 log- 前缀检测失效。改为 access-logs 分类后，相关两个模块 111 项全部通过，其余 112 个测试文件已通过。此前导航分组顺序与菜单断言问题已修复。生产构建及 TypeScript 检查通过，发布资源同步更新。

日志：storage/app/test-organization/admin-navigation-{final-tests,log-recheck,build}.log。只修改前端导航、设置入口及表单离开保护，后端 API、配置键、存量数据保持不变。按用户要求无旧链接兼容，站内链接更新为新地址。

## 节点列表与部署界面回归（2026-10-21）

Nodes.test.tsx 增加在线/离线/未知状态圆点、可访问名称、诊断打开及唯一显隐开关检查；既有部署授权、复制、升级切换测试保留。Nodes、node-options 和 admin-workspaces 三个模块共 93 项通过。修复上轮导航负向断言的字面量联合类型比较错误后，TypeScript 与生产构建通过，发布资源同步更新。日志：storage/app/test-organization/node-interface-{tests,build}.log。

## 简化节点一键命令验证（2026-10-21）

后台命令改为 wget 下载后 sh 执行，传入 --api-host、--node-id 和 --deploy-token。复用 node-v10.php：186 项通过，覆盖授权单次兑换、失效、替换授权、身份校验及不输出长期密钥。命令格式断言同步更新；旧 stdin 参数兼容逻辑保留。V10 七份生成产物检查、12 项生成器测试通过。

一次性 Debian 容器从无 curl 环境执行复制命令，通过正式 v1.0.2 安装器和二进制验证自动补依赖、单次兑换、0600 配置、无凭据输出、重复安装拒绝、升级保留配置、节点 ID 不匹配拒绝写入。服务操作使用桩，不代表生产服务器安装验收。节点前端定向 21 项通过；本轮未修改前端源码，无需重建资源。测试日志位于 storage/app/test-organization/node-simple-command-{api,linux,frontend}.log。

## 管理导航与设置分类验证（2026-10-21）

复用 AdminSystemLogs、admin-workspaces、AnalyticsCollectionSettings 测试模块，覆盖日志归类、仪表盘报表按需请求、日志分类按需加载、未保存切换取消/确认及系统设置分类搜索。保留既有部署授权、复制、过期、轮换与配置保存回归。

前端全量 113 文件、810 项通过（--maxWorkers=2），TypeScript 和生产构建通过；public/console 发布产物已更新。首轮默认并发 806 项通过、1 项客户端页面加载超时，定向 103 项通过后降低并发完整复核通过。日志为 storage/app/test-organization/admin-management-{tests,focused,build}.log。本轮仅调整前端组织，不改变后端数据和配置键；未进行真实浏览器视觉验收。

## 后台共用界面回归

复用 admin-workspaces.test.tsx 增加统一表格可聚焦、操作列标记、操作回调、筛选提交/重置分离检查。沿用 OperationsAnalytics 分页及空数据测试，以及全部用户、订单、节点、优惠券、邮件、风控、设置组件回归。优惠券模拟补入真实 TableViewport，保留取消操作确认及防重复断言；补齐共享组件的 14 种语言无障碍文案。

最终前端全量 721 项通过，TypeScript 与生产构建通过。首轮 718 项通过、3 项失败（2 项模拟缺少新组件导出、1 项缺少翻译），修正后全量重跑通过。过程与最终报告为 storage/app/test-organization/browser-access/admin-unified-{all,final}.json，构建日志为 admin-unified-build.log。未修改后端接口或迁移，视觉验证范围见 frontend-validation.md。

## 节点编辑界面验证

复用 admin-location-select.test.tsx 与 node-location-options.test.ts，23 项通过，覆盖当前选项定位、Enter 不误清空、Home / End、匹配数量提示、名称预览、清空地区回退原名称、城市别名及自定义后缀安全转义。首次定位测试发现勾号进入无障碍名称，修复 aria-hidden 后重跑全部定向测试通过。TypeScript 与生产构建通过，构建日志 storage/app/test-organization/browser-access/node-ui-build.log。未修改后端或新增接口。

## 节点专用国家字典与独立地区语义

复用 tests/node-display.php：验证节点目录使用节点专用国家字典、代码归一化、未知代码与语言兜底、私有及无效 IP 保持未知、节点展示不读取 GeoIP 字段。以本地确定性 GeoIP Reader 记录验证已知及未知代码都保留 GeoIP 自身名称，不引用节点字典；恢复静态 Reader，避免污染后续测试。于容器内独立副本和 SQLite 内存配置运行，5,685 项断言通过，未访问业务数据库。

前一轮前端全量 715 项通过（geography-all.json）。将字典限定为节点专用并恢复 GeoIP 原逻辑后，重新运行后端 5,685 项、前端地区选择及城市联动定向 19 项；TypeScript 检查及生产构建结果见 storage/app/test-organization/browser-access/node-geography-build.log。新增字典保持原有 264 项代码和翻译，未新增迁移或改变 API 合约。

## 浏览器引导语言验证

复用 AdminBrowserPreview.test.tsx、EmbeddedBrowserNotice.test.tsx 和 localization.test.ts：遍历 14 个语言资源验证引导词条非空、占位符一致、非英语文案不再沿用英文兜底；逐语言渲染标题、iOS 提示、继续按钮、复制反馈和手动网址。检查局部 lang / dir、全局文档语言与持久化偏好不变，以及快速切换后仅显示最终语言。保留原策略、复制失败、安全链接清洗和业务页面隔离断言。

定向 89 项、全量 714 项通过，生产构建通过。全量与构建结果见 storage/app/test-organization/browser-access/languages-all.json 和 languages-build.log。本轮仅前端文案和预览调整，无 PHP、路由、数据库或接口契约修改。

## 报表分类与设置入口整理

- AdminAnalytics 使用共享 AdminTabs 拆分访问概览、来源与浏览器、购买转化、用户体验、安全访问、支付与邮件、运行健康；只挂载当前类别，时间/设备筛选在分类切换时保留。运营类禁用设备筛选，浏览器明细在最多 100 个服务端组合内按每页 20 项展示。
- 系统配置单独增加「浏览器访问」，从「安全与注册」移出 browser_policy_* 字段；仍复用原配置存储与保存校验，不迁移既有值。访问统计采集开关、保留时间移至日志与保留策略。
- 新增管理员 GET analytics/settings 只读取配置与迁移状态，不计算报表；POST 保存保持原行为。console-smoke 验证匿名及普通用户拒绝、管理员读取、no-store 和读取不修改配置。
- 新增带明确标记的 360、QQ 浏览器、搜狗、UC、Samsung Internet 分类，保留 Edge 分类。无品牌标记不猜测；无应用版本时不借用 Chrome 版本；旧匿名会话不追溯补采。frontend-runtime 使用真实数据库 SQL 检查日志分类与 PHP 分类一致。
- 本轮全量前端 699 项通过；最终布局调整后相关 16 项通过。隔离 MySQL/Redis 中 frontend-runtime 119、console-smoke 200、admin-payment-diagnostics 63、api-route-audit 2543 项通过；路由总数 346。生产构建通过。首次全量测试中旧日志页面 mock 未提供新配置响应，补齐 fixture 后全量通过。
- 测试记录：storage/app/test-organization/browser-access/tabs-all.json、tabs-focused.json、tabs-build.log。浏览器截图使用合成数据，无生产访问记录。

## 浏览器策略预览与平台扩展

- 后台安全与注册复用共享 BrowserNoticeView，预览跟随表单草稿，覆盖允许、提示后允许、仅引导以及模拟复制和继续；预览不调用用户统计或真实剪贴板。
- 新增小红书、抖音、哔哩哔哩、支付宝、钉钉、企业微信策略和报表分类，默认允许。企业微信优先于普通微信，QQBrowser 不归类为 QQ 内置浏览器。
- 前端全量 692 项通过；隔离副本 SQLite 测试库（使用现有客户端策略及风险配置迁移）运行 frontend-runtime.php，101 项通过；三处 PHP 文件语法检查通过。首次空 SQLite 库缺客户端配置表，补齐测试依赖后通过。
- 访问与转化将概览指标前置、浏览器明细折叠，并提供不会改变哈希路由的分区导航和筛选口径说明。无需新增查询或数据库迁移。
- 结果文件位于忽略目录 storage/app/test-organization/browser-access/frontend-platforms.json、build-platforms.log。

# 测试整理记录

## 浏览器策略与访问报表

- 复用 frontend-runtime、admin-payment-diagnostics、backend-security、console-smoke、api-v10-inventory、api-route-audit、client-import-language 及 update-script；无新增独立后端脚本，清单不变。
- 回归覆盖策略枚举与默认值、运行配置导出、微信/QQ/微博 UA 实际页面入口、HTML no-store、匿名浏览器首次归因与迁移重跑、IPv6 表示归一化、无效 IP 排除、脱敏与原始 UA 不外泄。新迁移接入 update.sh 定向白名单和执行顺序。
- 可选统计沿用同意、DNT/GPC、限流、会话预算与清理；隐私版本升级为 5，旧允许需重新确认，旧拒绝继续有效。登录/订阅 IP 指标仅复用必要安全日志。
- client-import-language 增加显式失败退出；修正原中文提现提示的 `:limitCNY` 占位符为 `:limit CNY`，保留原金额语义。原全局 UA 页面翻译断言改为禁止恢复旧中间件，实际前端文案和交互由组件测试覆盖。
- 所有后端集成测试在 /tmp 项目副本、随机命名测试库与独立 Redis 中运行；未使用应用数据库或应用 Redis。结果位于忽略目录 `storage/app/test-organization/browser-access/`。后端运行配置 53 项、报表 63 项、安全 92 项、契约 1571 项、路由 2536 项、语言 3203 项、控制台 197 项及升级器 26 场景通过。最终前端全量 684 项通过，TypeScript、生产构建、生成器 12 项及七份契约一致性检查通过。

## 用户旅程与体验统计（第二批）

- 复用 `admin-payment-diagnostics.php`，保留第一批全部断言，增加完整观察窗、管理员/未成熟样本排除、首次付款与订阅时序、非套餐排除、日流量/登录去重、D7/D30 独立队列、续费/到期快照、匿名数值桶/均值/分位上界、设备筛选、不污染浏览漏斗、200 事件上限、非法字段/数值拒绝、GPC、清理及幂等迁移；最终 55 项通过。
- `console-smoke.php` 增加旅程报表匿名/普通用户拒绝、管理员允许、私有响应与日期校验，完整 181 项通过。真实路由审计 2,479 项、后端安全 92 项、V10 inventory 1,518 项通过；初次 inventory 因隔离副本缺生成的 `v10-contracts.json` 失败，补齐后完整通过，未改断言。清单仍为 112 入口、14 辅助项，没有新增后端独立脚本。
- 新增就近 `JourneyAnalytics.test.tsx` 与 `product-analytics.test.tsx`，验证报表边界/过滤/刷新/失败状态、重新同意与旧拒绝保留、无同意不采集、撤回停止采集、DNT、数值白名单/凭据不上传及接口采样上限。修正 jsdom 没有 DNT getter 的夹具后，相关 47 项通过；全量 107 文件、659 项通过。最终报表文案/窄屏修正后定向 8 项通过，TypeScript、Vite 与前后台打包通过。
- V10 源合同、四份发生变化的生成物及全部七份出版物一致性检查通过；生成器既有 12 项测试通过。Windows 沙箱的临时目录权限错误通过正常本机权限重跑解决。更新脚本加入新迁移并保持 Unix 换行，既有 26 个隔离升级场景通过且断言新迁移实际执行。
- 后端使用 `/tmp/v2board-journey-report` 可丢弃副本、无数据卷独立 MySQL 容器及随机测试库；未改现有数据库权限、生产表或 Redis 数据。运行结果在 `storage/app/test-organization/journey-report/`：`final.json` 为最终专项/后台结果，`inventory-final.json` 为最终合同结果，`backend.json` 保留初次结果；`frontend.json`、`build-final.log`、`updater.log` 记录其他验证。临时预览文件/服务和独立测试数据库容器在完成后清理，未部署生产。

## 运营与安全统计

- 复用 `admin-payment-diagnostics.php` 增加日志时间边界、固定失败原因聚合/敏感字段排除、未知状态分母、风控嵌套复核/覆盖率/误报率、账户去重、币种隔离、余额订单、重复回调、邮件超时/回执/传输耗时、队列字段白名单/失败降级、任务成功时间、空数据、只读性及四分之一小时时区的跨午夜分布验证。原有支付回调与版本断言保留，共 36 项通过。
- `console-smoke.php` 通过真实路由验证匿名和普通账户拒绝、管理员允许及 no-store 响应，完整 178 项通过。现有路由审计 2,472 项与后端安全 92 项通过。测试清单未变，无新增后端独立脚本；清单校验 112 入口、14 辅助引用通过。
- 后端使用 `/tmp` 可丢弃项目副本、独立无数据卷 MySQL 容器及随机测试库，不改现有数据库权限或业务数据。首次后台回归因隔离副本缺 public，补齐后又发现缺只读 GeoIP，补齐后全量后台回归通过；没有修改或删除断言。最初应用账号无法建随机测试库，临时授权方案被自动审批拒绝且未执行，随后使用独立数据库完成验证。
- 前端新增就近 `OperationsAnalytics.test.tsx`，覆盖数字口径与说明、来源缺失、保留不足、零分母、刷新、范围切换/错误，以及原后台页面的访问时段和设备筛选独立性。连同系统/邮件日志相关界面共 16 项通过；Windows 沙箱临时文件重命名失败后在正常本机权限执行通过。TypeScript 和生产构建通过，静态包已更新。
- 结果位于 `storage/app/test-organization/operations-report/backend.json` 与 `console-final.json`；后者是后台回归最终通过结果。浏览器验证见 `frontend-validation.md`。未部署生产，未调用真实邮件/支付服务。

## 退役接口相关服务、模型与缓存定义清理

- 沿服务调用、命令/队列、V10 适配器、保留路由、测试和配置检查引用。删除无调用的 ServerLog、ServerStat 两个旧模型；删除 ServerService::log、StatisticalService 的三个旧查询入口及三个排行辅助方法、UserService 的三个用户查询辅助方法、TelegramService::discoverCommands，共 11 个方法，并清理随之失效的导入。现行日统计、后台排行榜、节点授权、邀请历史和固定 Telegram 命令菜单继续使用原实现。
- 缓存键清单移除七种退役节点类型的 21 个定义，以及旧临时令牌和邮件登录链接时间戳两个定义；当前两种节点后端、会话和一次性授权码流程保留。框架 auth/session/mail 等配置因有框架级依赖继续保留；没有修改用户实际配置、历史 SQL、数据库表或缓存数据。
- 在既有 node-backends.php 增加现行日流量聚合的写入、重载与累计验证，覆盖 V2Node/V2Box 和用户流量；仅清理本次隔离缓存键。复用既有测试入口与清单，没有新增独立脚本或前端改动。
- Docker 隔离副本与临时数据库的 12 组主回归全部通过：路由审计 2,481 项、V10 198 项、浏览器会话 499 项、控制台 163 项、完整安装回归、节点退役/聚合 730 项、V10 节点 45 项、通知投递 372 项、退役迁移 37 项、流量额度 47 项、升级脚本 26 个隔离场景、V2Box 28 项。结果位于 storage/app/test-organization/legacy-service-cleanup/backend.json，未进行生产环境操作。
- 最后两个旧登录缓存定义移除后，使用最终源码补跑登录安全 137 项、浏览器会话 499 项及一次性授权码 18 项，全部通过，结果为同目录 auth-final.json。Composer 自动加载映射同步重建，保留当前认证/统计服务；没有清空共享缓存或执行生产迁移。

## 其他退役接口的死代码清理

- 核对 V1/V2 控制器、真实路由、V10 适配器和共享 Actions/请求类；现存 197 个公开处理方法都有路由引用，未确认其他可删除的整份旧控制器。保留后台、风控、节点、历史支付回调、自定义订阅及白名单兼容入口；迁移映射中的旧符号继续作为历史来源元数据。
- 删除三个无调用的旧请求类 KnowledgeCategorySave、KnowledgeCategorySort、MailSend，以及四个未启用的默认应用中间件 Authenticate、RedirectIfAuthenticated、EncryptCookies、VerifyCsrfToken。移除 Kernel 的 auth/guest 应用别名、旧优先级及停用栈注释，清理七个控制器中的 14 个未使用导入（含指向不存在的 PaymentSave 的导入）。当前 User/Admin、BrowserSession、V10、CSRF/Origin、安全 Cookie 与原生认证流程保留。
- 复用 api-route-audit.php 核对全局中间件、优先级、别名和逐路由解析后的中间件类均可加载并有 handle 方法；原有退役入口、安全拒绝和实际路由处理器断言保留。测试清单、API 合同与数据库结构没有变化；没有增加独立检查脚本或重新生成前端包。
- 新建 Docker 隔离副本与随机测试库执行 11 组全部通过：路由审计 2,481 项、V10 清单 835 项、V10 合同 198 项、登录安全 137 项、后端安全 92 项、浏览器会话 499 项、控制台 163 项、框架 25 项、完整安装回归、节点退役 728 项、退役迁移 37 项。最终日志均含完整通过标记，结果保存在 storage/app/test-organization/legacy-code-cleanup/backend.json；本地生成类映射重新构建，未执行生产升级或生产数据库操作。

## staff 全局引用与安装升级复核

- 复核服务端源码、路由/中间件、安装与升级 SQL、迁移、前端源码及静态包、生成器、配置和缓存，并检查工作区客户端与节点源码；没有发现仍在调用的员工角色代码。剩余引用为删除列迁移及升级检查、攻击拒绝/删除防回归、退役文档，以及有实际工单含义的 awaiting-staff 协议枚举。
- 本地 vendor/composer 的生成类映射残留 7 个已删除类，重新生成优化自动加载映射；不手改依赖源码。正常升级脚本已有优化自动加载生成和配置/路由/视图清理步骤。修正文档中无需数据库变更的过期表述，指向定向升级流程。
- 扩展既有 mail-install-schema.php：空测试库导入完整安装 SQL，通过安装器实际 registerAdmin 方法创建管理员，验证密码、订阅凭据、管理员权限、认证和重复执行删除列迁移。没有运行交互安装器或改写真实 .env。
- 扩展既有 retired-node-tables.php：旧库存在角色列时签发会话，删列后验证 JWT 与浏览器 sessionUser 继续读取正确账户/权限，并验证账户表尚未创建时清理迁移不建表。原有账户、凭据、重复执行与不可恢复历史标记的断言均保留，同组 37 项通过。
- 新隔离副本与随机测试库运行 7 组全部通过：路由审计 2,452 项、登录安全 137 项、控制台 163 项、完整安装回归、迁移健康 7 项、退役迁移 37 项及升级脚本 26 个隔离场景。结果位于 storage/app/test-organization/staff-global-check/backend.json；测试清单未变，无新独立脚本。本轮没有前端业务修改、生产构建或生产数据库操作。

## 旧员工角色字段清理

- 移除管理员编辑开关、请求校验、返回投影、登录鉴权投影以及安装 SQL 中的 is_staff；升级脚本接入删除列迁移，历史攻击输入和退役 URL 的拒绝回归保留。工单 replyStatus 的 awaiting-staff 表示等待客服回复，继续保留已有协议枚举。
- 复用 retired-node-tables.php 验证旧表删除角色列、重复执行、账户及凭据保持不变、原员工不提升管理员权限，以及不可伪装恢复历史标记的回滚行为；同组共 30 项通过。升级脚本 26 个隔离场景通过。
- 路由审计 2,452 项、V10 198 项、专项安全 60 项、登录安全 137 项、后端安全 92 项、迁移健康 7 项及通知投递 372 项通过；均在 Docker 隔离项目与临时数据库运行，通知使用模拟传输，没有发送外部邮件。后台工作区 18 项、TypeScript 与生产构建通过，静态产物已更新。
- 控制台测试修正 CSV 设备列定位与现有群发任务契约；增加显式异常捕获和失败退出，避免 Laravel 错误渲染导致假成功。补齐隔离副本的只读 GeoIP 数据后最终完整执行 163 项通过，最终十组后端脚本全部通过。通知夹具先验证现有用户不可加入禁发名单，再删除临时账户以测试未注册地址的重新禁发；没有修改业务禁发策略或删除安全断言。初次及中间失败日志保留，最终控制台结果以 console-final.json 为准，通知以 recheck.json 为准。
- 测试清单未变，无新增独立测试脚本。日志位于忽略的 storage/app/test-organization/staff-role-removal；未执行生产升级或生产数据库操作。

## staff 死代码与引用清理（角色字段移除前的历史阶段）

- 确认生产路由移除后，专用实现只有测试夹具及 Kernel 别名仍引用。删除四个员工控制器、专用 UserUpdate 请求、中间件与空路由提供器，共七个文件，并移除 staff 中间件别名。此阶段暂时保留 is_staff；后续角色字段清理已移除其运行时用途并加入删除列迁移。
- 删除测试进程中的员工夹具路由。原功能约束改为在真实退役 URL 上验证：匿名/有效历史员工会话均为 404，响应不泄露目标凭据，改密/批量封禁不改变账户或会话，邮件请求不派发任务。共享 JWT 数组拒绝、管理员角色降级、敏感字段投影及管理员改密/改邮箱撤销会话继续保留。
- 路由审计同时检查专用文件不存在、staff 别名不存在、已注册路由不能引用 staff 中间件或使用任意版本 staff 前缀；未重新引入死代码只为满足测试。app、routes、tests 的主动类调用及夹具引用扫描无残留，记录中的历史类名和删除防回归断言保留。
- Docker 隔离项目与临时库执行 api-route-audit、api-v10-inventory、audit-security-regression、auth-security、backend-security、console-smoke 六组，全部通过。测试清单未变，结果位于忽略的 `storage/app/test-organization/staff-cleanup/`；无前端修改、生产部署或历史数据删除。

## 未完成的 staff API 初次退役回归（历史阶段）

- 复用 `auth-security.php`，针对 11 个退役 URL 分别测试匿名/有效员工会话（含数组查询凭据）都返回 404；原鉴权、字段与角色断言移至测试进程中的显式夹具路由，未删除安全场景。`audit-security-regression.php` 同样仅通过测试夹具执行员工控制器安全约束，未恢复生产入口。
- `api-route-audit.php` 新增禁止任意 API 版本注册 staff 前缀的断言。当前 339 条注册路由、187 条旧保护路由、669 次旧入口拒绝探测，合计 2,108 项通过；V10 认证拒绝场景保留。
- Docker 隔离项目与临时测试库执行路由审计、V10 清单、登录安全和专项安全四组，全部通过。复用现有测试文件，清单未变；兼容文档、生成器及 AGENTS 的保留范围同步更新，避免未来重新暴露已退役接口。结果位于忽略的 `storage/app/test-organization/staff-retirement/`，没有前端改动或生产部署。

## V10 认证与跨用户安全回归

- 复用 `api-route-audit.php` 为 64 个用户入口补充数组查询、JSON 数组和伪造 Bearer 拒绝；连同缺失认证共 256 次 V10 认证拒绝，路由断言总数 1,831。保留前一轮旧接口全部断言。
- `api-v10.php` 增加两个账户间订单、工单、回执和会话归属、角色/凭据字段注入、响应字段排除、账户与机器凭据隔离及认证资源禁止存储，共 198 项通过。`browser-session.php` 增加浏览器注册 Cookie/CSRF/Origin/无 JWT 响应及原生注册兼容，共 499 项通过。
- OpenAPI、映射、类型注释与生成器同步浏览器注册和 Cache-Control 合同，`api-v10-inventory.php` 共 846 项通过。首次新增断言错误假设每个自定义合同均带 status，修正为遍历已发布成功响应后通过；没有修改业务断言或跳过失败项。
- Docker 隔离项目与测试库执行路由、合同、inventory、浏览器会话、MFA、节点、一次性授权及优惠券共 8 组，均取得通过结果。前端 `v10-api.test.ts`、`UserAuth.test.tsx` 37 项及 TypeScript 通过；没有前端运行时代码变动，不重复生产打包。日志位于忽略的 `storage/app/test-organization/v10-security-review/`，未进行真实浏览器视觉检查或生产部署。

## 保留旧接口安全复核

- 扩展 `api-route-audit.php`，从实际路由集合测试所有旧管理/运营/员工/用户/客户端保护入口，覆盖缺失凭据、数组查询、JSON 数组和伪造请求头，并单独测试 V1/V2 节点密钥拒绝。350 条注册路由、198 条旧保护路由、709 次旧入口拒绝探测及 64 个 V10 用户认证入口，共 1,639 项检查通过。
- 复用 `audit-security-regression.php` 测试管理员列表/详情、邀请人投影、原始凭据字段排除、合法管理员订阅链接及普通/员工角色隔离；`backend-security.php` 测试旧用户 URL JWT 拒绝、请求头优先和三种订阅模式下的凭据类型检查；`auth-security.php` 补测退出时查询参数不可覆盖已认证请求头。
- Docker 隔离项目与临时数据库执行 api-route-audit、api-v10、audit-security-regression、auth-security、backend-security、browser-session、console-smoke、node-backends，8 组全部通过。新增退出断言另行定向复测（登录安全 59 项），管理员密码/邮箱撤销会话与正常编辑另行复测专项安全（60 项）及 console-smoke，结果位于忽略的 `storage/app/test-organization/legacy-auth-review/`。没有新增脚本、调整测试清单或执行前端构建；本轮没有前端源码改动。

## 节点显示项与员工数组凭据回归

- 复用 `frontend/src/admin/Nodes.test.tsx`，覆盖两种节点内核、数字/字符串权限组 ID 对应名称、失效权限组提示、显示列切换、重新挂载后的浏览器保存及恢复默认；保留原编辑/保存/转换等场景。节点模块共 11 项通过，TypeScript 与生产构建通过。
- 复用 `tests/auth-security.php`，完整登录安全检查共 58 项通过，新增员工数组凭据攻击、合法/非法权限与敏感字段白名单场景；没有新增测试脚本或调整清单。执行使用 Docker 隔离项目和随机测试数据库，结果位于忽略的 `storage/app/test-organization/node-columns-auth/backend.json`。
- 初次前端运行因沙箱临时文件重命名权限失败，正常本机权限运行通过。后端初次运行暴露 Symfony 提前拒绝非标量表单输入，调整断言兼容该安全行为；隔离副本补齐 V10 必需的 `docs/api-v10/contracts.json` 后完整脚本通过。未修改鉴权业务逻辑、生产数据或降低安全断言。

2026-10-14；范围为 V2Board、专用客户端 FlClash、节点 v2box 的测试、检查脚本、报告及 CI 引用。参考源码、SDK、安装包和回滚快照保留。实际业务代码及数据库迁移未改动。

## 合并与清理

- 107 个后端脚本复用 `tests/support/bootstrap.php`，71 处断言计数复用 `Assertions.php`；`autoload.php` 支持独立项目副本使用只读依赖。
- `mail-api-providers.php`、`mail-feedback.php`、`mail-campaigns.php`、`mail-blocklist.php` 合为 `mail-cases.php`，仍由 `notification-delivery.php` 执行，原场景及传输模拟保留。
- `client-version-identification.php` 并入 `client-identity.php`；保留九组版本场景，并补充旧分类不得猜测版本的断言。
- 三份 Markdown 历史报告并入已有 `frontend-validation.md`、`security-review.md`；两份客户端文本审查记录的边界并入前者。安全未决事项保留。
- 删除 101 个无引用临时脚本/日志，以及上述两份文本报告和三份过时检索输出。其中临时脚本为 `check-proxy-native.cmd`、`security-audit-repro.php`、四个历史推送暂存 Python 脚本；安装包、校验文件、备份和运行数据未清空。
- 修正旧客户端分类、退役订阅参数、邮件请求和 MFA 夹具；节点 API 复用可信本地 HTTPS 服务器，未关闭 TLS 验证。路由审计按唯一方法/路径查契约，逐请求隔离限流来源，仍严格要求未认证返回 401。

## 统一结构与入口

`tests/suites.json` 是后端文件与检查项的对应清单，按 unit、integration、api、security、regression 分类；工作进程、浏览器夹具和导出脚本单独列为辅助项。PHPUnit Unit 目录保留纯单元测试；HTTP 集成检查归入独立领域脚本。保留 Vitest 就近测试、Flutter test/plugin 目录和 Go 包内测试。

```sh
php tests/run.php --validate
php tests/run.php --list
php tests/run.php --suite=security
php tests/run.php --only=mfa,mfa-api,mfa-concurrency
```

实际执行必须使用独立项目副本、local/testing 环境和 `TEST_DISPOSABLE_WORKSPACE=1`。MySQL 测试账号须能创建/删除随机命名的测试库；测试使用专用 Redis 14/15 数据库，不能与其他任务共用。普通事务场景共享可丢弃 schema，迁移/安装场景单独建库，所有脚本独立进程运行；退出后清理所建测试库。部分检查会写配置，所以不能仅改数据库名后在运行中的项目目录执行。

后续复用模块和公共工具，新增脚本必须注册清单；更新此文件及既有浏览器验证文档，不再创建每轮开发的日期报告。运行输出保存在忽略的 `storage/app/test-organization/`。

## 执行与覆盖对比

| 范围 | 整理前 | 整理后 |
| --- | --- | --- |
| 后端完整检查入口 | 112：107 通过、5 失败 | 112 全部通过 |
| PHPUnit | 2 项通过 | 3 项通过，新增公共断言工具测试 |
| 前端 Vitest | 579 通过 | 579 通过，场景集合相同 |
| 客户端 Go 核心 | 67 场景通过 | 67 场景通过，集合相同 |
| Flutter 完整测试 | 3,174：113 失败、4 跳过 | 同样 3,174、113 失败、4 跳过；无新增失败、无丢失场景 |
| 节点 Go | 112 场景，16 失败、3 跳过 | 126 场景，1 失败、4 跳过；使用实际构建标签 with_quic,with_utls |

后端测试/辅助可执行文件保持 127 个：合并减少的四个文件换成统一执行器及三个公共工具；清单不是另一套测试。九组版本断言和邮件片段完整保留，迁移、支付/CNY 资产、权限、MFA、回调、并发与回归测试未删除。比对用例名单及断言调用点未发现覆盖场景减少；本次未生成跨框架的统一行覆盖率百分比。

其他检查：Flutter pub get、analyze 通过；五份 CI/CD YAML 解析、清单引用、PHP 语法、Git diff 空白检查通过。现有 CI 文件引用保留，未触发 GitHub 托管构建或发布；原有 75% Flutter 覆盖率门槛未降低。

## 需人工处理

- Flutter 原有 113 项失败涉及旧界面/配置、平台夹具、生命周期等，完整失败名单在本地结果 JSON。原用例保留；静态分析通过不能替代这些失败的修复。
- 节点 `TestRejectedReloadIsRetriedWithoutConfigChange` 仍用 HTTP 夹具，与强制 HTTPS 不符；跨包私有客户端缺少测试信任注入入口，本次未修改业务接口或削弱 TLS 来适配它。
- 节点面板联调夹具、外部 padding preset、长时间 soak 场景缺少输入/显式开关而跳过；Flutter 四项显式跳过未改动。Linux/macOS/Android 原生矩阵、Rust/插件完整矩阵及实际 CI 覆盖率作业未执行。
- 因保留的 Flutter 与节点失败，不能声称整个 CI 已全部变绿。真实邮件、支付、节点联通和生产部署不在本次离线验证范围。

## 前端后续精简

- `admin-city-select.test.tsx` 与 `admin-region-select.test.tsx` 合并为 `admin-location-select.test.tsx`，复用同一 jsdom 环境、API 模拟、编辑器导入和清理逻辑。
- `payment-icons.test.ts` 合并至 `payment-fields.test.ts`，统一支付配置测试；所有原用例及断言保留。
- 前端测试文件 106 → 104；完整 Vitest 579 项全部通过，与原结果按合并路径映射后的用例集合逐项一致。首次沙箱运行因临时文件重命名权限未执行用例，正常本机权限重跑通过。
- 已检查旧测试路径引用及 Git diff 空白；业务代码、构建脚本和 CI 配置未修改。MFA、邮件、安全与其他不同模拟环境的测试保留独立组织。本轮未重新执行生产构建或托管 CI。

## 前端用例定向审查

- 全量扫描 104 个测试文件的跳过/独占执行及直接延时写法；未发现匹配项。依据执行耗时及重复名称筛选，人工抽查金额转换、支付配置/图标/结算/轮询、API 字段映射、节点、后台工作区、MFA 登录、邮件日志/黑名单、优惠券展示/选择等模块；不是全部 579 项的逐项语义审查。
- 保留看似重复的金额输入与字符串输入边界、不同订单类型的字段映射，以及组件/集成层断言；这些覆盖不同输入或调用路径。未确认可安全删除的重复用例，本轮未删除测试。
- `PaymentCheckout.test.tsx` 提取统一渲染准备，复用四个场景的默认订单和组件参数，保留各场景独有的金额、币种、订单编号及回调。
- `PaymentMethodPicker.test.tsx` 使用可恢复的全局配置替换，清理后恢复原 V2BOARD，避免用例相互影响。
- 完整 Vitest 104 文件、579 项全部通过；与上轮结果逐项比对文件及用例名称集合完全一致。业务逻辑未改动，未重新执行生产构建或托管 CI；尚未进行全部用例的人工语义审查。

## 支付分层与定位优化

- 将 `BillingFlow.test.tsx` 中周期筛选/手续费、节省比例、购买动作三项纯计算用例迁入既有 `shared/order-price.test.ts`，无需 DOM 或购买组件模拟即可执行。原断言与输入保留；组件交互与关键购买流程仍在原模块。单元文件现在集中覆盖订单历史金额与计费计算。
- V10 请求字段的参数化名称包含请求体，区分原来同名的充值和流量包下单场景；没有删除任何合同断言。
- 模块命令：`npm run test:payments`（金额/结算/流程/后台配置/回调展示/API 映射）、`npm run test:mfa`（MFA 与登录）、`npm run test:mail`、`npm run test:coupons`。继续保留 `npm test` 全量入口；模块间交叉覆盖是刻意保留的联调保障。
- 全量 579 项全部通过；规范化改名后用例集合及数量与上轮一致。四个独立模块命令实测通过：payments 109 项, mfa 34 项, mail 19 项, coupons 16 项。未新增测试文件、临时验证脚本或报告，未修改业务代码或降低覆盖。
- 本轮改善职责与失败定位，不声明全项目语义重复已全部清除，也不以不同机器负载下的运行时间宣称提速。

## v3 工作区构建产物清理

- 删除 Flutter build、Dart 构建/Hook 缓存、Vite 缓存、多轮 Windows 测试解压目录和旧版本 ZIP/校验文件、Go 临时运行测试产物、临时对象/JNA/daemon 文件及历史本地构建日志；清理浏览器临时验证输出。共删除 13,415 个文件，约 6,312.8 MiB，删除过程无失败。
- 保留最新节点预览与安全预览 Windows ZIP，两包 ZIP 完整性检查通过；保留 Android/macOS 核心产物、源码及测试、依赖和 SDK、设计截图、回滚/推送快照、失败记录及本轮覆盖对比结果。Dart package_config 等依赖元数据保留。
- 路径均在 v3 工作区内，删除前检查运行进程、Git 跟踪和相关文档/构建引用；构建目录中的链接仅移除链接本身。源码/测试及发布前端存在性检查通过。
- 本次仅清理可再生成产物，未重新构建或执行测试，以免立即重新生成清理的缓存；下一次 Flutter 构建需重建核心/Hook 缓存，首次构建耗时会增加。

## 前后台模块职责整理

- 后台设置、支付和节点管理移入各自功能模块，原 `admin.tsx` 导出继续兼容；后台路由按需导入所属模块。字段与名称列定义复用 `admin-fields.ts`，公共展示文案归入 `admin-presentation.ts`。
- 用户端套餐目录、订单确认与购买步骤条分别维护，结算与使用情况页面直接依赖所需组件；登录验证码倒计时复用已有 `useCooldown`。没有增加测试文件或独立检查脚本。
- 保留原有断言，更新后台导航、邀请搜索、语言选择器和禁发备注的过期文案定位；付款与轮询测试模拟指向步骤条的新所属模块，佣金审核测试等待明细加载后再提交。同步既有 V10 前端字段映射与来源统计契约。
- 定向回归 9 文件 90 项通过；全量执行 104 文件 596 项，其中 102 文件通过、两个文件因旧文案定位失败。修正定位后定向复测这两组及 V10 映射共 3 文件 30 项全部通过，失败项已全部消除。没有删除或跳过用例。
- TypeScript 与生产构建通过，前后台包分别生成。未执行浏览器验证或 PHP/数据库测试；本轮重构涉及 React/TypeScript 组织结构。先前未提交的来源统计与迁移改动保留，未部署到生产。

## 冗余代码与引用检查

- 检查前端静态/动态导入、重导出与测试引用；本轮未确认可安全删除的整份源码文件。当前 `public/console/assets` 与 Vite 清单核对后无孤立构建资源。内容相同的地区旗帜和默认/自定义规则模板有不同资源标识或配置用途，保留。
- 清理 9 个文件中的 34 个未使用导入；移除仅测试使用的 `resolveLanguage` 和 `mirrorUpdates` 包装函数，原断言直接覆盖生产使用的 `resolvePreferredLanguage` 和 `inspectMirrorUpdates`。保留现有测试文件、用例与兼容导出，未删除迁移或检查脚本。
- 将 TypeScript 未使用声明与参数检查接入正常构建，避免引入第二套检查工具。完整 Vitest 104 文件、596 项通过；TypeScript 和生产构建通过。未进行浏览器或 PHP 动态调用链验证，不据此认定后端动态引用代码无冗余。


## 多语言漏译回归整理

- 复用 localization.test.ts 自动扫描用户端及公共组件，取消固定文件名单；仅排除有意保留的语言本名与管理员状态词。检查中文文案注册、直接 JSX 硬编码、14 种语言全部功能命名空间及插值变量。品牌、平台、单位和服务商要求的署名保留原文。
- 将重复的 6 组新增语言命名空间测试合并到 14 种语言的完整检查；原有实际加载断言保留在全语言资源加载检查中，另增加旧语言支付说明非英文占位断言。测试由 629 项调整为 624 项，未跳过或减少语言、业务、安全场景。
- 复用 client-import-language.php 核对后端实际 __() 字面量调用与语言资源、占位符、内置浏览器提示及波斯语方向；api-v10.php 覆盖 14 种语言的未授权问题响应与稳定状态码、code、Content-Language。
- 完整前端回归 104 文件、624 项通过；TypeScript 检查与生产构建通过。隔离副本及临时数据库执行 api-v10、client-import-language、product-mail、apple-accounts，4 个脚本全部通过。第一次后端执行因本地账号建库权限不足而未能运行，改用本地测试环境的数据库管理员权限后通过；第一次前端全量的一个旧按钮文字定位已更新并全量复测通过。
- 本轮没有新增测试脚本或 Markdown 报告。运行日志位于忽略的 storage/app/test-organization/localization-repair；未进行浏览器验证或生产环境操作。

## 旧接口退役后的队列与命令检查

- 复用 `tests/framework-upgrade.php`，检查所有实际调度命令、每日任务和安装/升级/人工运维命令均可注册解析，不执行真实业务调度。
- 回归旧 `SendTelegramJob` 的序列化往返与空操作消费、`telegram:notify` 外部 cron 兼容，并以 HTTP 替身禁止实际发送。
- 删除空 Test 命令及 6 处无用导入；保留有现行业务或升级兼容用途的 Job、队列、调度、脚本和命令。
- 在隔离副本与测试库中验证 framework-upgrade、timezone-scheduler、horizon-config、node-traffic-batches、node-backends、notification-delivery、mail-install-schema、retired-node-tables、update-script、update-drain、update-restart；结果见忽略目录 `storage/app/test-organization/legacy-queue-cleanup/backend.json`。
- 本轮 11 组全部通过；framework-upgrade 85 项、节点 730 项、流量批次 25 项、通知 372 项、退役迁移 37 项；未发送真实外部消息，未迁移生产库。

## 工单回复与自动关闭回归

复用 console-smoke 验证管理员回复保持开启、最后回复不足 24 小时不关闭、超过 24 小时且最后消息来自管理员时关闭、用户追问不关闭、旧表单不能重新打开已关闭工单、非文本回复被拒绝。通过 retrieved 事件模拟调度扫描后收到新回复，验证关闭前会在行锁内重新读取状态。保留每分钟 check:ticket 调度。api-v10、notice-reads、notification-delivery 覆盖现行用户接口和通知兼容。结果位于 storage/app/test-organization/ticket-review。

前端 admin-workspaces、AdminUserActivity、HelpSupport 共 29 项通过，覆盖对话中的邮箱抽屉、关闭抽屉后回到对话、发送回复不调用关闭接口、清空已发送草稿，以及恶意 img/svg 标签仅显示为文本。

用户活动详情改版复用 AdminUserActivity.test.tsx，补充类型筛选计数、分类空状态、明细字段、UA 默认折叠及不解析 HTML 的回归；与 admin-workspaces.test.tsx 合计 22 项通过。此次仅改变展示，未修改后端查询或接口权限。

后台显示设置统一复用 admin-workspaces.test.tsx 和 Nodes.test.tsx，保留用户列选择、排序恢复及节点偏好持久化断言，新增通用资源列表列偏好保存、重新打开恢复与重置验证。节点选择控件统一为 aria-pressed 按钮，测试同步更新，不新增独立测试模块。

## 后台共享导航与筛选回归

复用 admin-workspaces.test.tsx，新增标签与面板 ARIA 关联、键盘方向键跳过禁用项、手动激活不提前请求，以及筛选选项不提交表单/忙碌时禁止切换的回归。仪表盘和邀请标签切换改用 Radix 实际 mousedown 交互；保留原业务请求断言。后台 47 个测试文件、210 项全部通过。

## 旧邀请码统计与未使用头像字段清理

退役 POST /api/v10/public/page-views，移除路由、适配器、统计 Action、前端映射及 OpenAPI；账户接口不再计算或返回第三方 avatarUrl 邮箱指纹，同时清理验证码 Action 未使用的私有方法和导入。保留 InviteCode 模型、历史表、管理员删除账户时的记录清理，以及 retired-codes 的 410 兼容响应。现行匿名 analytics 统计和邮件邀请不变。

复用 api-v10.php，新增匿名/登录请求旧统计入口均为 404、旧记录 pv 不变和账户响应不含头像地址/邮箱 MD5 的回归；复用 v10-api.test.ts 验证退役映射拒绝及头像字段不会被解析。Docker 一次性副本与随机测试库验证路由审计 2475 项、V10 合同 203 项、接口清单 830 项、邮件邀请 40 项通过。首次清单测试因副本遗漏 AGENTS.md 与类型声明失败，补齐后复测通过，日志保存在 storage/app/test-organization/unused-features。前端 19 项通过，类型检查和生产构建通过。未修改安装 SQL、迁移或业务数据，未发送真实邮件。

## 历史兼容入口复核与清理

进一步移除仅返回 410 的 `/api/v10/me/invitations/retired-codes`、V10 控制器方法、InviteActions::save 及两侧契约/前端映射/OpenAPI，当前返回 404。复用 email-invitations.php 验证匿名与已登录调用均为 404、旧邀请码数量不变，保留现行邮件邀请与跨用户隔离断言；v10-api.test.ts 增加前端旧生成调用拒绝。旧注册 inviteCode 输入仍明确拒绝，避免忽略旧参数导致错误注册归属。

本轮保留：仍在迁移窗口内的浏览器 JWT 兑换、V1 后台依赖、旧支付及节点/客户端入口、下载和页脚配置回退、历史邀请码数据清理、账务/权益转换与数据库迁移，以及消费旧队列的 Telegram 空任务、外部 cron 兼容命令和升级提示命令。代码中仍有调用或明确升级职责；未将本地环境的未使用状态当作所有安装均可删除的依据。

一次性副本和随机测试库验证六组全部通过：路由审计 2465 项、接口清单 824 项、浏览器会话 490 项、邮件邀请 42 项、框架 85 项及全新安装管理员创建/认证和重复迁移回归。前端 v10-api、browser-session、ClientDownload 共 32 项通过，类型检查及生产构建通过。结果位于忽略目录 storage/app/test-organization/compatibility-cleanup。没有改动安装 SQL 或数据库迁移，没有操作业务数据库或发送真实邮件。

补充旧库 retired-node-tables 与 update-script 两组隔离回归全部通过，结果见同目录 upgrade.json；连同上述六组，本轮八组后端检查均通过。

## 契约单一维护源与目录整理

V10 统一由 `api/v10/openapi.json` 生成七项发布文件，删除两套竞争文档生成器。复用 `api-v10-inventory.php` 验证规范源与运行字段投影/端点、前后端完整契约的一致性；前端 `v10-api.test.ts` 验证两侧定义不再遗漏原生端点。生成器另在临时目录验证确定性、只读漂移失败、重复 operationId/别名、缺失引用及清单顺序的拒绝行为，`--check` 通过。

14 个邮件服务迁入 `App/Services/Mail`，同步所有直接及分组导入。邮件服务实现内容不变，Job 类与载荷不变。复用 `product-mail.php` 增加序列化任务恢复后的连接/队列保留、载荷不持有服务实例及模拟投递断言。

一次性项目副本与随机数据库覆盖 12 组：api-route-audit、api-v10-inventory、api-v10、browser-session、content-translations、email-invitations、framework-upgrade、mail-install-schema、notification-delivery、product-mail、retired-node-tables、update-script。首次 notification-delivery 发现分组导入遗漏，修正并复测邮件两组、路由审计及接口清单全部通过；最终十二组均通过，接口清单 1224 项、路由审计 2465 项。测试登记校验为 112 个入口及 14 个辅助文件。结果位于忽略目录 `storage/app/test-organization/structure-refactor/{backend,mail-recheck}.json`。

全新安装验证完整 install.sql、管理员创建和认证以及重复迁移；旧库验证退役表迁移及升级脚本。未修改启动骨架、安装 SQL、迁移、update.sh，也未操作业务数据库或发送真实邮件。生产部署仍需刷新 Composer 自动加载并重启长驻工作进程，生成器仅为开发工具。

目录整理复查补充：修复 mapping 迁移遗漏节点表格后说明的问题，规范说明现在用 operation-table/node-table 两个标记保留所有原有段落；工单通知 ticketId/messageId/createdAt 恢复必填，inbox 复用同一具名 schema。复用 v10-api.test.ts 增加说明段落完整性及必填字段回归，相关三个前端测试模块共 77 项及类型检查通过。逐项比对确认拆分的 18 个 UI 声明与原实现一致，14 个邮件服务实现内容、PHP 运行契约和安装升级边界不变。

复查补正后的 api-v10-inventory 在一次性副本和随机数据库再次通过（1224 项），结果见同目录 review.json。统一生成只读检查及 git diff --check 均通过。

## 上线前全面回归

在新的完整一次性副本及运行器生成的随机数据库、独立 Redis 前缀执行全部 112 个登记入口：API 9、集成 48、回归 21、安全 21、单元 13。首次 111 项通过，console-smoke 因副本排除 storage 时漏带仓库跟踪的 GeoIP 文件而失败；补齐三份数据库资源后单独复跑通过。最终所有 112 项均通过，未放宽测试断言。日志与汇总位于忽略目录 `storage/app/test-organization/preflight/{backend,smoke-recheck,summary}.json`。

覆盖后台操作与字段边界、V10/保留路由鉴权、MFA/会话并发、支付结算、邮件/工单/队列、节点和订阅、完整 install.sql、旧库迁移、用量并发、升级排空/重启/失败保护。623 个 PHP 文件语法检查通过，契约 --check 及 diff 空白检查通过。前端 104 个文件、636 项通过，生产构建和资源闭包核对通过。

Composer validate、当前 PHP 8.4.26 下生产平台要求和锁文件审计通过，审计无 advisories/abandoned；npm 生产依赖审计为零。独立部署目录生成优化自动加载（14 个迁移后的邮件服务均从该目录解析），生产配置/路由/视图缓存可重建，337 条缓存路由保留鉴权边界。公开管理员 MFA 登录入口按既有精确例外校验，另有有效绑定挑战/角色/限流回归，未误加登录前无法满足的 admin 中间件。

`composer install --dry-run --no-dev` 计划为 0 安装、0 更新、34 个开发包移除；未下载或修改原 vendor。无开发依赖演练最初沿用了开发包的发现缓存，导致 Collision Provider 找不到；将独立目录安装元数据过滤为锁文件生产包并清除其旧缓存后，包发现、配置/路由/视图缓存、route:list 全部通过。这是隔离演练修正，不是应用代码修复，也不等同于在生产执行安装。

本轮修正部署文档中的旧 PHP 8.1/8.2、旧分支地址、忽略 composer.lock 及根 readme 切到上游 master 的过时指导；没有修改启动骨架、数据库迁移或 update.sh。用户确认列出的有历史金额校验限制的旧支付适配器均未启用；保留该限制说明，不把未启用当作协议已修复。未推送或部署生产，真实域名/TLS/CDN、PHP-FPM/Supervisor、实际邮件交付与支付商回调仍需受控上线验收。未发送真实邮件或付款，未操作业务数据库。


## V10 公共定义与业务模块

维护源改为 `api/v10/openapi.json` 清单及 11 个业务/公共模块，公共组件包含 12 个响应、3 个响应头和 19 个参数定义。发布 OpenAPI 仍为完整单文件，约 592 KB 降至 397 KB；维护源合计约 717 KB 降至 523 KB。对拆分前后所有 93 个 path item、156 个 schema、安全方案、运行契约、节点导出和 TypeScript 声明逐项比较，展开新增公共引用后语义一致。路径方法、字段 required、鉴权、缓存策略、响应描述均未改变。

新增长期维护的生成器标准库回归模块 `scripts/test_generate_v10.py`，入口 `python -m unittest discover -s scripts -p test_generate_v10.py`，10 项通过；这是开发工具单元测试，不启动 Laravel 或数据库，不属于 PHP 后端运行器清单。覆盖确定性、七项产物漂移、只读检查、重复/遗漏模块、目录越界、重复 JSON key/路径/组件/operationId/别名、引用缺失/外部引用/公共引用循环及清单完整性。首次执行遇到 Windows 沙箱临时目录写权限限制，将 TMPDIR 指向可写的忽略目录后通过，未放宽断言。

复用 `api-v10-inventory.php` 增加模块合并和公共引用解析检查，在一次性项目副本及随机数据库执行 7 组：api-route-audit、api-v10-inventory、api-v10、node-v10、mail-install-schema、retired-node-tables、update-script，全部通过。接口清单 1511 项、路由审计 2465 项；测试登记仍为 112 个入口和 14 个辅助文件。前端现有契约测试 22 项及 TypeScript 检查通过，生成器 --check 通过。结果位于忽略目录 `storage/app/test-organization/contract-modules/backend.json`。

生产仍直接加载已提交的运行契约，不执行模块装配；本次未修改路由控制器、业务服务、启动骨架、安装 SQL、迁移或升级脚本。节点兼容导出内联新增公共引用，保留原形状。


## 当前文档与实现核对

全局检索并核对浏览器鉴权、CORS、多币种、支付报价、安装器、Composer 锁与 update.sh 实现，修正旧 Bearer/localStorage、CNY-only、全量 migrate、旧 PHP 路径、成功一律保留维护等说明。Laravel 9–12 记录保留历史版本事实并明确指向当前流程；新安装与旧库升级分开说明，记录安装器逐条 SQL 异常处理及 APP_ENV 模板默认值的实际限制。

本轮只修改 Markdown；映射说明从 `api/v10/mapping-notes.md` 重新生成发布文件。生成器 10 项、前端契约/浏览器会话 2 文件 28 项通过；七项生成结果 --check 通过。Markdown 相对文件链接核对通过，运行契约、OpenAPI JSON、类型、PHP/前端实现、SQL 与 update.sh 无差异。没有运行实际安装、迁移、依赖更新或生产部署，没有将旧的全量回归结果冒充本轮执行结果。


## 逐文件扫描后的容错与公共处理优化

复用 mail-install-schema、console-smoke、payment-presentation、framework-upgrade、api-v10-inventory、api-v10、update-script 七组覆盖安装、GeoIP、支付展示、框架、契约和升级。安装测试运行真实交互命令，在独立空数据库导入完整 SQL、创建管理员，并验证非空数据库/已有环境拒绝、SQL 失败、重复环境写入及特殊字符 roundtrip。测试自身要求 TEST_DISPOSABLE_WORKSPACE=1。没有增加后端入口，登记仍为 112 个入口及 14 个辅助文件。

首轮七组中五组通过，非空检查因 Laravel 13 getTables 默认跨库枚举而误拒绝空测试库，改为显式限定目标数据库；GeoIP 新夹具将原先缺省配置恢复成 null，修正为完整恢复原配置。两组重跑通过，最终七组均通过，没有放宽原有断言。623 个 PHP 文件全局语法扫描及最终修改文件复核通过。共享 vendor 的一次性副本直接运行 Artisan 时自动加载指回原目录；仅修正映射后仍使用副本默认数据库配置而连接被拒绝。最终将 console:verify 加入现有 console-smoke，通过测试运行器的副本映射及随机数据库验证，不修改生产自动加载器。结果位于忽略目录 storage/app/test-organization/code-quality/{backend,recheck,console-final}.json。

生成器标准库回归扩展到 12 项，覆盖畸形模块/非字符串引用；--check 仍确认七份产物无漂移。前端全量与生产资源验证见 frontend-validation.md。测试没有执行生产安装、迁移、支付或邮件发送。


## 全业务自动化模拟回归

对当前工作区代码创建新的完整一次性项目副本，包含已跟踪 GeoIP 数据和生产前端资源，通过 tests/run.php 执行全部 112 个登记入口，无漏跑、无重复、无失败：API 9、安全 21、集成 48、回归 21、单元 13。运行器使用随机临时数据库和 Redis 14/15 上独立的随机前缀，结束后清理测试数据库，不清空业务缓存。

覆盖注册与邀请、Cookie/CSRF/Origin、原生登录、MFA 与会话并发、订阅授权和配置、套餐/余额/充值/优惠券、多币种报价与支付快照、取消/替换订单、回调幂等、返佣、邮件/工单通知与回复满 24 小时关闭、后台用户/日志/风控、节点/地址/DDNS/流量去重和额度、用量重置、安装及旧库升级、队列排空和恢复。支付、邮件、翻译及云服务使用各领域已有测试替身，不产生真实扣款、邮件或云资源变更。

汇总逐一比较 suites.json 与结果 ID 集合，确认 112/112 全部完成；前端 104 文件 645 项及类型检查通过，生成器 12 项和七份产物 --check 通过。结果保存在忽略目录 storage/app/test-organization/business-simulation/{backend,summary}.json 和 frontend.log。本轮没有发现新的失败，未修改业务实现；模拟覆盖来自现有自动化用例，不能等同于所有设备、生产配置和外部服务真实联调已验收。


## Passkey 与 Google 组件清理

沿用 auth-security、mfa-api、console-smoke、frontend-runtime 等已登记模块：旧 reCAPTCHA 配置不再影响密码登录；后台规则移除旧字段并提供 passkey_enable；保存配置清理 Google 旧键；真实 ES256 注册/签名贯穿用户和管理员的 Cookie、CSRF、Origin、MFA 流程。mfa-api 同时验证 RP、UV、签名/计数器、一次性与过期挑战、发起浏览器绑定、管理员越权、跨账户删除、数量限制、关闭开关、凭据撤销及会话退出。新安装 SQL 与升级迁移保持一致，迁移重复执行无损。

发现原 mfa-api 未设置异常退出处理，Laravel 的全局处理器使失败断言可能返回 0；已显式设置失败退出码，并修正限流测试清理键的前缀。修复后检查完整输出的完成计数，全部断言实际完成。首次合并运行邀请模块触发共享测试限流，独立重跑 42 项通过；首次设置保存测试因 config:cache 后在同进程继续发送旧测试凭据而失败，改为一次保存完整目标配置，185 项通过。没有移除业务断言。

所有后端检查在 /tmp/v2board-passkey-report 一次性副本、随机数据库和专用一次性 Redis 容器运行，不清空应用缓存。认证安全 137、后端安全 92、浏览器会话 524、MFA 57、路由审计 2537、V10 清单 1571、运行时 17、语言偏好 47、注册策略 16、邮件邀请 42 项均通过；最终 Passkey/MFA 114 项、迁移健康 7 项、配置保存 185 项通过；结果见忽略目录 storage/app/test-organization/passkey-report。升级脚本 26 场景和生成器 12 项通过，七份契约产物 --check 无漂移。前端验证见 frontend-validation.md。未运行生产安装、迁移，也未产生真实邮件。


## Passkey 安全与兼容复核

修复会话兑换刷新验证时间的问题：AuthService 保存独立 authenticated_at，浏览器链接、客户端授权和令牌迁移继承源会话的验证时间；没有可信时间的旧会话不能管理 Passkey。令牌迁移携带已验证的 MFA 版本。删除取得账户行锁后重新核对会话、密码、邮箱和验证时间，并提升安全版本以撤销未完成的安全与授权挑战。

mfa-api 沿用真实路由、Cookie、CSRF 和真实密钥签名，覆盖 ES256 / RS256 / Ed25519、备份凭据的零计数器、无效备份标志、畸形 JSON/CBOR、错误 RP/Origin、默认端口与大小写、旧密码验证、撤销与锁等待、跨账户删除和实际限流。mfa-concurrency 扩展两个真实并行进程场景：同一 Passkey 挑战和不同挑战上的相同签名计数器都只能消费一次，保持原 MFA / 恢复码 / TOTP 并发断言。

复用 browser-session、fastai-browser-login、session-authorization、auth-security、backend-security、console-smoke、frontend-runtime、api-route-audit、api-v10-inventory 验证会话和兼容边界。最终 Passkey/MFA 197 项、浏览器会话 525 项、后台 185 项通过；前端 109 文件 675 项、类型与生产构建、生成器 12 项和七份契约 --check 通过。其余脚本和完整输出见 storage/app/test-organization/passkey-audit/。

检查完整输出发现原 fastai-client-config 也存在失败却返回 0 的旧问题，已补严格异常退出码和响应状态断言，并显式指定节点夹具顺序。扩展回归发现旧 V2Box 表缺少可选显示字段时预览返回 500；预览现按实际表结构取显式白名单，缺省字段维持空显示，不扩大敏感字段投影，不修改数据库结构。所有后端执行于 /tmp/v2board-passkey-audit 一次性副本、随机测试数据库和本轮专用 Redis，未清空应用缓存。日志不记录原始证明或凭据，设备真机验收范围见 frontend-validation.md。


节点显示模块的完整输出复核还发现历史城市词典缺少部分语言条目，且该脚本同样未设置异常退出处理。现已让 NodeDisplayService 的目录与名称渲染一致：缺失条目显式使用既有英文回退，不伪造本地语言翻译；node-display 保留原有所有语言覆盖断言并严格失败退出。该修复不修改原始词典和表结构。


最终归档：15 个相关后端模块均有完整成功输出，Passkey/MFA 197 项，原生配置 65 项；节点显示和订阅信息复测通过。summary.json 排除旧日志中的假成功，仅收录最终明确完成的结果。前端 675 项与构建通过，测试容器已停止，未部署生产。

后台菜单逐页回归归入既有 frontend/src/admin/admin-workspaces.test.tsx，使用 test-support/page-fixtures.ts 统一空数据响应；覆盖所有 legacyAdminMenu 入口加载、标题与异常边界。浏览器截图、窄屏布局记录、全量 Vitest JSON 与构建日志仅写入 storage/app/test-organization/，不提交临时预览入口。

用户导出及生成退役回归复用 api-retirement.php、console-smoke.php 与 admin-workspaces.test.tsx，下载公共测试改用仍在使用的优惠券接口；不新增独立测试脚本。

## 账户删除与后台时间回归

复用 tests/auth-security.php，新增默认关闭、认证与确认、密码校验、越权目标拒绝、管理员/资金/订单/佣金/工单拦截、近期登录、清理失败回滚、身份匿名化、会话与 Passkey 撤销、账务保留、禁止恢复和排队邮件抑制断言。隔离 SQLite 项目副本 163 项检查通过，V10 路由清单 1588 项检查通过。数据库迁移验证了缺列升级、重复执行与回滚仍保留删除标记；update.sh 的 26 个隔离场景通过。V10 生成器 12 项测试通过，7 个生成文件一致。

前端复用 AccountPreferences.test.tsx 与 AdminLogFilters.test.tsx，覆盖关闭时隐藏入口、阻断原因、三重确认、删除失败保留会话、成功清理会话、后台共享日期渲染、单次时区提示、ISO/夏令时及显式导出偏移。运行结果保存在 storage/app/test-organization/browser-access/account-deletion-complete.json；生产构建日志为 account-deletion-complete-build.log。没有新增独立可执行测试模块。

未操作真实业务数据库；MySQL 测试账号无法创建隔离库，因此数据库验证使用 SQLite，MySQL 行锁并发语义仍需具备专用测试库后验证。

最终全量前端结果：780 项通过、0 项失败；所有新增用例包含在该次完整执行中。

## 节点字典维护回归

复用 tests/node-display.php，增加多语言覆盖/回退、恢复默认、代码及归属不可变、非法代码与名称拒绝、乐观版本冲突以及真实管理员路由权限检查。测试因新增数据库依赖，从 unit 调整到 integration；112 个测试及 14 个辅助入口清单校验通过。一次性项目副本与 SQLite 数据库运行 5700 项检查全部通过，修改事务回滚，不读取生产数据。MySQL 行锁并发行为未在本机验证。

新增的 AdminDictionary.test.tsx 位于对应组件旁，覆盖编辑、恢复默认需保存、冲突保留输入、分类切换；复用 Nodes.test.tsx 和后台全菜单页面夹具，复用 UsageBilling.test.tsx 验证重复入口移除且业务操作保留。全量前端 786 项通过，相关最终回归详见 dictionary-final-focused.json。

新表 v2_node_dictionary 独立保存节点展示名称覆盖值与版本，不提供任意业务枚举 CRUD，不删除被引用的代码。保存按项执行事务、行锁与版本比较；操作日志记录管理员与字典键，查询在请求作用域内复用，后续请求读取新数据。迁移及安装表定义保持一致；update.sh 的 26 个隔离更新场景包含新迁移执行断言。

## 账户偏好、套餐展示与统计说明

复用 AccountPreferences、TimeZonePicker、UsageBilling、JourneyAnalytics 组件测试，共 32 项通过。保留偏好保存失败重试、账单业务行为等断言；留存说明断言跟随精简后的统计口径更新。邮箱只读展示使用普通文本元素，避免 output 的隐式 status 角色干扰保存反馈。未新增测试入口或修改后端统计逻辑。

## 后台刷新入口清理

静态配置列表（路由、风控规则、优惠券、礼品卡、节点字典）移除常驻刷新按钮，继续使用保存后重新加载与加载失败重试。字典保存失败时保留输入，取消或关闭编辑后重新加载，支持版本冲突后的再次编辑。经营概览合并为一个刷新入口，同时刷新概览、系统状态、订单和四项排行榜，并在任一请求进行时禁用按钮。日志、在线用户、订单、节点监控、异步任务、报表以及汇率等实际业务刷新操作保留，不新增轮询。

复用 admin-workspaces.test.tsx 和 AdminDictionary.test.tsx，验证统一刷新覆盖所有数据源，以及冲突取消后的恢复流程；结果位于 storage/app/test-organization/browser-access/admin-refresh-cleanup.json，构建日志为 admin-refresh-cleanup-build.log。本轮未进行浏览器视觉验证。

## 后台用户抽屉统一

用户管理、日志、在线用户、风控和工单账户入口统一使用 AdminUserDetails，包含活动记录、邀请用户、订单和流量记录。将活动内容独立为 UserActivityContent，避免共享抽屉依赖整个用户管理页面；删除旧 Activity 包装与 user-activity-drawer 样式。各标签按需加载，日志行使用 user_id 而非日志 id，未识别用户不提供打开入口，历史已删除账户提示保留。邀请、订单、流量使用后台统一时间格式并显示一次时区说明。

复用 AdminUserActivity.test.tsx 和 admin-workspaces.test.tsx，覆盖日志入口四标签用户过滤、活动筛选、未识别用户、工单嵌套抽屉关闭返回及用户管理回归。报告为 storage/app/test-organization/browser-access/user-drawer-unification.json；构建日志为 user-drawer-unification-build.log。本轮未进行浏览器视觉验收。

## 字典管理筛选与预览

复用 AdminDictionary.test.tsx 覆盖自定义／内置来源筛选、切换语言仅预览不保存，保留固定代码、版本、保存、恢复默认与冲突取消回归；复用 Nodes.test.tsx 验证节点字典消费者。未修改后端字典存储及接口。

## 客户端识别库回归

复用 security 套件 tests/client-identity.php：内置 UA 与版本回归、自定义首产品识别、伪装浏览器及子串拒绝、白名单隔离、非法／冲突别名、全库版本冲突、恢复默认、真实管理员 GET／预览／保存及非管理员拒绝。增加日志识别与原始 UA／代码保留、OperationsAnalytics 应用分组准确性验证。新增部分使用隔离项目 SQLite 和回滚事务；不要在生产环境执行。复用 admin-log-search.php 验证列表搜索及分页。

前端复用 AdminDictionary.test.tsx 验证服务端预览不保存、冲突保留输入、取消重新加载与恢复默认版本提交；复用用户活动、后台全菜单与运营报表模块。更新公共合成页面夹具。清单仍为 112 个测试和 14 个辅助入口。结果位于 storage/app/test-organization/browser-access/client-recognition-*.json/log。

客户端识别库最终验证：全量前端 790 项通过，后端客户端识别 278 项与日志搜索 6 项通过，生产构建通过，更新脚本 26 场景通过。尚未提交或推送。

## 性能、后台告警与功能治理

系统监控统一为 AdminObservability，健康与队列读取每分钟缓存快照，进程详情按需加载；移除原 SystemHealth 展示组件及重复状态卡片，保留兼容 API。新增配置抽屉复用 Modal、Table 和统一后台时间。前端构建同时生成 build-metrics.json，独立部署包也包含报告。

复用 AdminDiagnostics.test.tsx 验证未运行／过期不显示健康、健康与失败检查并列、迁移提示、队列不可用及保存采样开关；复用 admin-workspaces.test.tsx 验证系统监控按标签加载。build-metrics.test.mjs 验证循环／共享依赖去重、动态页面与启动模块区别及清单缺失失败。公共页面夹具已更新。本轮未进行浏览器视觉验收。

后端仅在隔离项目副本及 SQLite 测试库验证：诊断与监控 47 项、客户端识别 279 项、流量窗口 11 项通过；update.sh 替身回归 26 场景通过。真实 SQL 监听测试确认只保留计数和耗时，实际 URL、查询文本不进入指标；覆盖管理员鉴权、越界设置拒绝、采样关闭、分钟过期、容量上限、缓存失败不阻断业务、认证失败不计 5xx、同分钟去重和告警恢复。没有进行生产压测或真实线上慢查询注入。

功能维护边界及默认阈值见 observability-governance.md。无新增数据库迁移，沿用已有定时调度；外部通知关闭且未增加通知渠道。发布资源已构建并随功能代码一同交付，服务器沿用 update.sh 更新；恢复定时任务后自动开始采集。

本轮最终前端验证：全量 792 项通过，TypeScript 和生产构建通过。报告位于 storage/app/test-organization/browser-access/observability-full.json，构建日志为 observability-build.log。

## 无效文档与测试清理

删除四份旧框架过渡说明及一次性资源清理报告，适用边界归并到 laravel13-upgrade.md、project-structure.md，并更新文档索引。历史完整内容由 Git 保留。

移除 PHPUnit 无条件通过的占位断言、与 console-smoke.php 首页检查重复的 Feature 示例，以及不再被引用的应用 TestCase、创建应用 trait、缓存预热扩展。断言计数工具的失败抛错与成功计数测试保留为 tests/Unit/AssertionsTest.php，直接继承 PHPUnit TestCase，不再启动 Laravel 或生成缓存。phpunit.xml 和 suites.json 同步移除空 Feature 套件与旧辅助项；业务、安全和迁移专项测试保留。清单当前为 111 个测试入口、11 个辅助入口。

清理验证：隔离副本运行 tests/run.php --validate，通过 111 个测试入口和 11 个辅助入口校验；PHPUnit --fail-on-warning --fail-on-risky 通过（1 test、2 assertions）。扫描已跟踪源码／配置未发现已删除文件引用，docs 下相对 Markdown 链接均存在。未修改应用代码，因此未重跑全部业务测试。

## 头像套餐标签样式恢复

按用户要求恢复 2075113a 之前的 avatar-plan 样式：深色底、白色 10px 文字、最大宽度 64px，移除额外加粗。仅修改右上角头像套餐标签，不回退账单与使用情况卡片。与旧提交 CSS 逐项比对一致，复用 AccountControls.test.tsx，12 项通过；结果与构建日志位于 storage/app/test-organization/browser-access/avatar-plan-restore*。本轮未进行浏览器视觉验收。

## 节点访问目标统计

复用 tests/node-v10.php 增加默认关闭、节点鉴权、域名/IP 规范化、固定批次去重与冲突、非法数据拒绝、关闭后拒收、重新开启拒绝旧批次，以及普通用户/管理员开关权限检查。隔离 SQLite 副本通过 65 项；SQLite 通过 tests/support/bootstrap.php 注册 FIELD/GREATEST 兼容函数，不改变生产查询。未增加独立后端测试入口。

V10 生成器 12 项测试及七份产物同步检查通过。V2Box 使用 with_quic,with_utls 标签运行 api/v2board 和 core 全包通过，涵盖 TCP/UDP 实际协议流量与计费字节对照；core 目标统计 race 检查通过。后续性能检查已将 TestRejectedReloadIsRetriedWithoutConfigChange 的测试夹具改为 HTTPS，并仅在测试进程信任夹具 CA；node 包回归通过，生产证书校验保持不变。未进行生产压测或真实节点部署。


## 独立节点凭据

复用 node-v10.php 验证独立凭据绑定、摘要存储、一次性展示、跨节点/跨内核拒绝、仅 Bearer 接受、禁止全局回退、30 分钟手动轮换宽限、冲突拒绝、到期与撤销、管理员密码/权限、全局迁移关闭及安装命令无密钥；MySQL 专用测试库 93 项通过；最终补充旧接口数组身份拒绝检查后，SQLite 95 项通过。node-routes.php 增加转换撤销与禁止回退断言，36 项通过；v2box.php 增加删除撤销断言，29 项通过；node-backends.php 774 项通过。SQLite 的 FIELD/GREATEST 兼容函数集中在现有 bootstrap 辅助文件，不修改生产查询。测试清单仍为 111 项和 11 个辅助引用，校验通过。

mail-install-schema.php 在专用空 MySQL 数据库通过真实安装、管理员认证、新凭据表和重复迁移；同时修正测试夹具在 config:cache 重绑定容器后仍修改旧实例环境路径的问题。测试数据库仅用于本轮并在完成后删除。update-script.sh 26 个隔离场景通过，新增凭据迁移命令断言。未执行生产迁移。

V2Box api/v2board 全包回归通过，新增 legacy 模式独立凭据仅进入 Authorization、不会进入查询参数的断言。Python 脚本 20 项测试中 18 项通过、2 项平台跳过；新配置工具覆盖单节点更新、其他配置保留、非法密钥拒绝、写入失败保留原文件和临时文件清理。Windows 未验证 POSIX 权限位和真实终端隐藏输入；Linux shell 语法检查通过，未执行真实节点安装或重启。V10 生成器 12 项通过，七份生成产物同步检查通过。


## V2Box 统计性能与资源回收检查

统计热路径按节点、用户分锁；关闭时直接返回；同一目标不同端口共用缓存。独立统计任务不占用计费上报，关闭时取消并等待退出；请求总超时五秒，响应最多 4 KiB。重试批次五分钟过期，旧确认不能清除新批次；同版本策略在租约过期后重新授权会刷新连接计数代次。

复用 Go 测试增加共享 meter 并发读写与策略切换、并发 500 行上限、每连接 64 目标上限、端口归一化、重试过期、旧确认隔离、租约重新授权、异常响应与 UUID 校验。全量 `go test -tags with_quic,with_utls ./...` 和 `go vet` 通过；core/node/api 的 race 回归通过。Python 辅助脚本 20 项中 18 项通过、2 项平台跳过。

Windows amd64 本机独立微基准（每种两次，预热目标、8 个逻辑处理器、不同用户并行）：开启统计由约 276–287 ns/op 降至 49–52 ns/op，单线程约 180–191 ns/op，稳定路径均为零分配；关闭单线程约 1.8–2.1 ns/op。此数据是统计函数开销，不等同真实网络吞吐提升；首次目标识别仍有有界缓存分配。

开启统计后执行八种协议共 144 次启停，回收后协程增量为 0，最后一组堆内存相对预热组增加约 334 KiB，低于测试阈值 2 MiB；单独 100 轮统计启停堆内存增量约 -8 KiB、协程增量为 0。未发现本轮覆盖范围内的数据竞争或资源失控；不代表生产长期零泄漏保证，未执行 Linux 生产负载测试。日志位于 storage/app/test-organization/browser-access/v2box-review-* 和 v2box-target-{before,after}.log。


## 后台管理页面评估与备注清理

复用 admin-workspaces.test.tsx 的 35 个导航页面渲染回归及筛选、抽屉、保存、高危操作断言；AnalyticsCollectionSettings.test.tsx 增加节点目标用户 ID 草稿不请求、提交查询、翻页保留条件及重置回第一页的回归。最终全量 Vitest 113 文件、798 项通过，未删改既有安全或业务断言。精简节点诊断说明时保留“没有应用回执”的重要边界，原断言继续通过。初次沙箱运行遇到临时目录 EPERM，后在正常权限环境完成全部回归。

浏览器逐页打开 35 个导航入口；桌面与 390px 窄屏检查字典筛选、表格和多语言编辑抽屉，使用既有 page-fixtures 合成数据。详细覆盖范围与逐页结论见 frontend-validation.md。TypeScript、生产构建及前后台打包通过；运行日志为 storage/app/test-organization/admin-review-*.log。未新增后端接口或独立验证脚本。


## V2Box Release 与一键部署验证

正式 Release v1.0.1 的源提交为 e6951a7346209741b3f01a47f3bfd3667c4dec31，包含 2bf3b02 的全部修改。首轮 v1.0.0 Linux CI 检出上游 SS2022 首次响应写入与 Close 竞态，未创建 Release。修复在 SS2022 适配层先关闭原 TCP 中断 I/O，等待加密读写结束后释放缓冲区；专用阻塞写关闭测试及用户热更新用例连续十轮 race 通过，不跳过失败测试。v1.0.1 的 GitHub Linux 全量 race、Reality/Vision 兼容、go vet、Shell 语法和 Python 回归全部通过。

六个操作系统/架构组合构建成功后，由统一发布任务检查六个压缩包、六份 SHA-256 和包内安装器/凭据工具，再创建正式 Release，避免空包发布。独立 Debian amd64 容器从真实公开 Release 下载：验证隐藏终端输入不回显、配置 0600、二进制版本、服务单元和辅助工具；省略版本参数查询真实 latest，验证逐字节保留含两个节点及自定义字段的配置、保留旧二进制、发出重启请求。错误 HTTP 现有配置在变更二进制与服务前拒绝。两个 Linux 包均通过真实 SHA-256、清单和 ELF 架构检查；实际安装的 amd64 二进制中核对到精确源提交。systemctl 仅在此独立容器中模拟，没有操作现有服务；未进行 ARM 真机或生产节点端到端验收。验证后销毁测试容器。

面板 ServerService 安装入口及 node-deployment IP/DDNS 辅助命令固定至 v1.0.1；复用 tests/v2box.php，31 项通过，包含版本固定与交互密钥断言；复用 node-options/Nodes 前端测试，17 项通过，类型检查、生产构建及打包通过。发布记录和验证日志位于 storage/app/test-organization/v2box-release-*，不提交运行脚本或测试密钥。工作流：https://github.com/lenaanderson5566-ops/v2box/actions/runs/39433672490 。


## 访问目标统计的接收性能与容量治理

面板复用 node-v10.php：隔离 SQLite 副本、随机 Redis namespace（最终 130 项通过），新增原子策略拒收、跨桶重试、总预算耗尽无部分写入、请求体在全局 JSON 解析前受限、非法 JSON/压缩拒绝、批次整型总量限制、配置 200/304 租约头、同 NAT 节点配额隔离及 Retry-After。八个独立 PHP worker 并发提交相同 11 个批次，共 88 次；只计 11 次，10999999999999989 字节保持整数精确。worker 作为 helper 注册，不单独作为测试入口；仅清理随机 fixture namespace，不清空 Redis 数据库。增加独立统计 Redis 连接，未调整线上 Redis 持久化配置。

node-v10.php --benchmark 的可选合成基准，20 次各 500 行：旧式 12 桶整状态读写 149.0 ms，新原子累计 141.6 ms；旧序列化状态 1451305 字节，新合并负载 104391 字节。此样本耗时接近，主要收益是去掉应用全局锁、整小时 PHP 反序列化与大状态双向传输，不能据此声称吞吐倍增。并发 worker 总耗时包含八个 Laravel 启动，不能当作单批 Lua 延迟。

V2Box 增加 UDP 全节点缓存地址/连接限额、关闭与退代释放、并发关闭切换、TCP 固定目标无 map、配置租约复用/失效回退及超大请求阻止检查。Windows amd64 core/api/node race、全包常规测试及 go vet 通过。最终单独微基准两次（无其他测试同时运行）：TCP 热路径单核约 118–122 ns/op、八核独立用户约 31–32 ns/op；UDP 单核约 181–202 ns/op、八核约 47–50 ns/op，均为 0 B/op、0 allocs/op。关闭路径单核约 1.85–1.88 ns/op。这是预热后的内存统计微基准，不能等同生产网络吞吐；未执行 Linux 长时间生产负载或真实部署。

前端完整 113 文件、800 项测试通过，新增缓存预算和拒收状态显示；类型检查、构建及用户/管理端打包通过。V10 生成器 12 项及七份生成物同步校验通过。新存储与旧节点兼容，旧 v1 汇总不迁移；节点周期和缓存优化需升级二进制，本轮未发布新 Release。


## 后台配置访问目标上报周期

新增日志设置的 30/60/120/300 秒四档周期，默认 60 秒。复用 node-v10.php，最终 156 项通过；覆盖周期默认值、管理员权限、非法/空参数、部分更新互不覆盖、保持代次及已有汇总、租约仍为 120 秒、新旧节点能力区分。周期参数用例仅重置该夹具 array cache 内的设置配额，未改变生产每分钟 10 次设置限流。沿用隔离 SQLite 和随机 Redis 前缀，并发去重测试仍通过。

复用 AnalyticsCollectionSettings.test.tsx，11 项通过，新增周期独立保存、失败恢复和固定周期节点提示。类型检查、生产构建、用户/管理端打包通过；未进行浏览器视觉验收。V10 生成器 12 项及七份生成物同步检查通过。

V2Box 增加可选 reportIntervalSeconds 及 target-statistics-interval-v1 能力；旧面板缺省 60 秒，非法间隔拒绝。动态调度将策略检查限制在最多 60 秒另加 10% 抖动，失败上报约 30 秒另加抖动重试；长上报周期不延长采集租约。复用 common/task、api/v2board、node 测试，覆盖动态周期无抖动时的重调度、长周期续租/停采、缩短周期和异常值回退。全包常规测试、core/api/node/task race 和 go vet 通过；未进行生产部署或发布新版二进制。


## V2Box v1.0.2 发布与更新验证

V2Box 更新分支 codex/sing-box-backend 提交 fddd53cb89ad88385d2d2e7bd403e982eced4678，v1.0.2 标签通过 Linux 全量 race、Reality/Vision、go vet、Shell 和 Python 检查；六个 OS/架构构建及统一资产校验通过。Release 含六个压缩包和六份 SHA-256，公开 latest 已指向 v1.0.2。CI：https://github.com/lenaanderson5566-ops/v2box/actions/runs/39523850036 。

独立 Debian amd64 容器下载实际公开 Release：核对源提交及可配置周期能力，真实终端隐藏输入不回显、配置 0600、服务单元和辅助工具齐全。随后使用真实 v1.0.1 二进制，运行不带版本参数的新版安装器查询 latest 升级至 v1.0.2：含两个节点和自定义字段的配置逐字节保留，旧二进制备份、包装命令版本和重启请求验证通过；HTTP 旧配置在变更程序或服务前拒绝。Linux amd64/arm64 公网下载、SHA-256、归档清单及 ELF 架构检查通过。仅在独立容器模拟 systemctl，未操作现有服务；未进行 ARM 真机或生产节点验收。

面板安装/IP/DDNS 辅助入口固定至 v1.0.2。隔离 node-v10.php 156 项、v2box.php 31 项，完整前端 113 文件/803 项及类型、生产构建、打包通过；清单 111 项/12 helpers 校验通过。update-script.sh 26 个隔离场景、update-drain.sh 和 update-restart.sh 通过，新 Redis 配置执行 config:cache/config:clear 成功。源码和生产静态资源一起提交，未提交本地 Docker/环境配置或运行文件。


## 一次性授权的一键部署与统一接入入口

复用 node-v10.php，隔离 SQLite 与随机 Redis 前缀最终 185 项通过。覆盖管理员/当前密码要求、V2Box 类型及父节点限定、生成不更换凭据、仅存授权哈希、替换旧授权、过期与重放拒绝、查询参数拒绝、正文不可选择身份、管理员降权/密码变化/凭据状态变化失效、兑换后的跨节点拒绝与非节点令牌拒绝，以及已在轮换中的冲突保护。实际生成命令通过 bash -n；生成器主动归一 LF，避免 Windows 源文件换行进入 Linux 命令。Cache 使用独立 node_deployment Redis store；创建、单次烧毁和重发在同一节点锁下操作，数据库节点行锁保护凭据状态校验和发放，无新迁移。

Nodes.test.tsx/node-options.test.ts 20 项通过，覆盖统一抽屉、密码前置、不自动发放、一次性命令复制、失败重试、升级不申请授权、转换后接入、子节点跳到父节点、旧手动轮换保护。完整前端 113 文件/806 项通过，类型检查与生产构建打包通过。V10 inventory 1625 项、生成器 12 项及七份生成物同步校验通过。未做浏览器视觉验收。

独立 Debian 容器执行与服务端相同模板的复制命令：真实下载公开 v1.0.2 安装器与二进制，经本地受信 TLS 的一次性授权夹具返回测试凭据，验证自动写入正确节点身份、0600 权限、仅兑换一次、无密钥输出和重启请求。再次执行对已有配置拒绝，配置逐字节保留且不再次兑换或重启。额外移除 curl 后验证同一命令可自动补依赖再完成安装；配置与授权暂存文件退出清理。systemctl 仅在该容器模拟，未操作现有服务；没有把测试 CA 或关闭 TLS 校验带入产品。端到端授权数据库语义由上述真实 API 回归覆盖，容器夹具只模拟授权响应，不代表生产连通性验收。

实现只涉及面板，复用已发布 V2Box v1.0.2，无需再次发布节点二进制。运行记录/夹具位于忽略的 storage/app/test-organization/node-deployment-*。

推送前复验：185 项节点 API、1625 项 V10 inventory、12 项生成器及七份生成物同步校验、完整前端 113 文件/806 项通过。更新器 26 个隔离场景、请求排空/重启检查及独立副本配置缓存生成/清除通过；全新 Debian 缺少 curl 的复制命令安装和已有配置拒绝覆盖再次通过，服务启动仍使用模拟。

节点管理凭据操作取消管理员密码二次输入：前后端不再要求或发送密码，服务端仍验证当前用户为未封禁管理员，界面保留操作确认；密钥轮换宽限、一次展示、部署授权过期/单次兑换/状态变化失效规则不变。复用 node-v10.php 在隔离环境通过 183 项，覆盖无密码生成凭据与部署授权、匿名及普通用户拒绝和既有授权安全规则；Nodes/node-options 20 项、类型检查与生产构建打包通过。

节点复制命令统一依赖准备：新安装、手动安装与升级共用 node-prerequisites.sh，缺少 curl 或其他安装工具时自动补齐，不扩展 wget 方案。node-v10.php 隔离运行 185 项、Nodes/node-options 21 项、类型检查和生产打包通过。全新 Debian 容器最初未安装 curl，真实执行复制命令，自动补依赖并下载公开 v1.0.2 安装器/二进制；受信 TLS 夹具授权一次兑换、私密配置 0600、无密钥输出、重复新安装拒绝覆盖和已有配置升级逐字节保留均通过。服务启动使用模拟，未操作生产环境；运行记录沿用忽略的 storage/app/test-organization。

安装入口参考原 V2Node 的 wget 下载后执行结构：依赖检查移到下载后的静态脚本，--install 透传手动安装/升级参数，默认从 stdin 读取部署授权；sh 入口在补齐 bash 后重新执行。node-v10.php 隔离运行 185 项，覆盖短命令、无长期密钥、生成命令语法和公开脚本依赖替换；Nodes/node-options 21 项、类型检查、生产构建打包、生成器 12 项及七份生成物同步校验通过。独立 Debian 无 curl 环境执行短命令，真实下载公开 v1.0.2 程序，验证自动补依赖、一次兑换、0600、无密钥输出、已有配置拒绝覆盖；同一入口 --install v1.0.2 升级保留配置逐字节不变并备份原二进制。TLS 授权响应和服务管理使用隔离夹具，未操作生产环境；无需重新发布节点二进制。

后台单行自动接入：node-v10.php 186 项，验证实际生成命令语法、无换行、面板/节点参数、自动通过 stdin 提供短期授权且无手动密钥提示，原有权限/过期/重放保护继续通过。Nodes/node-options 21 项、类型检查、生产构建打包及生成器 12 项和七份生成物同步校验通过。无 curl 的独立 Debian 容器真实执行单行命令，无交互密钥输入即安装公开 v1.0.2 并写入私密配置；重复安装保护、保留配置升级通过。额外修改命令中的节点 ID 后，脚本拒绝不匹配的兑换结果，不写入独立密钥且不重启服务。TLS 授权响应和服务管理为隔离夹具，未操作生产环境。


### 后台导航逐项检查回归

- `npm test -- src/admin src/shared/useData.test.tsx`：53 个测试模块、395 项通过；包括全部侧栏页面及设置子路由加载、未保存保护、无关配置请求隔离、轮询暂停和清理。
- 随后补充节点复制、支付删除、用户更多菜单内弹窗焦点回归，`npm test -- src/admin/admin-workspaces.test.tsx src/admin/Nodes.test.tsx src/admin/Payments.test.tsx`：3 模块、144 项通过（新增 3 项，其余为上述回归的复测）。
- 测试复用现有模块，没有新增独立脚本或修改 suites 清单；仅使用模拟接口，未连接生产数据库。
- `npm run build` 执行 TypeScript 检查、Vite 生产构建及用户/管理端静态打包。仍有原有代码编辑器大分块提示，未因本轮 UI 优化增加依赖。
- 运行日志位于 `storage/app/test-organization/admin-navigation-*.log`，不提交。


### 服务器归属与四层中转回归

复用 `tests/node-ddns.php` 覆盖物理服务器迁移、旧报告凭据保留、禁止按 IP 合并、共享入口端口冲突、入口/回源 IP 隔离、普通 TLS 候选失败保留、成功发布、Reality 原有行为、回源解析保留与延迟清理、转回直连的端口恢复、服务器凭据重置，以及独立服务器一次性授权。`tests/node-v10.php` 继续覆盖机器鉴权、部署状态和配置回执。所有 PHP 检查在独立项目副本、专用 MySQL 库及独立 Redis 中执行。

`V2BOX_BOOTSTRAP_TEST=1 php tests/v2box.php` 执行真实 shell 分支，隔离模拟下载与服务管理，包含无 V2Box 的入口服务器、上报失败恢复、一次兑换、服务器身份不符时保留配置，以及部署助手分别验证入口和回源 DNS。生成器沿用 12 项测试和七份生成物一致性校验。`tests/update-script.sh` 继续验证 26 个隔离升级场景。

前端复用 `AdminDDNS.test.tsx` 验证独立服务器命令、中转表单分离、端口切换状态、关闭后台轮询和 Nginx 配置生成；相关 Nodes 和 node-options 回归共同执行。实际生成的 AnyTLS/TCP、TUIC/UDP、Shadowsocks 双协议片段在 Nginx 1.28.3 容器中通过 `nginx -t`。V2Box 复用证书测试模块验证入口 DNS、禁止解析器重定向、证书身份与旧配置保护。测试不对生产 Cloudflare、ACME 或入口服务执行写操作；运行记录保存在忽略的 `storage/app/test-organization`。

本轮结果：节点 DNS/服务器/中转 152 项检查，节点 V10 API 290 项检查，部署集成 73 项检查及 23 项 Python 助手测试，前端相关 46 项测试全部通过；升级脚本 26 个场景、契约生成器 12 项及七份生成物一致性校验通过。Linux Go 1.27.3 环境下 `go test ./api/v2board ./node -count=1` 全部通过，生产前端已完成 TypeScript 检查、构建与发布目录打包。Windows 的既有证书临时路径用例不适配当前路径处理，因此以生产一致的 Linux 结果为准。


### 代理服务与多入口线路回归（2026-10-23）

沿用现有测试入口：node-ddns 184 项、retired-node-tables 50 项、node-v10 290 项、node-backends 820 项、node-routes 38 项、node-address 8 项、admin-diagnostics 59 项、V2Box 基础检查 32 项通过。覆盖直连与中转并存、多入口共享、协议/TLS 身份迁移预检、权限子集、服务凭据边界、端口冲突、草稿隔离、展示字段发布、陈旧版本拒绝及资源引用保护。发现并补齐全新安装 V2Box 缺少展示字段的问题；诊断测试改用进程内缓存，避免固定时间统计桶导致重复运行失败，真实 Redis 健康探测仍保留。

PHP 在一次性项目副本、专用 MySQL 数据库与独立 Redis 中运行，不清理共享 Redis。迁移测试另用随机表前缀并自行清理；测试容器、专用数据库及测试用户在结束后移除。更新器 26 个隔离场景通过；测试清单验证 111 个入口及 12 个 helper，API 生成器 12 项及七份发布文件一致性检查通过。最终相关前端 72 项、生产构建与打包通过，后台广泛回归 419 项通过。PHP 语法检查通过。

本轮没有修改 V2Box Go 内核，也未发布二进制；之前服务器上报、证书与运维脚本的结果见上一节。生产 DNS、证书签发与实际入口转发仍须在部署环境验证。


### 一键部署恢复检查

复用 tests/v2box.php 内嵌的 Python WorkflowTests，在一次性 Linux 容器执行 29 项通过。覆盖首次启动命令失败后恢复至完成、停止服务仅启动一次、正在启动不重复重启、退出立即报告、相同配置保留 inode/mtime 及日志设置、systemd/OpenRC 状态读取、未知状态拒绝、证书/DNS/授权及私密状态保护。使用合成服务状态和接口响应、临时测试证书，不操作生产服务或 ACME。没有修改 Go 内核或后台 API，不重复运行无关全量后端测试。

AdminDDNS 与 Nodes 44 项通过，新增只读刷新与 DNS 排队操作的区分断言，并验证无有效 IP 时禁用同步。TypeScript、生产构建、前端发布目录打包及 diff 空白检查通过。运行日志保留在 storage/app/test-organization/deployment-recovery-*，不提交。用户所述线上卡住原因尚需结合该机器的启动日志确认，不能将这些恢复缺陷等同于全部线上原因。


### 直连一体化配置回归

现有 node-ddns.php 扩展至 193 项检查，覆盖一次保存产生节点/域名/同名物理服务器、统一连接端口和 TLS 身份、共享机器复用、域名冲突及无效服务器回滚、禁止经新建配置改写既有绑定。V2Box 基础集成 32 项及节点内核回归 820 项通过，测试清单 111 个入口、12 个 helper 保持有效。全部 PHP 在独立项目副本、专用 MySQL 数据库及独立 Redis 中执行，结束清理自建资源，不修改共享应用数据。Nodes/AdminDDNS 46 项组件测试通过，包含一次保存后直接进入部署页、手动输入、Reality SNI 保留和地址类型筛选；类型检查、生产构建及发布目录打包通过。


节点配置显示优化沿用 Nodes/AdminDDNS，共 46 项通过；直连端口断言调整为仅一个输入，继续验证保存后部署、权限和旧节点编辑。TypeScript、生产构建与静态打包通过，不重复运行未修改的后端测试。


### 节点配置治理回归

Node DDNS 199 项、V2Box 集成 32 项、节点内核管理 820 项通过，复用专用项目副本、MySQL 数据库及 Redis，覆盖同机 TCP 冲突回滚、编辑冲突保留原端口、TCP/UDP 共用、服务器复用和 Naive 新建自动 SNI。配置校验、协议默认值、变更影响归一化和隐藏敏感值、取消高影响保存、有界/可见性轮询、旧内核无回执、停用配置及手动 DNS 边界通过现有 Nodes/AdminDDNS/admin-linkage 75 项测试验证。测试清单 111 入口、12 helper 不变；新增服务类不属于独立测试入口。临时库、用户及容器在结束后清理。

Typescript 与生产构建、发布目录打包通过。浏览器合成状态预览覆盖“等待配置应用确认”与默认升级场景，未访问生产 API。日志与截图位于 storage/app/test-organization/node-guidance-*，不提交。本轮未修改 V2Box Go 内核或发布二进制。


### 同机追加服务与失败恢复

一键部署在已有 V2Box 上仅允许追加同一面板的新节点 ID，并要求已有物理服务器身份。重复安装同一个节点、跨面板或混用后端会在兑换授权前停止。追加无需重新安装二进制；先校验 IP 上报身份及 DNS，再原子追加配置，保留其他服务、日志和自定义设置。

新增服务收到明确失败回执时，只有当前文件仍与本次写入完全相同才恢复原配置并重启；管理员后续编辑不会被覆盖。超时不等于失败，不自动回滚或清除证书，保留部署状态供 resume。追加前快照按节点 ID 保存在配置目录的 config.before-add-ID.json，权限 0600，包含凭据，应按敏感配置管理。恢复过程可能短暂中断本机连接，应安排维护窗口。

删除面板节点会撤销凭据并进入托管 DNS 清理流程，但不会远程卸载程序。v2box uninstall 是整机操作，共享服务器不得用它移除单个服务。入口转发继续由管理员应用并测试，不将 DNS 成功视为转发连通。

验证：现有 tests/v2box.php 内部署工作流 34 项通过，覆盖追加、重复执行、凭据冲突、DNS 失败不改配置、失败条件回滚及管理员修改保护；后台 Nodes、AdminDDNS、admin-linkage 共 75 项通过，生产构建通过。


### 节点与接入的管理入口

左侧同组并列提供节点管理、服务器管理、域名与解析。节点管理的可收藏标签为节点列表、代理服务、入口转发、节点通讯；服务器管理为服务器列表、流量额度、Lightsail IP。域名与解析维护 Cloudflare 凭据、节点域名、历史解析与同步事件，共享入口随所属服务器维护。移除 nodes-ddns 旧页面分支，不增设兼容跳转。

直连新增仍自动关联服务器与域名，分开管理不要求分别创建。页面间提供直接链接，服务器展示去重后的代理服务数量和入口域名数量。修正仅 IPv4 或 IPv6 有上报时间时误显示尚未上报的问题。

复用现有接口和表结构；服务器列表仅请求 ddns/fetch，节点列表不加载域名事件；云 IP 和流量标签仅在进入后加载。后台原有保存、授权、删除保护不变。回归复用 Nodes、AdminDDNS、admin-workspaces、admin-linkage 测试模块，覆盖独立入口、子页面直达、按需请求和单地址族上报。

浏览器使用本地示例数据验证服务器列表和导航，覆盖桌面及窄屏，未连接真实面板、Cloudflare 或节点。预览截图置于 storage/app/test-organization/infrastructure-desktop.png。

本轮最终验证：Nodes、AdminDDNS、admin-workspaces、admin-linkage 共 207 项测试通过；TypeScript 与生产构建通过。


### 服务器编辑整合流量额度

移除独立流量额度标签及 server-traffic 页面入口。服务器编辑抽屉一次保存名称、地址类型、启用状态和流量配置，后端使用同一事务，验证失败与归属冲突均不部分保存。周期起始日、计费方向变更及会立即达限的操作要求确认，取消保留表单。列表显示周期用量/额度、接近或达到额度的状态、共享用途与上报时间；详情按需加载周期、本月/近30天汇总、关联服务及最多90条每日记录。

新增已批准迁移 2026_10_24_000001_link_server_traffic_budget.php 为历史额度建立物理服务器关联。归属明确的一对一历史记录自动关联，不合并或清零；不明确的历史额度保留整理入口。服务器上的代理服务自动共享额度，关联线路不重复绑定。同机追加服务首次纳入近期历史且只导入一次。新增字段仅出现在管理员完整资源，节点流量额度通信资源保持原契约。

额度列表汇总使用固定5次查询；近两个月日汇总一次读取后按周期汇总，避免每台服务器分别查询三次。详情仅打开时读取，历史有90天与90条上限。不增加流量上报链路查询，也不新增清零或手工修改历史用量入口。

验证复用现有测试模块：server-traffic-budgets 36项、node-ddns 199项、update-script 26个隔离场景通过；迁移重复执行、归属冲突回滚、自动共享、历史导入去重及列表查询次数均有断言。前端覆盖一体保存、取消变更、详情按需加载、旧额度保留及非法数值。浏览器使用本地模拟数据检查列表、编辑抽屉及详情；截图 storage/app/test-organization/server-quota-editor.png，未操作真实服务器或Cloudflare。

最终前端验证：5个既有模块共212项测试通过，TypeScript与生产资源构建通过。


### 统一新增节点入口

节点列表和代理服务列表均只保留“新增节点”。新增抽屉默认新建代理服务，可切换为复用已有服务；复用直接选择含后端名称的服务，隐藏独立内核、协议、证书和部署字段，仅配置线路名称、连接入口、端口、权限与展示信息。可选展示信息保持折叠，拓扑显示待保存预览。

两种方式共用一个抽屉，不叠加弹窗；切换时确认放弃未保存内容。复用保存成功后锁定新增方式，继续原有检查与发布流程，不生成部署授权、不再次创建代理服务，也不自动发布。现有编辑线路和后端转换流程保持独立。复用表单将脏状态与保存状态传给外层，关闭和离开保护由同一抽屉处理。

验证复用 Nodes、AdminDDNS、admin-linkage、admin-workspaces，共212项测试通过，覆盖两类后端相同ID的正确选择、单一新增入口、保存后锁定、无可用服务提示、取消切换保留表单及新建直连一体保存。浏览器仅使用本地模拟数据验证默认新建和复用中转字段、权限继承与拓扑；截图位于 storage/app/test-organization/node-create-unified.png。没有数据库迁移或节点二进制改动。

复用入口校验同时覆盖：选择中转但无有效入口时禁止保存并引导配置，避免 NaN 入口标识被序列化为空后误按直连保存。


### 服务器与中转入口的配置流程

移除服务器列表的全局“添加入口域名”和全量入口表。添加服务器可选“配置中转入口”，默认关闭，启用后填写根域名、前缀和地址类型；服务器、额度与可选入口通过同一保存请求、同一生命周期锁及事务创建，任何域名或地址校验失败均回滚。禁止在此新增参数中覆盖已有服务器或注入其他服务器 ID；已有服务器从详情管理入口。

服务器详情内仅展示所属入口域名，可添加、编辑、重试同步、接管冲突解析和删除，入口表单自动绑定当前服务器。存在关联线路时禁用修改和删除，后端继续检查草稿及已发布引用以防并发状态变化。编辑采用详情内表单，不叠加抽屉；保存中保护关闭，未保存配置离开前确认，接口错误保留输入。服务器未启用时不允许新建入口。创建入口仅准备托管解析，不代表转发已经部署或连通。

复用原有 server/network/save 与 entry 接口，不增加数据库迁移或流量上报查询。215项 node-ddns 检查和36项服务器额度检查在专用空数据库、独立Redis、一次性副本通过；223项前端测试及生产构建通过。新增覆盖原子创建、重复域名和地址不匹配回滚、未知根域名、入口归属注入、详情范围隔离、并发拒绝后保留表单。浏览器以本地示例验证可选入口字段，截图 storage/app/test-organization/server-entry-create.png；未访问真实节点或Cloudflare。


节点与接入入口收拢复用 AdminDDNS、ServerTrafficBudgets、Nodes、admin-workspaces、admin-linkage 五个现有前端模块，共226项通过；覆盖解析总览只读、共享入口显示与搜索分页、移除额外节点读取、服务器编辑内单层命令显示、未保存变更阻止授权、失败保留编辑器和凭据重置确认。后端及测试清单未改动。


直连/中转一体化新增复用现有测试：AdminDDNS、Nodes、admin-linkage、ServerTrafficBudgets、admin-workspaces 共234项前端检查；node-ddns 228项、v2box 32项、server-traffic-budgets 36项隔离后端检查通过。覆盖单请求中转创建、入口与回源端口及域名分离、TLS身份、同机拒绝、端口冲突和证书模式失败回滚；前端覆盖模式选择、证书模式默认值、服务器归属、旧入口切直连时保留显示、流程说明和直接定位接入配置。后端使用一次性副本、空测试数据库和独立Redis，完成后移除专用数据库/账号及容器；未操作共享缓存或生产数据。测试清单仍为111项和12个辅助引用。


统一节点管理复用现有六个前端测试模块，共270项通过，覆盖一个节点列表、编辑内线路/服务/部署切换、同ID不同内核服务定位、共享服务影响提示、未保存保护、旧表单字段保护、PATCH 传输与显示偏好。后端复用 node-ddns、v2box、node-routes、cors-responses 和 browser-session，增加默认线路元数据版本冲突、权限组引用、技术字段注入、旧技术表单覆盖保护，以及真实路由的管理员会话、CSRF 和来源验证。测试使用一次性副本、专用空数据库及独立Redis，未操作共享缓存或生产数据。测试清单仍为111项和12个辅助引用。

本轮隔离后端结果：node-ddns 242项、v2box 33项、node-routes 38项、cors-responses 18项、browser-session 534项，全部通过；专用测试数据库、账号和两个容器已清理。最终节点模块45项复验及前端生产构建通过。

节点新增/编辑一致性继续使用 Nodes、AdminDDNS、admin-workspaces、admin-linkage、ServerTrafficBudgets、shared/api 六个模块，不新增独立测试文件。增加自动/手动配置字段分组及标签一致性检查；字段名更新对应既有交互断言，保留草稿保护、单请求创建、共享服务和部署授权安全断言。272项前端检查及 TypeScript/Vite 生产构建通过。此次仅前端与说明文档调整，无后端测试清单变更。

本轮推送前通过 tests/update-script.sh 的26个隔离升级场景；仅挂载只读源码，在断网一次性容器中运行临时仓库和模拟依赖，无数据库或真实服务器操作。新增共享字段模块及 public/console 构建资源随 Git 发布，无新增迁移。

节点全流程复查继续在既有前端六个模块及 node-ddns、node-address、node-display、node-backends、node-v10、v2box、node-routes、cors-responses、browser-session 中添加 / 复用断言，不创建新的独立测试脚本。覆盖地址与模式接口的管理员会话、CSRF、来源及字段注入防护；保留现有端点、服务器 IP 上报、域名重存幂等、待发布版本、证书身份和监听应用回执保护；校验标签、权限数组和倍率的持久化容量。所有实际后端检查在只复制表结构的专用库、独立 Redis 和一次性项目副本运行。字典测试额外应用既有字典迁移；不改变本轮部署迁移清单。

本轮最终结果：前端六个模块283项及生产构建通过；node-ddns 277项、node-address 8项、node-display 5700项、node-backends 832项、node-v10 290项、v2box 33项、node-routes 38项、cors-responses 20项、browser-session 544项通过。升级脚本26个隔离场景通过，测试清单111项及12个辅助引用有效。专用容器、数据库及账号已清理。未连接真实 Cloudflare、申请公网证书或部署生产节点。

服务器用途与转发入口调整继续复用 Nodes、AdminDDNS、admin-workspaces、admin-linkage、ServerTrafficBudgets、shared/api 六个模块。新增用途推导、按服务器隔离待发布/已发布路径、按需打开转发编辑器、同 ID 不同内核定位及只读打开不签发部署授权的检查；保留原有入口保存回滚与未保存保护断言。新增入口预设仍使用原有原子保存接口，不增加迁移和独立角色数据。

最终六个前端模块共286项通过；TypeScript/Vite 生产构建通过。前述隔离后端回归与升级脚本26个场景结果继续适用，本次新增界面未改变后端契约、迁移、依赖或 update.sh。

统一节点编辑继续复用既有六个前端模块，共290项检查通过。新增四分组与共用服务影响范围、出口地区默认值和独立命名、节点信息与接入路径分别保存但完整保留关系的断言。此轮无后端契约、迁移或依赖变更。
节点模块最终60项复验及 TypeScript/Vite 生产构建通过，public/console 已同步打包。

节点编辑迭代清理复用上述六个模块，补充手动清空地区后切换服务及取消选择时清理权限而保留名称的断言；保留旧入口已退役的路由回归测试，不将其作为兼容入口恢复。未新增后端契约和迁移。
最终清理后六个模块290项检查及 TypeScript/Vite 构建通过，public/console 已重新打包。

服务器编辑与详情合并继续复用 AdminDDNS、ServerTrafficBudgets、Nodes、admin-workspaces、admin-linkage、shared/api 六个模块。保留额度与入口的全部既有业务断言，更新管理入口交互，增加单抽屉、保存不关闭、名称修改不误触额度确认及关闭保护检查。
最终相关六模块合计292项检查通过（入口模块39项单独复验通过）；TypeScript/Vite 生产构建通过并打包 public/console。无真实服务器或数据库操作。


### 服务器上报状态与中转操作说明

服务器管理读取最新上报快照，不覆盖未保存的配置。仅在抽屉打开、页面可见且没有未保存配置或入口操作时每 15 秒刷新，关闭时释放定时器。列表区分未上报、双栈缺失、超过 15 分钟未上报及停用状态。中转入口未就绪时明确检查入口服务器，不再笼统提示同步回源解析。

接入方式使用“中转连接（入口转发至代理服务器）”，明确入口只转发 TCP/UDP，TLS 证书与加密连接由代理服务器处理。服务器管理提供配置顺序，额度字段折叠；节点四个编辑分区提供职责说明。独立入口仍需在本机执行上报命令，不能由另一台代理服务器代报。

复用 AdminDDNS、Nodes、ServerTrafficBudgets 测试，覆盖入口未就绪、最新快照保留草稿、双栈缺失、过期上报及定时器清理。未连接生产入口服务器，未执行实际 DNS 修改、证书申请或转发部署；界面修复不代表生产上报服务已恢复。


节点路径配置优化：新增配置顺序统一为节点信息、代理服务、连接路径与域名；未绑定节点默认展开域名设置。普通 TLS 中转在保存前检查证书模式，明确返回代理服务的 TLS 与证书分区修改。DNS 凭据可能被脱敏，因此前端不以空凭据判断缺失，实际权限与凭据仍由后端校验。Reality 与无 TLS 保持原行为。复用 Nodes 与 AdminDDNS 测试覆盖字段顺序、去重和证书模式边界。


### 证书复用后台 Cloudflare 凭据

DNS 证书配置可显式选择已验证根域名的 Cloudflare 凭据。节点配置仅保存 dns_credential_id，选择后清除手动 dns_env；后台列表只读取凭据名称与根域名。节点配置下发时解析当前加密 Token，强制 cloudflare 提供商，检查域名范围、模式和凭据暂停状态；引用字段不会进入用户订阅。绑定与证书切换均检查目标域名，仍被证书引用的凭据禁止删除或更换 Zone。轮换 Token 后后续节点配置读取新值。

当前 V2Box 使用本机 ACME，因此选中的 Token 会通过认证后的节点配置接口交给代理服务器，无法在节点侧把一个宽权限 Token 限缩到单条记录；应使用限定相应区域的 Token。本轮不增加自动凭据选择，不把任意面板凭据交给节点，不新增数据库迁移或节点协议字段。测试复用 node-ddns 与前端既有测试模块；不调用真实 Cloudflare 或申请真实证书。

验证结果：前端 128 项通过，TypeScript/Vite 生产构建通过；独立项目与数据库中的 node-ddns 292 项、node-v10 291 项通过。节点接口禁止缓存由中间件统一保证，ETag 和配置回执功能保持有效。未进行真实 Cloudflare/ACME 验证。

### 节点配置分组与证书匹配验证

Nodes、AdminDDNS、admin-linkage 三个现有模块共 129 项测试通过。覆盖新增分组顺序、部署跳转唯一域名入口、监听变更后的域名验证、入口与回源跨区域凭据匹配、域名边界及失效选择保留。TypeScript 检查与生产构建通过。本轮未执行真实 Cloudflare 签发或生产服务器部署，未完成浏览器视觉验收。

### 直连与中转配置回归检查

修复证书凭据变更域名后的预检、暂停根域名筛选、直连切换残留入口条件以及旧证书导航文案。三模块 130 项通过，补充服务器过滤用例后 Nodes 61 项通过（总计 131 项）；类型检查和生产构建通过，资源清单完整。节点申请、续期及失败保护完成代码核对；本机 Go 1.25.7 低于项目 1.27.3，自动工具链获取未完成，节点专项测试未完成，不计为通过。未执行真实 Cloudflare 签发、生产部署或浏览器视觉验收。

### 配置生效状态回归

修复服务保存和证书 Token 更新后沿用旧下发状态的问题，历史成功时间保留，延迟回执不能确认尚未重新下发的配置。独立数据库与临时项目验证：V10 节点 295 项、DDNS 292 项通过；前端 132 项、TypeScript 和生产构建通过，PHP 语法及资源清单检查通过。未执行生产部署、真实证书签发或节点二进制端到端验证。

### V2Box 实际应用验证补验完成

使用 Go 1.27.3 Linux 隔离容器运行 `go test -tags with_quic,with_utls ./cmd ./node ./core ./api/v2board`，四个包全部通过。新增真实重载测试覆盖 VLESS/Trojan 数据回显、旧端口关闭、新 TLS 域名握手、直连与本地 TCP 四层中转往返、DNS 模式活动控制器凭据轮换，以及错误证书拒绝后旧服务仍可传输数据。本地证书和模拟面板不等于真实 Cloudflare/公网 ACME 签发或生产 Nginx 部署验证。此补验解决上一轮 Go 工具链未完成的测试限制。


### 部署一键检查回归

复用 `tests/node-ddns.php`，在临时项目副本和独立空数据测试库验证 321 项断言。新增覆盖：混合私网/保留地址拒绝、DNS 与上报 IP 不一致、地址探测数量上限、双栈部分失败、UDP 不做 TCP 健康推断、TLS 校验失败、续期不误判、中转证书指纹一致性、请求并发锁释放、匿名权限、无缓存及配置在检查中变化导致结果失效。前端 Nodes/AdminDDNS 104 项测试、TypeScript 和生产构建通过。公共 Cloudflare 服务完成一次真实 TLS 握手，成功读取证书指纹及到期时间；这不是生产节点或真实 ACME 续期验收。未修改生产 DNS、证书或 Nginx 配置。

### 连接地址与 TLS 身份分离回归

复用 tests/node-ddns.php，覆盖新建中转默认落地身份、独立证书区域的 Cloudflare 凭据、候选配置下发能力校验、认证回执成功发布/失败保留、Reality 不受影响、中转回直连、Clash 与 sing-box 订阅的连接地址/SNI/证书验证，以及一键检查分别探测入口和回源时使用同一独立身份。测试在临时项目副本及独立 MySQL 数据库运行，DNS/Cloudflare 与探测使用受控测试替身，不接触生产节点或申请公网证书。node-ddns.php 334 项、node-v10.php 295 项、v2box.php 33 项和 update-script.sh 26 个隔离更新场景通过。

### 节点管理界面回归

在既有 Nodes.test.tsx、AdminDDNS.test.tsx 增补地址摘要、单层编辑导航及服务器分区定位测试。旧文案断言调整为对应的当前/待启用地址，保留正确代理服务 ID、未保存保护、禁止提前发布和不触发写请求等行为断言。此次仅调整前端布局，无后端接口、数据库或节点通信变更。

### 部署解析等待回归

复用 tests/node-v10.php 验证有效部署无需调度器即可推进自身到期 DNS、状态落库、IPv6 缺失诊断，以及轮询不绕过同步冷却和 Cloudflare 凭据暂停。复用 tests/v2box.php 内嵌 Python 测试，覆盖入口缺失、凭据阻塞、公共 DNS 等待、409 可操作提示和任意错误正文不泄露。Python 用例在无网络 Linux 容器中执行，后端在临时项目和独立空数据测试库中执行，Cloudflare 使用受控替身；未修改生产 DNS 或申请真实证书。

后台部署步骤显示复用 Nodes.test.tsx，覆盖入口 IPv6 缺失与回源成功独立显示、Cloudflare 拒绝和退避、证书失败提示、DNS 阶段优先于配置待获取，以及 15 分钟轮询上限与隐藏页面停止请求。Nodes/AdminDDNS 共 111 项测试通过。

### 中转落地 HTTP 证书回归

复用 node-ddns.php 验证中转 HTTP 新建、独立落地身份、启用及监听 80 拒绝（336 项通过）；复用 v2box.php 内嵌 Python 用例验证中转证书域名必须匹配回源 A/AAAA、入口解析仍独立检查、失败不启动申请（无网络 Linux 容器 38 项通过）。Nodes、AdminDDNS 和 admin-linkage 共 141 项测试及 TypeScript/生产构建通过。修正旧关联测试中把入口地址作为证书身份的过时预期，保留不匹配和暂停凭据的安全断言。未执行真实公网 ACME 签发或续期。

### 双栈入口与 IPv4 回源回归

在既有 node-ddns.php 的创建流程使用双栈入口，验证 HTTP 落地仍为 IPv4、上报安装参数独立、入口 IPv6 不污染回源、双方各自到达 DNS 就绪（342 项通过，独立测试库及模拟 Cloudflare）。v2box.php 内嵌 Python 测试通过 39 项，新增实际 dns_matches 路径同时检查入口 A/AAAA 和回源仅 A。前端 142 项测试、TypeScript 与生产构建通过，TCP/UDP 生成配置用 Nginx 1.28.3 执行 nginx -t 成功；未在生产网络验证 IPv6 连通、ACME 签发或实际代理流量。

Existing-record review verification: tests/node-ddns.php passed 348 checks in a disposable project/database, including preserving unused AAAA by default, explicit removal, changed-record rejection and preview expiry. Nodes/AdminDDNS/admin-linkage passed 143 frontend tests, including the cleanup opt-in flow. TypeScript and production build passed. Cloudflare API effects use the existing fake provider; no live zone records were changed and real public DNS propagation was not verified.

Node UI simplification regression: 143 tests passed across Nodes, AdminDDNS and admin-linkage, including revealing optional group/shared-service columns, preserving display preferences and restoring compact defaults. Compact section navigation retains dirty-draft guards and shared-service access. No backend behavior changed in this UI pass.

DNS fallback regression: disposable backend checks passed 350 DNS assertions and 304 V10 node assertions; embedded deployment Python tests passed 42 cases, including single-provider outage, both-provider outage, conflicting/empty answers, stale IPv6 and advisory observation payloads. Contract generator passed 12 tests and generated-file consistency. No live Cloudflare records were changed; node-specific egress is reproduced with test doubles.
Frontend verification: 144 tests passed; TypeScript and production build passed. update.sh passed 26 isolated scenarios. Installer observations are shared between the deployment and domain views; polling retains the existing visibility, deadline and terminal-state guards.
