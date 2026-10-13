# 本地客户端镜像

后台统一进入「客户端管理」，在「推荐与智能更新」设置各系统主推荐和备选，并点击「下载全部推荐客户端」。默认勾选「符合条件时自动上架」，优先使用明确标注 universal 的通用安装包，缺少通用包时分别匹配 Windows x64 / ARM64、Mac Intel x64 / Apple Silicon ARM64 以及 Android ARM64 / ARM32。相同通用包只下载一次。

「访问与版本策略」位于同一页面。智能同步使用已保存推荐和用户端默认推荐，禁用的客户端或低于最低应用版本的包会跳过。下载工作由服务器队列执行，完成时复查最新策略、官方版本和 SHA-256 摘要，符合条件才发布；关闭浏览器不会中断已提交任务。没有官方摘要、版本过期、架构含糊、Linux 发行格式及 sing-box 桌面内核包仍需人工确认。Mihomo 最低版本约束对应内核，无法从 CMFA、FlClash、Clash Verge 应用版本推断，因此这类情况不自动发布。自动发布不代表已实际运行测试客户端兼容性。

「手动选择安装包」保留下载、发布和回退能力，仍受启用状态与可比较的最低应用版本约束。每个系统可按架构发布多个包。较新架构包会撤下较旧通用入口；新版通用包会替代同版本及较旧架构入口，旧文件仍保留。用户端存在通用包时直接提供下载，不再要求选择芯片；无通用包时明确选择 Intel 或 Apple Silicon。iOS 不提供 IPA 镜像，继续官方商店安装。

## 部署

本次客户端标识迁移需运行 update.sh，见文末升级说明。持久化文件及原子更新的索引位于 `storage/app/client-mirrors`，PHP-FPM 与 Horizon 用户均需读写该目录。不要放进 Git 或清理部署脚本。备份时一起备份此目录。多服务器部署需共享此目录，或固定下载与请求到同一台服务器。

更新后运行 `php artisan config:clear`，并通过宝塔重启原有 Horizon 守护进程。新增独立 `client-download` supervisor（一个进程）；使用 `redis-mirror` 连接，任务超时 660 秒、retry_after 900 秒，HTTP 下载最多 600 秒。无需再建一个 Horizon。任务超过 20 分钟未完成时，后台标记失败，可重新下载。失败不会切换线上镜像。

## 校验与限制

只接受内置官方 GitHub 仓库的稳定版 assets，不接受管理员提交任意 URL。只允许 HTTPS、GitHub 官方文件重定向域名；流式下载、512 MiB 上限、预留 100 MiB 空间。校验官方记录的大小，并在有官方 SHA-256 摘要时核对；没有摘要时明确标记为本地指纹，不声称已验证发布者签名。文件不解压、不执行。

所有管理接口沿用管理员认证。下载通过 `/api/v10/public/client-installers/{uuid}/content` 以附件返回，仅已发布且符合当前客户端策略的文件可公开下载。禁用后即使持有旧镜像链接也不能下载。安装包本身是公开资源。各客户端的专用外部镜像地址填写项已移除，旧 client_mirror_* 配置不再读取；本地镜像通过此处发布或下架。用户页面刷新后更新镜像入口。

最多保留 100 条记录，未发布、已完成或失败的记录可手动删除。定时任务仅检查版本，不会自行发起下载；管理员发起同步后自动下载并按上述条件发布，旧版本文件不自动删除。下载消耗服务器磁盘和出口流量，当前下载通过 PHP 响应传输；大规模分发可后续采用 Nginx 内部转发或对象存储。

管理 API 的 `client/mirrors/download` 增加可选布尔字段 `auto_publish`（默认 false，兼容旧调用）。`client/mirrors/fetch` 增加 `policies` 和按发行客户端 ID 索引的 `policyReasons`；条目包含 `auto_publish` 和 `publish_reason`，供界面展示自动发布状态与待确认原因。Windows / macOS / Android 镜像定位继续使用原 `target:architecture` 格式，本次客户端标识迁移需运行 update.sh，见文末升级说明。部署代码后需重启 Horizon，使下载任务使用新发布逻辑。

## 设备推荐与多架构镜像
后台按设备选择推荐包：安卓优先 universal APK、其次 ARM64；M 系列 Mac 优先 universal、其次 ARM64；Intel Mac 选择 universal 或 x64；普通 Windows 选择 x64 安装版，Windows ARM 仅匹配 ARM64。Linux 需确认发行版，sing-box 桌面内核包不自动推荐。识别依据官方文件名，未知架构必须人工确认。

一键检查更新仅刷新官方版本，逐项目隔离错误；下载与发布仍分开。新镜像按系统和架构发布，旧发布记录继续有效。用户端有多架构镜像时提供选择，不依赖不可靠的浏览器芯片识别。通用包可直接下载；其他包需选择架构。

