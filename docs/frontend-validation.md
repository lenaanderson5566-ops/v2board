# 前后台验证

当前界面由 `frontend/src` 的 React/TypeScript 实现。以现有源码、自动测试和接口契约为准；旧后台构建的字段抽取报告不再维护，历史报告可通过 Git 查阅。

## 本地检查

```sh
cd frontend
npm test
npm run build
cd ..
php tests/console-smoke.php
```

后台检查包含用户筛选和批量操作、订单、排序、节点配置、公告和知识库编辑。关键配置的业务语义见 [配置说明](critical-config-review.md)。用户接口验证见 [接口检查](api-v10/audit.md)。

浏览器复验可使用 `tests/console-ui-fixtures.php setup` / `cleanup`；用户套餐状态可使用 `tests/user-experience-fixtures.php setup` / `cleanup`。这些脚本仅用于本地环境，具体前置条件和清理保护以脚本为准。结束后执行清理，不提交临时数据。

检查桌面与手机的登录、充值、订阅购买、付款、工单和导入流程，特别核对加载、失败重试、字段保留及键盘操作。自动测试不代表真实 SMTP 投递、支付结算、节点连接或原生客户端唤起已验证。

## 2026-10-05 回归结果

验证当前依赖和构建，未执行依赖升级。前端 47 个测试文件、317 项测试通过；TypeScript 与生产构建通过。Vite 提示主包和代码编辑器分包超过 500 kB，属于性能优化项。

后端：V10 契约 112、后台冒烟 185、认证 21、订单替换 8、额度 47、额度权限 17、储备重置 33、MGate 14、客户端语言 48、镜像 23、Apple 账号 26、套餐翻译 13、注册策略 16、邮件 328、路由审计 565 项通过。客户端选择与风控审核测试通过。

补充检查：账户状态 21、接口退役/下载 78、接口清单 285、Banner 22、版本识别 9、内容翻译 14、CORS 12、邮件邀请 40、语言偏好 35、公告回执 24、自动翻译 17、风控活动 12、风控概览 17、使用窗口 8、部署校验 4 项通过。

修正额度、储备重置、邮件邀请和公告回执脚本中的旧接口调用，改测 V10 Bearer、camelCase、分页和状态码，并确保未捕获异常返回非零退出码。未修改产品业务代码。

浏览器抽查本地已登录账户的总览、套餐列表、购买弹窗、账单、充值弹窗和已取消订单详情；抽查过程中控制台无捕获的 error/warn。检查手机订单详情。该抽查不代表所有页面、所有角色或所有浏览器均已逐项人工验证。

边界：真实支付到账、SMTP 收件、第三方账号服务、原生客户端导入、真实节点连接，以及 Safari/Android 真机仍需部署后验收。安全报告中的未修复事项继续有效，不能以本次功能测试替代安全验收。

## 用户端加载优化（2026-10-05）

- 繁体、日语、韩语、越南语、俄语、波斯语通用词典按需下载；简体和英文回退词典保留同步加载。首屏等待所选语言初始化；切换前先确保词典可用，下载失败不保存新的语言偏好。
- 账单、支付、套餐、使用情况、客户端导入、邀请与账户偏好组件按需加载；已登录用户并行加载用户模块与账户请求。
- Vite 同配置构建对比：主入口从 734.44 kB（gzip 232.91）降至 595.13 kB（gzip 201.15）；user 公共模块从 169.50 kB（gzip 62.21）降至 48.22 kB（gzip 20.49）。拆出的页面资源在访问时仍需下载，数字不是全站总大小或实际耗时降幅。
- 318 项前端测试、类型检查、生产构建和 4 项部署校验通过；支付刷新状态保留与按需语言加载已覆盖。浏览器验证套餐与繁体切换成功，恢复原语言后无捕获的控制台错误。
- 尚未测量生产网络的 LCP/INP；主入口仍超过 500 kB，后续可继续隔离 Markdown 与后台公共代码。部署需同步发布 manifest 和全部资源，避免 CDN/旧页面引用失效的分包。

## User and backend bundle isolation

The user entry has no static backend module imports. The backend workspace and legacy backend stylesheet are loaded only inside explicit admin-mode branches. Backend-only field renderers are provided by the backend workspace, so shared user forms have no dependency on backend editors or controls.

`npm run build` checks both the source dependency graph and emitted chunks, including all user page navigation imports. A backend JavaScript, stylesheet or settings JSON dependency in that graph fails the build. Tests also verify the guarded entry branches and backend field-provider behavior. Laravel user pages include only the shared entry stylesheet; backend styles are separate assets.
