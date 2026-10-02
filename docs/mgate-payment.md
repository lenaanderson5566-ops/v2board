# MGate 支付接口

后台「支付配置」新增支付方式，接口选择 `MGate`，填写网关基础 API 地址、APPID、AppSecret、源货币（默认 `CNY`），保存后启用。AppSecret 使用后台的密码输入框；回调地址由现有支付配置页面生成。无需新增依赖或数据库迁移。

实现基于提供的 `MGate.php`：请求地址为基础地址加 `/v1/gateway/fetch`，金额沿用 V2Board 的分单位，签名是参数按键排序后 `http_build_query` 拼接 AppSecret 的 MD5，响应使用 `data.pay_url` 跳转。回调验签后将 `out_trade_no`、`trade_no` 交给现有订单处理流程。没有自行添加附件中未定义的回调状态字段。

接入补充了 HTTPS 证书验证、请求超时、无效返回地址/回调字段校验和 Curl 资源释放。配置 API 地址时不要再次填写 `/v1/gateway/fetch`。

本地 `php tests/mgate.php` 使用模拟网关验证请求参数、签名、跳转结果、异常处理、回调验签和后台发现机制，不发送真实付款请求。上线需使用商户凭据做小额支付及回调验收，核对金额单位、到账状态和重复回调行为。
