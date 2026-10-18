# 测试整理记录

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

`tests/suites.json` 是后端文件与检查项的对应清单，按 unit、integration、api、security、regression 分类；工作进程、浏览器夹具和导出脚本单独列为辅助项。保留既有 PHPUnit Unit/Feature 目录、Vitest 就近测试、Flutter test/plugin 目录和 Go 包内测试，避免破坏现有调用路径。

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
