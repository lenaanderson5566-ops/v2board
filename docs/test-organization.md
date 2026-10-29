# 测试组织与执行

本文维护当前测试入口、隔离要求和验证边界。逐轮测试数量、旧版发布结果和临时日志路径不再累积为操作说明；已提交的历史记录可通过 Git 查阅。当前是否通过必须以本次执行结果为准。

原生路由回归复用 `node-routes`、`console-smoke`、`Nodes.test.tsx` 与 `admin-linkage.test.ts`：覆盖原生创建、兼容规则编辑、模板隔离、引用服务数、合并后跨片段标签检查及失败回滚。面板模板来自 `resources/client/node-route-presets.json`；V2Box 的 `core/testdata/panel-routing-presets.json` 是同内容测试快照，更新模板时同步，并运行 `TestPanelRoutingPresets` 验证固定核心解析。

## 测试入口

路由下发与生效验证复用 `node-routes`、`node-v10`、`v2box` 和现有 Go `core/native_test.go`、`api/v2board/v10_test.go`、`node/reload_retry_test.go`。`NODE_ROUTING_FIXTURE` 可在一次性面板测试副本导出兼容/V10 配置响应，节点以 `V2BOX_ROUTING_FIXTURE` 读取并验证两个接口解码一致及条件请求；这些仅为测试数据，不能使用生产响应。核心真实连接回归覆盖八类阻断匹配、HTTP 代理及默认出口、DNS 命中/回退、受信任测试证书的 HTTPS 规则集，并与出站安全保护同时执行。测试仅连接本地回环服务。

路由可视化管理复用 `Nodes.test.tsx` 与 `node-routes`、`console-smoke`，覆盖常用表单保存、代理参数保留、现有模板无损还原、非法条件拒绝、复杂 JSON 复制与转换保护、嵌套条件搜索、引用筛选和明细、删除保护及未保存修改保护。新界面继续保存原生配置，后端引用和合并校验保持生效，不增加平行验证入口。

Lightsail 共用凭据继续复用 `lightsail`、`retired-node-tables`、`update-script`、`framework-upgrade`、`api-route-audit` 和 `AdminLightsail.test.tsx`。覆盖跨区域多服务器引用同一凭据、全体绑定密钥更新确认、运行状态和 worker 锁保护、绑定删除保护、旧密文合并及解密失败回滚、嵌套新建密钥后保留服务器草稿。凭据读取及轮换测试仅使用模拟 SDK 和测试凭据，不访问真实 AWS。

新增节点表单的展示字段复用验证保留在 `Nodes.test.tsx`、`admin-location-select.test.tsx`、`admin-linkage.test.ts` 和共享字段上下文测试中。覆盖两种新增方式的真实搜索控件、名称预览、稳定地区/城市代码及标签提交、共享服务位置继承和手动修改保护，继续保留部署、线路发布、权限和未保存修改断言，不增加独立验证脚本。

Lightsail 管理修复复用 `tests/lightsail.php` 与 `AdminLightsail.test.tsx`，覆盖失败阶段移除确认、凭据修复、明确放弃后重新关联、任务锁、执行中禁止修改、取消确认及未保存草稿不改变移除目标。后端使用模拟 AWS，并断言管理配置修改及延迟任务不操作云资源，不执行真实静态 IP 切换。

- 后端：`tests/suites.json` 登记 unit、integration、api、security、regression 测试；`tests/run.php` 负责清单校验、筛选和独立进程执行。
- 辅助项：工作进程、浏览器夹具、导出脚本和公共工具列在清单的 `helpers` 中，不作为独立测试执行。
- PHPUnit：`tests/Unit/AssertionsTest.php` 验证公共断言工具，不启动 Laravel。
- 前端：Vitest 用例与 `frontend/src` 中的组件和模块就近存放；专题命令以 `frontend/package.json` 为准。
- V10 生成器：`scripts/test_generate_v10.py` 验证生成规则；维护源和发布物边界见 [项目结构](project-structure.md) 与 [V10 规范](api-v10/README.md)。
- 客户端：FlClash 保留 Flutter 根测试、插件测试及 Go 包内测试，执行方式见该项目 `.agents/commands.md`。根 Flutter 测试不会自动覆盖所有插件。
- 节点：v2box 保留 Go 包内测试及 `script/` 中的生命周期、网络上报和凭据测试；构建标签与执行矩阵以该项目 CI 为准。

```sh
php tests/run.php --validate
php tests/run.php --list
php tests/run.php --suite=security
php tests/run.php --only=mfa,mfa-api,mfa-concurrency
```

## 隔离与安全

实际运行后端脚本必须使用独立、可销毁的项目副本、local/testing 环境及 `TEST_DISPOSABLE_WORKSPACE=1`。副本不得携带生产 `.env`、站点配置或 bootstrap 缓存。

MySQL 测试账号须能创建和删除随机命名的测试库。普通事务场景共享可销毁 schema，安装和迁移场景单独建库，各脚本独立进程运行；退出后清理本次创建的测试库。部分检查会写配置，不能仅更换数据库名后在运行中的项目目录执行。

