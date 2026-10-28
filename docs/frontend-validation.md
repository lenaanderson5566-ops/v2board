# 前后台验证

本文维护当前验证方式和人工验收清单。旧日期章节、逐轮测试计数、过时界面方案及发布记录通过 Git 查阅；历史通过结果不代表当前版本已验证。功能行为分别以对应文档和当前代码为准。

## 自动检查

在可销毁副本中执行；数据库、缓存和外部服务隔离要求见 [测试组织](test-organization.md)。

```sh
php tests/run.php --validate
php tests/run.php --only=console-smoke,console-verify,frontend-runtime
cd frontend
npm test
npm run build
```

前端组件测试与模块相邻，专题命令见 `frontend/package.json`。构建会执行 TypeScript 检查及静态资源打包；需核对 manifest 引用的文件齐全，再部署生成的资源。生成契约检查见 [项目结构](project-structure.md)，接口检查见 [V10 验证](api-v10/audit.md)。

针对修改范围运行现有模块。路由和节点使用 `Nodes.test.tsx`、`admin-linkage.test.ts`、`node-routes`、`node-v10`；Lightsail 使用 `AdminLightsail.test.tsx`、`lightsail`；浏览器认证、支付及安全变化同时运行对应后端模块。不要仅因测试名称含旧接口、迁移或历史漏洞而删除断言。

## 本地浏览器夹具

以下脚本只在独立 local 环境、测试数据库中手动执行，不属于自动测试入口：

```sh
php tests/console-ui-fixtures.php setup
php tests/user-experience-fixtures.php setup
# 完成人工检查后恢复
php tests/user-experience-fixtures.php cleanup
php tests/console-ui-fixtures.php cleanup
```

控制台夹具只创建带专用前缀的隐藏测试内容。用户体验夹具要求事先存在非管理员 `test@example.com`，会备份并临时修改其套餐字段；上次恢复文件存在时不能再次 setup。遵守脚本中的引用保护，清理失败时先核对引用，不强制删除数据或恢复文件。不要向夹具提供真实支付、邮件或云服务凭据。

## 浏览器验收清单

桌面与窄屏均检查加载、空数据、请求失败与重试；同时覆盖键盘焦点、弹窗关闭、滚动、字段标签和错误提示。

CSV 导出使用 60 秒超时，覆盖响应头等待和文件正文读取；失败提示确认操作结果后重试，不自动重复生成优惠券等数据。测试通过模拟中断验证超时和单次请求，不能证明大数据导出的线上耗时。

浏览器会话初始化的 15 秒超时包含 JSON 正文读取；超时清除未完成的初始化任务，后续请求可重新初始化。回归同时保留跨标签页切换账号时阻止旧表单提交、CSRF 刷新和离线退出的既有断言。

| 范围 | 检查重点 | 功能说明 |
| --- | --- | --- |
| 登录与账户 | Cookie 会话、CSRF、退出、MFA/Passkey、账户限制及删除确认；失败后字段保留 | [浏览器会话](browser-sessions.md)、[认证安全](authentication-security.md)、[MFA](mfa.md) |
| 购买与支付 | 套餐、币种、优惠券、订单详情、充值、过期和支付失败；取消和重复点击保护 | [订阅购买](subscription-checkout.md)、[多币种计费](billing-currencies-coupons.md)、[支付界面](payment-checkout-ui.md) |
| 用户页面 | 订阅复制与导入、客户端下载、使用量与账单、工单、公告和账户设置 | [账户体验](account-experience.md)、[使用与重置](usage-resets.md) |
| 后台列表与表单 | 搜索、筛选、排序、分页、显示偏好、权限、错误保留及未保存修改保护 | [后台工作区](admin-workspaces.md)、[共用组件](admin-components.md) |
| 节点与线路 | 新增方式共用名称/地区选择、共享服务继承、独立线路、TLS 身份、流量额度与表单切换 | [节点管理](node-management-ui.md) |
| 部署与升级跟踪 | 状态查询失败自动重试、15 分钟暂停后重新生成恢复、复制升级命令后跨越离线状态继续观察 | Nodes、node-v10、v2box；组件与隔离后端回归，不替代真实服务器升级 |
| 域名与部署 | 当前/待启用地址、DNS 与证书状态、配置回执、一次性授权、失败恢复及多后台隔离 | [节点管理](node-management-ui.md)、[当前 IP](node-current-ip.md) |
| 路由 | 可视化和高级 JSON 无损切换、逗号正则、复制、条件搜索、引用明细、删除保护和失败回滚 | [节点管理](node-management-ui.md)、[V2Box](v2box.md) |
| Lightsail | 共享密钥绑定与轮换确认、失败配置编辑/移除、继续/恢复、AWS 动作及 HTTP/cURL 诊断 | [Lightsail](lightsail-ip-management.md) |
| 邮件与多语言 | 模板预览、邀请、禁发、翻译覆盖、切换语言、时区和受限浏览器存储 | [邮件](product-mail.md)、[内容翻译](content-translations.md)、[时区](timezones.md) |
| 统计与运维 | 时间筛选、访问统计开关、空报表、保留期、受限功能和告警跳转 | [监控与治理](observability-governance.md) |