“一键下载更新”先检查已有镜像对应项目，再按已有架构匹配新包。“下载全部推荐客户端”可从空镜像库开始，按当前推荐匹配各设备。跳过未知架构、同优先级多个候选、已发布/排队文件和检查失败项目；单项失败继续其他任务。两种批量操作均遵循“符合条件时自动上架”开关，已下载但未发布的包可以复用并重新检查发布条件。

批量操作后显示逐设备检查结果与候选包，区分需确认、失败、已跳过及已排队。需确认或失败项可通过“手动选择”定位安装包选择器。结果为本次操作快照，实时下载状态以镜像列表为准。

## 客户端管理与订阅策略

系统设置的「专用客户端下载」管理 FastAI。第三方客户端的推荐设置统一在「风控与客户端 → 第三方客户端管理」，不再在系统设置中重复显示；原有商店客户端仍保留在推荐列表。

「访问与版本策略」展示每个客户端的版本判别依据和填写示例。示例仅表示格式，不代表推荐的最新版本。最低版本留空不限制；支持数字版本、v 前缀和 alpha/beta/rc 预发布版本。预发布版本低于同号正式版本；2.0 与 2.0.0 等价。无效版本不能保存，已配置最低版本但 UA 不提供对应版本时拒绝。meta/sing 指内核版本，不能用 CMFA/Hiddify 的应用版本代替。通用格式没有应用版本，应留空。

客户端准入统一使用「允许订阅访问」，不再提供独立 UA 白名单开关。未知 UA 始终拒绝；专用客户端继续独立认证。升级前的白名单与禁用状态自动按原有效权限展示，首次保存策略时在事务内固化为独立客户端开关，未编辑客户端不会意外放开。此后启用某客户端无需同时启用内核客户端；内核最低版本约束仍然生效。无需新增数据库迁移。

24 小时订阅显示后端 subscribe_flag_count_24h，统计滚动 24 小时的成功与失败请求，并非限额或设备数。新日志优先按实际 UA 归类，历史日志保留原分类；重新加载策略列表更新计数。未新增数据库迁移。

### 严格识别与防滥用（2026-10-12）

当前配置下载必须识别出已支持的客户端，即使 UA 白名单关闭也不再允许未知 UA。开启白名单后进一步限制到所选客户端。General 公开输出及模糊子串兜底已移除；格式选择只接受明确标识，并检查其与识别客户端的兼容性。v2rayN、v2rayNG 等已识别客户端仍使用各自的 URI 序列化器，不受取消 General 影响。应用配置接口执行相同的 UA 与兼容性检查。

标准标识统一由 SubscriptionClientRegistry 管理：mihomo、sing-box、clash-verge、quantumult-x 等。旧 meta、sing、verge、quantumult%20x 保留为兼容存储键，避免重置既有策略与历史统计。v2RayTun.php / class v2RayTun 规范为 V2RayTun.php / class V2RayTun；路由按明确注册表选择处理器，不再扫描目录猜测格式。旧 General 策略行保留在数据库但退出可用客户端列表。

订阅 token 入口共用 IP、账号限流与黑名单检查，包括自定义订阅路径和旧应用配置入口。默认每 IP 120 次/分钟，每账号 30 次/分钟、240 次/24 小时固定窗口；后台风控规则的「订阅访问拦截」可调整。固定窗口从首次请求计时，非滚动统计；跨 IP/UA/输出格式共享账号额度，返回 429 与 Retry-After。限流计数采用共享缓存锁；缓存服务不可用时请求失败，不放行。缓存键不含明文 token。专用客户端保持独立认证和现有限流。

UA 可被伪造；有效订阅凭证配合伪造 UA 仍可获取权限内的配置。此方案限制未知客户端与频繁下载，不是客户端身份证明，也无法阻止已获授权的用户复制节点信息。疑似泄露需撤销/重置订阅凭证，反向代理还应限制总请求量。

