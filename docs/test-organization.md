# 测试整理记录

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