浏览器自动化使用合成数据或本地夹具，禁止在生产账号上测试付款、批量发信、删除、换 IP 或证书申请。

## 验证边界与记录

组件测试证明交互和契约，构建证明类型及资源可打包；两者均不能代替真实浏览器视觉验收。报告须区分自动测试、浏览器检查、真实节点和外部服务联调，并说明未执行的部分。

共享后台组件回归覆盖操作菜单的实际高度定位、方向键入口、隐藏和禁用项排除，以及异步提示清理后旧请求完成的竞态。当前样式整理已通过前端全量自动测试；本轮本地浏览器工具连接失败，新的共享详情布局、阴影和筛选样式仍需桌面及窄屏视觉验收。历史轮次的浏览器记录不代表本轮已验收。

模拟 SDK 不证明真实 AWS 权限或公网 IP 切换；本地回环的 sing-box 测试不证明线上配置已生效；模拟 SMTP、支付和 Cloudflare 不证明邮件送达、结算、DNS 传播或公网证书签发。原生客户端唤起、Android VPN 和 Windows TUN 需对应平台单独验收。

本轮结果和构建日志写入忽略的 `storage/app/test-organization/`，不包含凭据或生产数据。文档不再累积逐轮通过数量。后台样式核对使用真实页面组件和仅本地的合成数据响应，逐项打开侧栏入口及工作区标签；重点查看 Lightsail 嵌套抽屉、Cloudflare 凭据、路由编辑、日志筛选及带单位设置表单的桌面和 390px 窄屏布局。合成数据以空列表为主，不代表每种业务数据状态或线上环境均已人工验收；未执行真实云服务操作。

子窗口复核补充：使用本地模拟失败检查通用编辑及 Banner 的字段保留、忙状态和重试；检查 Banner 长表单、风险详情/复核及只读长文本在窄屏下的布局。自动回归另覆盖所有关闭入口、隐藏/禁用控件的焦点循环、取消后重开、重复提交和字典冲突后的草稿保护。原生确认框的接受/拒绝由组件测试明确验证，浏览器结果不替代生产数据状态验收。
## 可选安全功能入口

MFA 与 Passkey 设置卡片以服务端状态为准，加载时不闪现可开启入口。站点关闭且无历史绑定时隐藏；有历史绑定时保留管理和恢复。`MfaSecurity.test.tsx`、`PasskeyLogin.test.tsx` 覆盖开关、历史绑定和登录验证；`tests/mfa.php` 覆盖发起与确认之间关闭开关的拒绝行为。Telegram、账户自助删除和 iOS 共享账户下载入口仍使用各自开关；隐私偏好在统计关闭时保留用户选择。本轮以自动化与生产构建验证，未进行真实设备 Passkey 或生产 MFA 变更。

## 用户功能开关核对

| 后台配置 | 关闭时的用户行为 | 验证入口 |
|---|---|---|
| 停止注册 | 登录页及落地页不提供注册入口；邀请页隐藏发送表单，保留邀请历史和佣金记录 | UserAuth、Landing、EmailInvites |
| 新工单关闭或需购买 | 隐藏创建按钮及已打开的新工单表单，保留查看/回复已有工单 | HelpSupport、OrderHelp |
| 允许切换套餐 | 有效且有流量额度的当前订阅只返回当前套餐，直接获取其他套餐详情也拒绝；允许的续费不受影响 | commerce、BillingFlow |
| 客户端策略停用 | 不显示停用客户端的选择卡片、导入链接和下载弹窗；全部停用时不打开空选择弹窗 | QuickStart |
| Telegram、自助删除账户、共享 Apple 账户、Passkey、MFA | 分别使用自己的开关，不以其他功能的开关替代 | AccountDeletion、ClientDownload、PasskeyLogin、MfaSecurity |
| 关闭提现 | 隐藏提现按钮及表单，保留佣金记录和转入余额 | user.tsx 与服务端 TicketActions |

充值奖励为空不表示禁止充值；多级佣金关闭不表示禁止直接邀请；隐私偏好和历史凭据管理不随功能入口一起删除。套餐目录的限制与订单端的有效期、剩余额度、当前套餐条件一致；新用户、已过期用户仍可购买。前端运行配置型开关在重新加载后应用，独立部署前端须同步导出的运行配置；服务端继续拒绝被关闭的写操作。本次未操作真实支付、邮件或生产用户数据。
