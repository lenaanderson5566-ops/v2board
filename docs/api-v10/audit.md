# 接口验证与发布检查

用户接口使用 V10；默认订阅及镜像下载使用新版资源路径。后台、客服、风控和节点通信保持现有协议。旧用户业务接口已退役，保留范围以 [实际路由清单](retained-endpoints.md) 和 [兼容白名单](retained-legacy.json) 为准。

支付新订单及后台回调地址统一使用 V10，旧回调继续接收历史交易通知。自定义订阅路径通过独立兼容控制器调用共享订阅服务，不跳转、不更换用户令牌。

## 自动验证

在本地测试环境执行，PHP 数据库测试使用临时数据与事务回滚：

```sh
php tests/api-v10.php
php tests/api-v10-inventory.php
php tests/api-route-audit.php --write-inventory
php tests/api-retirement.php
php tests/mgate.php
php tests/order-replacement.php
php tests/registration-policy.php
php tests/console-smoke.php
cd frontend
npm test
npm run build
```

- 契约测试验证认证、字段校验、订单与充值、支付回调、订阅格式和对象归属。
- 路由审计检查处理方法存在性、后台权限及 V10 未登录行为；退役测试禁止旧入口和无用控制器重新出现。
- 保留历史映射用于功能追溯，映射中的旧路径或类名不表示仍可调用。
- 运行输出为本次验证结果，不维护会随功能变化而过时的累计测试数字。

## 上线验证边界

本地支付和邮件测试使用替身，不证明生产支付商签名、网络、防火墙、SMTP 或真实客户端工作正常。部署时同步后端和前端构建、清理缓存并重启队列；按 [部署说明](README.md#deployment-and-rollback) 执行。

生产验证需确认：支付商可访问新回调、重复通知不会重复开通、Horizon 正常消费任务、自定义订阅可以刷新，以及镜像下载可用。不要用真实批量发信或真实用户数据代替本地回归。
