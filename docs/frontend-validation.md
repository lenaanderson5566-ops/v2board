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