官方来源核对（具体版本号为测试占位示例，不代表推荐版本）：
- FlClash 默认拼接 `<appName>/v<version> clash-verge Platform/<os>`；Linux 示例 `FlClash/v0.8.0 clash-verge Platform/linux`，仍优先识别为 FlClash。支持全局自定义 UA。[UA 生成](https://github.com/chen08209/FlClash/blob/main/lib/common/package.dart)、[请求使用位置](https://github.com/chen08209/FlClash/blob/main/lib/common/request.dart)。
- Hiddify 使用 `HiddifyNext/<version> (<os>) like ClashMeta v2ray sing-box`；新增 HiddifyNext/HiddifyNextX 兼容前缀，但不会把其应用版本视为 sing-box 内核版本。[官方源码](https://github.com/hiddify/hiddify-app/blob/main/lib/core/model/app_info_entity.dart)。
- Clash Verge 默认 `clash-verge/v<version>`，可自定义。[官方说明](https://github.com/clash-verge-rev/clash-verge-rev/blob/dev/PRIVACY.md)。
- Mihomo 外部资源的默认 UA 可为不带版本的 `clash.meta`，不能据此推断内核版本。[官方文档](https://github.com/MetaCubeX/Meta-Docs/blob/main/docs/config/general.md)。

Linux 是操作系统，不是客户端标识；不能放行所有包含 Linux 的 UA。其余已有 UA 别名标注为「兼容规则；官方来源未核对」。来源核对为人工维护，日志观测独立自动汇总，不能把出现过 UA 或合成测试通过等同于客户端真实性或兼容性已核验。

## 自动观测与统一风控

客户端策略列表在页面可见且未编辑时每分钟刷新。实际观测包含近 30 天是否出现、最近出现时间，以及近 24 小时版本识别率（识别出对应客户端版本的请求数 / 所有该类型订阅日志请求数，含失败请求）。没有日志显示「未观测」，不会自动提升来源核验状态；Hiddify 应用版本不会计作 sing-box 内核版本。统计只反映已写入并保留的订阅日志，不包含在身份识别之前被限流拒绝的请求。

管理接口 `client/strategy/fetch` 保留原字段，增加 `ua_observation`、`ua_last_seen_at`（Unix 秒或 null）、`ua_version_recognized_24h`、`ua_version_coverage_24h`。`raw_ua_stats` 每项增加 `last_seen`、`version`。`is_enabled` 返回实际允许访问状态，并由原 `client/strategy/update` 保存。GET 不再创建策略记录；首次 POST 保存会使用已有风险设置表记录合并状态 `client_access_unified`。旧 `config/save` 的两个 `subscription_ua_whitelist*` 字段停止接受写入，历史配置保留用于首次合并。

风控规则页集中展示订阅限流，并明确区分「拦截」与「仅记录」。禁用异常记录规则不会停用限流或 IP / UA 黑名单；黑名单条目仍在各自管理页维护。客户端准入、版本与推荐只在客户端管理配置。
## 精简的 UA 访问列表
管理列表仅展示客户端、允许订阅访问、允许的 UA 前缀、实际请求 UA、24 小时请求与最近出现。前缀由实际识别规则生成，包括 CMFA、Hiddify 和 SFA 等兼容名称；忽略大小写，必须从 UA 开头匹配并满足名称边界，不是任意包含匹配。实际 UA 可展开查看近 30 天样本。最近出现使用 Unix 秒格式化，未观测时显示暂无记录。
客户端标识不再可编辑，旧存储键由升级迁移统一；旧 flag 链接需要重新导入。客户端由内置注册表维护，页面不提供无效的新增或删除入口。最低版本仍为可选编辑项，已设置时在客户端名称旁提示；只检查 UA 可留空。来源核对、版本依据及识别率从常用列表移除，后台接口字段保持兼容。

## UA 注册与协议复用

新增独立准入项 Clash Party（`mihomo.party`）、Throne（`Throne`）、NekoBox for Android（`NekoBox/Android/...`）、Husi（`husi`），默认关闭，保存客户端策略后按开关生效。平台与架构不拆分访问策略。Clash Party 和 NekoBox 默认使用 Mihomo YAML，Throne 和 Husi 使用共享的 Base64 URI 输出；协议功能仍以各客户端实际支持为准，不代表每个节点类型均已实机验证。新识别条目不自动增加安装包下载源或用户推荐项。

官方依据：
- [Clash Party 订阅请求](https://github.com/mihomo-party-org/clash-party/blob/main/src/main/config/profile.ts)：默认 `mihomo.party/v<version> (clash.meta)`。
- [Throne 默认 UA](https://throneproj.github.io/help/troubleshooting/) 与 [支持格式](https://github.com/throneproj/Throne#subscription-formats)。
- [NekoBox UA 常量](https://github.com/MatsuriDayo/NekoBoxForAndroid/blob/main/app/src/main/java/io/nekohasekai/sagernet/ktx/Nets.kt) 与 [订阅解析](https://github.com/MatsuriDayo/NekoBoxForAndroid/blob/main/app/src/main/java/io/nekohasekai/sagernet/group/RawUpdater.kt)：`NekoBox/Android/<version> (Prefer ClashMeta Format)`。
- [Husi UA](https://github.com/xchacha20-poly1305/husi/blob/dev/composeApp/src/commonMain/kotlin/fr/husi/net/UserAgent.kt)：`husi/<version> (sing-box <coreVersion>)`；[订阅解析](https://github.com/xchacha20-poly1305/husi/blob/dev/composeApp/src/commonMain/kotlin/fr/husi/group/RawUpdater.kt) 支持 Base64 URI。
- Karing 当前公开的订阅模块引用 `HttpUtils.getUserAgent`，本次未取得该实现；不新增未经核验的前缀，其自定义兼容 UA 仍按对应已识别客户端处理。

`SubscriptionClientRegistry` 仅使用规范标识。旧标识只在迁移中出现，运行时不再接受旧名称或 flag 参数。

`V2rayN` 和 `V2rayNG` 继承 `UriSubscription`。`ClashVerge` 继承 `ClashMeta`；`ClashNyanpasu` 仅保留历史 VMess/VLESS 字段差异，其余共用生成器。内部 `UriSubscription` 不注册为公共格式，`uri`、`general` 不可用于未知客户端兜底。格式选择不能绕过 UA 准入。
## 升级：停用 flag 并迁移旧标识

部署前备份数据库，通过 `update.sh` 在维护期间运行 `2026_10_12_000001_canonicalize_subscription_clients`。本地测试环境已执行；生产环境仍需执行升级。迁移将策略、订阅日志、风控日志中的旧标识统一为 `mihomo`、`sing-box`、`clash-verge`、`clash-nyanpasu`、`clash-for-android`、`clash-for-windows`、`quantumult-x`、`ssr-plus` 等规范名称。

重复策略取禁用优先与更严格的最低版本，保留已有记录的名称、排序；迁移会固化旧白名单和父内核禁用限制。无法解析的最低版本使事务回滚，需要修正数据后重试。日志只改标识，不删除历史。迁移可重复运行；合并无法自动拆回旧数据，回退需恢复升级前备份。迁移前发现旧策略键时，订阅准入暂时拒绝，防止新代码按缺失策略默认放行。

V10 和自定义订阅路径统一使用 `format=<规范标识>`，不传时按 UA 自动选择。带任何 `flag` 参数（即使同时有 format）或旧格式名称的请求返回 422；用户需重新导入配置中心生成的新链接。UA 名称不是内部标识，实际 `Clash.Meta`、`HiddifyNext` 等前缀继续识别。格式选择仍受已识别 UA、客户端开关与兼容格式限制。

协议类不再声明 `$flag`，渲染器只负责输出；客户端身份来自 UA。专用客户端继续独立认证。历史统计接口中 `subscribe_flag_count_*` 等字段名暂时保留，字段内容已经使用统一客户端标识，避免无关后台接口破坏。
## FastAI 专用安装包上传

系统设置的「专用客户端下载」支持本地上传与外部 HTTPS 地址。先填写平台、架构、版本与构建号，再选择「上传 / 选择已上传安装包」。每个安装包上限 512 MiB，按 512 KiB 分片上传（另有 multipart 开销）；进度表示服务端已确认分片。当前窗口内失败可重试，重复分片按摘要校验，不会重复追加。刷新或关闭页面后需重新选择文件；上传完成的文件可从历史列表选择。

服务端合并后计算 SHA-256，不解压、不执行文件。平台扩展名及发布元数据校验不等于验证安装包签名或实际运行兼容性。上传完成只生成草稿；「确认发布」保存版本目录后才开放下载。历史文件保留，可重新选择发布；回退发布目录不保证客户端自动降级。外部链接仍由管理员提供 HTTPS 地址和摘要。

持久化目录为 `storage/app/fastai-installers`，不在 Web 根目录中。PHP 运行用户需有读写权限，部署时持久化并备份，多实例使用共享目录。`v2board.app_url` 需配置为用户可访问的 HTTPS 站点地址；源站在反向代理后使用 HTTP 不影响生成 HTTPS 地址。上传需要保留安装包两倍空间及额外 100 MiB。网关与 PHP 的单次请求限制应至少为 1 MiB，并允许 multipart 上传。下载通过 PHP 附件响应，支持 HEAD 和 Range；本次未接入对象存储，仍可使用对象存储生成的外部下载链接。

管理员 API（均在既有管理员前缀下）：`GET fastai-installers/fetch` 列出已完成文件；`POST fastai-installers/create` 接受 name/size/platform/architecture/latestVersion/latestBuild，返回 id/chunkBytes；`POST fastai-installers/chunk` 接受 multipart id/index/chunk；`POST fastai-installers/complete` 合并并返回 downloadUrl/sha256 等记录。写操作沿用管理员鉴权、浏览器 CSRF 与操作日志。上传目录无需数据库迁移。

既有 Laravel 调度器每小时运行 `fastai:prune-uploads`，清理 24 小时无活动且未完成上传的文件数据，保留已完成安装包。可手动运行同名 Artisan 命令。此目录已加入 Git 忽略规则。