运行器在隔离副本缺少 `.env` 或 `config/v2board.php` 时创建空白测试文件，避免依赖本机配置。控制台集成测试还需提供 `storage/geoip/` 下 Country、City、ASN 的公开 MMDB 数据库副本；不得复制其他生产存储。

Redis 测试使用专用实例或专用测试数据库，且每个测试入口使用独立前缀；不得清空应用或其他任务的 Redis 数据库。邮件、支付、Telegram、Cloudflare、ACME、下载和服务管理均应使用模拟传输或临时夹具，不连接生产服务。

```sh
python scripts/generate-v10.py --check
python -m unittest discover -s scripts -p test_generate_v10.py
cd frontend
npm test
npm run build
```

生成器测试也应使用可销毁副本或可写临时目录。浏览器夹具的准备、清理和人工检查见 [前后台验证](frontend-validation.md)；接口检查见 [V10 审计](api-v10/audit.md)。

## 维护规则

复用现有领域模块与 `tests/support` 公共工具，不为每轮开发新增平行验证脚本。新增或合并后端入口时同步更新 `tests/suites.json` 并执行 `php tests/run.php --validate`；工作进程和手动夹具始终归入辅助项。

合并测试须保留业务、安全、迁移、并发和失败恢复断言，并更新命令、CI 和文档引用。测试由框架自动发现时，不能仅因缺少文本引用判定文件无用。退役接口的拒绝访问和历史漏洞回归仍有用途。

PHP 入口经 `tests/support/run-script.php` 执行，未捕获异常必须以非零状态返回；不能只查看 Laravel 是否正常输出。

运行日志和临时报告保存在 `storage/app/test-organization/`，不得包含凭据。开发轮次结束后可清理历史输出；安装包、校验文件、回滚快照、生产运行日志及应用数据不属于临时测试产物。

## 验证边界

仪表盘沿用 `dashboard-revenue` 验证币种隔离、支付时间、缓存与排行榜；节点排行先按节点汇总再取前 15 名，相同流量按 ID 稳定排序，只批量查询榜单名称，保留缺失节点历史记录。`node-backends` 继续覆盖 V2Box 节点来源兼容性。

跨面板与节点的公共层回归：`framework-upgrade` 检查任务超时、Horizon 停止上限和队列重投间隔留有余量；`node-traffic-batches` 与 `node-traffic-concurrency` 验证重复领取不会重复计费，调度器可恢复未处理批次。前端 `api.test.ts` 覆盖 CSV 等待响应头、读取正文的超时，禁止自动重放导出操作。V2Box 的 `node/reload_retry_test.go` 用 HTTPS 夹具及真实本地核心验证在线统计失败不丢失用户撤销，以及准备失败后的缓存恢复；全量 Go 竞态与生命周期测试沿用节点仓库 CI 命令。

自动测试、静态分析和构建各自说明不同结果，不能互相替代。工具链或输入不足而跳过的测试，须明确报告原因，不能记为通过。

V2Box 的核心关闭回归保留远程 HTTPS 规则集的真实转发验证，并覆盖关闭时中断待处理连接、等待路由匹配结束、拒绝迟到连接，防止规则集释放与匹配并发访问。

本地模拟不证明真实邮件送达、支付结算、生产节点联网、Cloudflare 解析或公网证书签发成功。Windows TUN、Android VPN/DNS/网络切换及各平台原生构建须在对应环境验证。长时间 soak、外部 padding preset 或面板联调等可选场景，应提供所需输入和显式开关后再执行。

## 可选联调与测试归属

- `framework-upgrade` 统一验证 Laravel 运行契约、Horizon 环境变量及配置无输出、迁移基线和待执行迁移检测；原两个独立入口的断言全部保留。
- `v2box` 普通运行使用模拟传输。`V2BOX_BOOTSTRAP_TEST=1` 启用真实 Shell 夹具，`V2BOX_NETWORK_SCRIPT` 指向隔离复制的节点上报脚本；独立数据库联调用 `V2BOX_INDEPENDENT_DATABASE_SMOKE=1`，仅在可销毁 Linux 容器执行。多后台追加、授权重放、局部回滚、长连接和证书保留由既有模块覆盖。
- `node-v10` 验证授权边界、配置回执和用户下发；`retired-node-tables` 验证旧数据退役迁移，不能因功能退役而删除其数据保护断言。
- `lightsail` 与 `AdminLightsail.test.tsx` 覆盖共享凭据、失败恢复、任务锁和错误诊断；只用模拟 AWS。HTTP/cURL 状态不能单独证明真实权限、配额或资源存在性。
- `lightsail` 同时通过 SDK 的 HTTP 处理器注入响应，验证真实错误解析、空错误码和非空未知错误码 HTTP 400 的分页列表核验、完整申请/换绑/释放和查询失败时的旧 IP 保护；畸形列表、循环分页与未知 404 不得授权资源变更。
- Lightsail 诊断断言覆盖执行编号关联、AWS Request ID 与响应元数据、敏感内容排除，以及日志不可写时原有失败和恢复行为保持不变。
- 用户功能开关复用 EmailInvites、HelpSupport、QuickStart 和 BillingFlow 前端用例；套餐关闭切换的目录、详情、历史套餐续费与到期边界归入现有 `commerce` 模块，在隔离数据库执行。

