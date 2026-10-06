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

## 部署后核实

专用接口成功响应包含 `X-FastAI-Config-Version: 1`，用于辨别线上是否已部署专用配置实现。
检查此响应头、确认不存在 `subscription-userinfo`，并确认 YAML 的 `proxies` 只包含真实线路。
自定义 FastAI 模板中的订阅信息节点也会在最终输出时清除，对应代理组引用同时移除。

如果线上仍返回订阅信息节点，需要部署最新后端并按照实际运行环境重新加载 PHP 工作进程／OPcache，
随后重新请求专用接口。不要将 YAML、Bearer 令牌或节点密码写入部署核实日志。
App 同步时会兼容过滤旧后端返回的已知订阅信息节点，并记录过滤数量；修复后重新同步即可更新旧配置。

## 节点地区与名称

后台节点编辑使用国家 / 地区、州 / 省或城市与线路后缀。国家输入代码（如 `us`）精确匹配，界面显示中文名称及标准代码（例如“美国（US）”）。州、省和城市按国家筛选，支持中英文名称、统一标识与厂商区域代码检索，也允许填写未收录的英文位置。

参考项使用州、省或城市，不使用云厂商的东西南北分区名称。例如 AWS 北加利福尼亚与 Vultr 硅谷均归入加利福尼亚州；AWS 北弗吉尼亚归入弗吉尼亚州。厂商只公布国家或多个跨州城市、无法确认单一州或城市时不添加该代码的自动映射，不依据 IP 地址猜测机房。覆盖范围与官方来源见 [node-location-catalog.md](node-location-catalog.md)。

所有协议共用 `resources/client/node-locations.json`：`cities` 保存位置翻译，`cityRegions` 保存国家映射，`locationKinds` 区分州 / 省与城市，`cloudProviders` 保存带厂商命名空间的区域代码、官方来源与核对日期。新增位置只维护这一份目录。`city_code` / `cityCode` 的字段名保留兼容，但语义包含州、省或城市，保存值仍是 `california`、`tokyo` 等统一标识。

输入 `aws:us-west-1` 会识别为加利福尼亚州。跨厂商同名代码对应不同位置且国家无法消除歧义时，拒绝保存并提示明确选择，不猜测厂商。已有节点标识保留，未收录翻译回退为英文。缺少国家信息的旧节点保持原名；已填写国家时，只输出已填写的位置和线路编号，不追加原节点名称；位置和编号都可留空。没有新增数据库字段，也无需为此再次迁移。

显示示例：只填美国 → `美国`；美国 + 圣何塞 → `美国 · 圣何塞`；美国 + 加利福尼亚州 → `美国 · 加利福尼亚州`；美国 + 编号 A → `美国 · A`。位置是城市或州之一，不要求两者同时填写。只有完全未配置国家的旧节点使用原名回退。专用 App 使用稳定节点 ID，不要求显示名称唯一；开源订阅遇到同名节点时追加 `(2)` 等序号，保留原名的内部映射供模板匹配，不将原名显示给用户。

升级使用 `update.sh`，脚本会执行节点展示字段的迁移。仅执行 `git pull` 不会更新数据库；已手动拉取代码的部署，应在网站项目目录使用与 PHP-FPM 相同的 PHP 执行本次迁移：

```sh
php artisan migrate --path=database/migrations/2026_10_06_000001_add_node_display_metadata.php --force
```

该迁移只给八类节点表增加可空的地区代码、城市标识与线路后缀，不删除节点或修改节点地址。未迁移时，即使只编辑地址，后台提交的展示字段也会使数据库保存失败。不要运行 `migrate:fresh`。无需立即修改现有节点资料。
`GET /api/v10/me/nodes` 返回 `nodeId`、`proxyName`、`regionCode`、`cityCode`、`displayLabel`、`displayNames` 和现有 `tags`，仅含账号有权限访问的节点。

新版 FastAI 发送 `Accept: application/json`，专用配置响应为 `data: {configVersion, yaml, nodes}`，包含 `X-FastAI-Config-Version: 2`。两部分来自同一次查询；内部名称为 `node_<模型类型>_<id>`。App 根据 `proxyName` 映射，显示内置国旗 SVG 与当前语言名称，测速和选择使用内部名称。本地元数据通过 YAML 摘要校验，避免错配。旧 App 请求 YAML 时保持原格式和原名称，响应版本为 1。

公开订阅仍使用标准协议，自动输出国旗 emoji、地区代码和对应语言名称，模板正则兼容原节点名。语言沿用订阅链接和账号的现有协商规则。不要将专用配置链接交给第三方客户端导入。

另运行 `php tests/node-display.php`。生产部署后重新加载 PHP/OPcache，核实 JSON 响应版本 2；不要记录含节点认证信息的响应体。
