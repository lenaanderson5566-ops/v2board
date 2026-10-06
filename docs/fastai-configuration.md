# FastAI 配置模板

Geo 数据随 App 内置，后端强制关闭 `geo-auto-update` 并移除
`geox-url` 与更新间隔，自定义模板也不能覆盖此策略。
默认模板没有远程规则集；自定义模板中的 HTTP 或含 URL 的规则提供者
会被拒绝，避免运行时下载规则。可以使用内联规则或随 App 发布的本地规则。

FastAI 通过 Bearer 会话请求 `GET /api/v10/me/client-config`，使用
`resources/rules/default.fastai.yaml`。需要自定义时，在同一目录创建
`custom.fastai.yaml`，该文件优先于默认模板，独立于通用订阅的
`default.clash.yaml` 和 `custom.clash.yaml`。

专用模板复用 Mihomo 节点转换和代理组填充逻辑，只下发真实节点。
即使后台开启订阅信息节点，FastAI 也不会插入剩余流量、到期时间、
重置时间等占位节点，也不会输出 `subscription-userinfo` 响应头。
账号信息由 App 的账号与订阅 JSON 接口读取；配置请求日志保持脱敏记录。

专用默认模板不设置本机监听端口、外部控制器地址或局域网共享，
这些运行参数由 App 管理。自定义模板不要手工添加订阅信息节点。

旧 `app.clash.yaml` 和 `custom.app.clash.yaml` 仅保留给原有旧 App 配置流程，
不参与 FastAI V10 配置生成，修改它们不会影响 FastAI。

回归验证：`php tests/fastai-client-config.php`、`php tests/fastai-template.php`。