## 文档与测试清理

验证文档只维护当前入口、覆盖范围及验收边界，不累积每轮测试计数、旧发布流水或本机临时路径。历史结果由 Git 和忽略的测试输出保存。前后台验收方式见 [前后台验证](frontend-validation.md)。合并测试后同步清单、命令及引用，保留原断言并在隔离副本执行受影响模块。

清单校验、合并后的框架回归及本次修改文档的本地链接检查已通过；执行结果保存于忽略的 `storage/app/test-organization/docs-test-cleanup.json`。框架测试合并本身不修改生产功能或数据库迁移；前端改动仍按实际范围测试并重新构建。

后台样式一致性使用现有前端全量与 Lightsail、DDNS、节点等模块复查，保留提交锁、未保存保护和恢复流程断言。后台主题只修改管理员样式；桌面与窄屏通过仅本地、禁止写入的合成数据页验收。验证日志为 `storage/app/test-organization/admin-ui-consistency-*`，临时预览入口不纳入发布资源。

子窗口交互复用 `UXResilience.test.tsx`、`Banners.test.tsx`、`AdminRiskReview.test.tsx`、`ContentComposer.test.tsx`、`AdminDictionary.test.tsx`、`Payments.test.tsx` 和既有后台业务模块。保留原业务断言，新增关闭保护、同步提交锁、失败草稿和焦点排除场景；共享 Modal 的草稿确认显式启用，默认关闭策略不变，公共确认文案覆盖全部语言。结果与构建日志保存在 `storage/app/test-organization/admin-subdialogs-*`。


统一结算继续复用 `order-replacement`、`api-v10`、`api-v10-inventory`、`commerce`、`coupon-availability` 和 `payment-presentation`，不新增平行后端验证入口。覆盖预报价无资产占用、金额及所有者绑定、过期/篡改/变化拒绝、原子替换预览、重复下单与支付结果重放、网关结果不确定时恢复查询。前端 `BillingFlow.test.tsx` 保留周期、优惠金额、订单参数和支付断言，并覆盖同页结算、过时报价、未知结果原请求重试、409 后重新确认及 StrictMode 不重复发起支付；全量 Vitest、类型检查和构建按既有命令运行。浏览器合成数据仍使用忽略目录中既有预览夹具，不接入真实付款。


生产恢复保护继续归入 `order-replacement`、`api-v10`、`payment-presentation` 与 `commerce-concurrency`：覆盖不传标识不能绕过未确认支付、处理中结果不能通过新标识重付，以及仅有预报价元数据的未支付订单展示。浏览器路由和短期确认交接复用 BillingFlow/app 用例；模拟夹具与运行输出不进入发布目录。


加密货币支付排列复用 PaymentMethodPicker、BillingFlow、PaymentCheckout 与 PaymentPolling 回归；保留具体渠道选择、同网络多渠道区分、付款中禁用和图标兜底断言。BillingFlow 补充展开多网络币种后切换周期，不能被默认钱包抢回选择，只有选定具体网络并取得报价后才能确认。布局在既有合成预览中验收，不新增测试运行器或真实网关请求。


结算限流与冲突恢复继续使用 BillingFlow、CouponPicker、PaymentMethodPicker、shared/api、shared/useData 和 localization：覆盖只读 POST 报价不广播资产变化、不清除钱包读取缓存，409 后不循环重选渠道，已有订单优先恢复，Retry-After 秒数/日期解析与倒计时，输入变化、聚焦和重复点击不绕过冷却，以及优惠券失败的次要提示。保留订单、优惠金额、准确渠道和最终确认断言；完整前端回归及生产构建按现有入口运行。


报价缓存复用现有 BillingFlow 测试模块，覆盖相同选择即时回切、完整条件/币种/语言隔离、30 秒与服务端到期边界、复用不延长有效期、刷新与资产变化失效、迟到响应丢弃、错误与限流保护、页面/会话生命周期及容量限制；既有报价冲突用例加入缓存命中后服务端拒绝并要求再次确认的路径。其余订单和付款断言保留，按购买与支付相关测试和生产构建验证，不新增运行器。


重报价布局继续复用 BillingFlow 与现有支付、多语言测试：覆盖等待响应时保留已标记的旧报价及原周期、状态和支付选项 DOM 保持挂载、响应成功后同步更新金额与周期，以及延迟/失败时强制提交表单也不能发起下单。浏览器在既有合成预览中延迟报价，比较桌面和窄屏的支付列表、明细及底部操作位置；运行输出与截图继续保存在忽略目录。


同页付款复用 BillingFlow、PaymentCheckout、PaymentPolling、PendingOrderNotice 与 app：覆盖 StrictMode 下创建订单/二维码付款只发起一次、不导航到账单、不重置滚动，刷新恢复无自动付款，返回订单不匹配时禁止发起支付，已有订单就地继续，以及登录恢复只保留合法订单编号、不携带付款指令或外部返回地址。原报价、金额、幂等键与支付状态断言继续保留；浏览器使用既有合成夹具，不接入真实网关。
