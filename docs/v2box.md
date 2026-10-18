# V2Box 节点接入

后台节点管理新增 `v2box`，与 `v2node` 并列。两类节点使用独立表、ID、状态缓存和流量统计类型；同一数字 ID 不会指向同一条节点。支持新增、编辑、复制、删除、排序、父节点、地域显示和一键安装命令。

升级面板时，`update.sh` 定向执行 `2026_10_11_000001_create_v2box_nodes.php`。此迁移只复制 V2Node 表结构，不迁移节点或流量历史。全新安装也会创建该表。

节点侧需要使用包含 `NodeType` 支持的新版 V2Box。Nodes 中配置 `"NodeType": "v2box"`，并填入后台 V2Box 节点的 `NodeID`。一键安装命令传入 `--node-type v2box`。安装器保留已有配置；已有机器需要手动核对 NodeType 和 NodeID。未填写 NodeType 的旧配置继续使用 v2node。

通信沿用 `/api/v2/server/config` 与 `/api/v1/server/UniProxy/{user,alivelist,push,alive}`，参数为 `node_type=v2box`。管理接口沿用管理员前缀下的 `server/v2box/{save,update,copy,drop}`。用户订阅仍走 V10，按底层协议生成；原生节点稳定标识使用 `node_v2box_ID`。

V2Box 支持 Shadowsocks、VMess、VLESS、Trojan、TUIC、Hysteria2、AnyTLS、Naive。表单提供 TCP、WebSocket、gRPC、HTTPUpgrade；VLESS 支持 Reality。当前实现不接受 XHTTP、HTTP 传输、Xray VLESS 加密、可信 X-Forwarded-For、Proxy Protocol、ECH 等不兼容配置。高级传输参数也由后端检查。

## Naive

仅 V2Box 提供 Naive 协议，复用 `v2_server_v2box`，无需新增表或迁移。必须同步升级含 Naive 的 V2Box 二进制；旧二进制无法识别该协议。

- 管理后台选择 V2Box → Naive。首版仅 HTTPS/HTTP2：TCP + TLS；不支持 QUIC/HTTP3、Reality 或其他传输。
- 填写证书 SNI；证书模式选 HTTP/DNS 申请或已有文件，文件模式须填写证书和私钥路径。证书须被客户端信任并匹配 SNI；不提供面板生成自签名或跳过校验。
- 用户名与密码均使用订阅用户 UUID。支持用户热更新、账户撤销、流量计费和现有限速/设备限制；撤销时关闭该账户的 HTTP2 会话，其他账户不受影响。
- 订阅输出为 sing-box `type=naive`（需支持 Naive 的 1.13+ 客户端构建）和通用 `naive+https://` 链接；未适配的专用客户端格式跳过该协议。不能把通用链接支持理解为所有客户端均可用。
- 服务端不需要 libcronet；客户端可能需要。当前实现不包含 Naive 出站和网站回落/应用前置配置。

测试：`php tests/naive.php`、前端 admin-linkage 测试、节点 `GOEXPERIMENT=jsonv2 go test -race -tags with_quic,with_utls ./core -run Naive`。协议测试使用独立 HTTP2/Naive padding 测试客户端，覆盖实际 TLS 连接、流量计数、撤销/重加和并发更新；不替代目标 Chromium 客户端部署验收。

部署顺序：先发布包含 NodeType 支持的 V2Box Release，再升级面板并创建 V2Box 节点，最后使用后台安装命令部署。不要让旧 V2Node 与新 V2Box 同时监听同一端口。

验证：`php tests/v2box.php`（仅本地环境，事务回滚测试数据），前端 `npm test -- src/admin/admin-linkage.test.ts src/shared/critical-config.test.ts`，节点仓库 `go test ./api/v2board ./conf`。

## 节点类型收敛

节点管理现仅保留 V2Node 和 V2Box。旧独立 VMess、VLESS、Shadowsocks、Trojan、Hysteria、TUIC、AnyTLS 节点入口与后台 CRUD、旧节点通信已移除，旧记录不再进入订阅、排序、权限组节点计数及节点排行。底层协议仍可在 V2Node/V2Box 中选择。升级迁移 `2026_10_11_000002_drop_retired_node_tables.php` 删除七张旧节点配置表及其中数据，不自动转换。共享账务、流量历史、权限组和路由表保留。升级前应把仍在使用的旧节点重新配置为 V2Node/V2Box，并更新对应服务。删表无法通过回滚恢复数据，只能从数据库备份恢复。新安装不再创建这些表。

## V10 节点通信与 sing-box 原生配置

升级面板时执行完整 [update.sh 升级流程](update-script.md)（按批准清单定向迁移，勿执行全量 migrate），依次完成原生配置及独立路由迁移；V2Node 表不变。新版 V2Box 配置 `NodeType=v2box` 默认走 V10，`ApiVersion=legacy` 可显式保留旧接口。V10 不接受查询参数 token，使用 Authorization Bearer；用户表为空时返回 `data: []`，304 才代表无变化。

管理端“路由管理”按 V2Node / Xray、V2Box / sing-box 分开维护。V2Box 原生规则在这里编辑 JSON，节点编辑页只选择当前内核可用的规则。开放 dns、route、outbounds，支持 HTTPS DNS、DNS 分流、inline/HTTPS remote 规则集及代理出口。保留直连出口 direct。不能覆盖入站用户、计费、服务、本机证书路径，也不能配置 auth_user 或本机 rule-set 文件。原生配置字段随节点固定的 sing-box 1.14.3 校验，错误配置先预检再重载。

节点通过 POST capabilities 上报 coreVersion 和 features，缓存 24 小时，随配置轮询更新；原生配置下发要求 X-Node-Capabilities 包含 native-routing-v1。节点能力不进入用户订阅。详细接口契约见 [node-api.json](api-v10/node-api.json)。旧节点通信仍调用相同的共享业务动作，流量上报暂未增加批次去重，202 仅表示已接受入队。

ACME 申请失败保护在节点本地实现，不通过面板清除；修复后按节点 README 恢复，重启不会绕过暂停状态。

V10 节点身份通过 `X-Node-Type: v2box` 和 `X-Node-ID: 节点编号` 请求头传递；URL 统一为 `/api/v10/server/...`。当前仅接受 v2box 类型，V2Node 继续使用旧接口。类型或编号缺失、非法时返回 422；未知节点返回 404。旧 `/api/v10/nodes/v2box/{id}/...` 路径已移除，面板与节点应同步升级。


## 独立路由规则升级

`2026_10_11_000004_separate_node_routes.php` 为路由记录增加 `backend` 和 `sing_box`。现有规则归 V2Node；V2Box 引用的旧格式规则自动复制为独立记录并重新关联。节点内已有的原生配置迁移成一条 V2Box 路由记录，清空旧内联配置，并保持原生配置原先覆盖旧规则的行为。迁移不会修改 V2Node 的规则引用。旧 `sing_box` 列暂留兼容数据库升级，但节点保存接口不再接受非空内联配置。

V2Box 可选择多条原生规则：`route.rules`、`dns.rules` 按选择顺序追加；相同定义的出口、DNS 和规则集标签复用，不同定义的同名标签及相互冲突的默认设置拒绝保存。旧格式兼容规则不能与原生规则混选，防止静默忽略旧规则。旧规则仍可独立编辑；转换为原生格式时，应同时检查使用该规则的节点。正在被节点引用的规则不能删除，须先解除选择。

节点通信格式不变：V10 的 `singBox` 返回所选原生规则的合并结果，`routes` 仅用于旧格式兼容规则；V2Node 继续获得自己的 Xray 规则。升级后配置 ETag 随规则内容变化。路由修改会同步影响选择该规则的节点，但不跨内核传播。

部署前备份数据库，执行完整 [update.sh 升级流程](update-script.md)（按批准清单定向迁移，勿执行全量 migrate），并发布新的后台资源。独立规则和引用不支持自动折叠回旧共享结构；需要回退时恢复数据库备份。验证：`php tests/node-routes.php`、`php tests/node-v10.php` 及前端 `Nodes.test.tsx`。


## 已保存节点切换内核

在节点编辑窗口更改“节点类型”，核对目标内核支持的协议和参数，重新选择路由及父节点后保存。保存接口通过 `source_type`、`source_id` 标识来源，不能同时传入目标更新 `id`。后端先执行目标内核校验，再在事务中创建目标节点并删除来源记录；目标 ID 独立分配，不覆盖另一张表中的同号节点。保留展示信息、标签及创建时间（Shadowsocks 2022 密钥派生依据）。历史流量记录保留原类型与 ID。

仍被子节点引用的父节点不能直接转换，须先解除子节点关联。Naive 转 V2Node 时必须另选受支持协议；Xray 专有参数不会自动带入 V2Box。切换表单类型会重新载入已保存配置。转换完成后面板展示新安装命令，需在节点服务器更换对应服务及节点 ID；仅修改面板不会自动替换服务器上的内核。


## AnyTLS 填充预设

AnyTLS 节点编辑可选“上游默认（推荐）”“低开销”“随机长度变体（实验性）”或自定义。默认预设下发空值，使用所选内核默认值；低开销仅处理前 4 个包，减少填充阶段；随机长度变体处理前 8 个包，改变尺寸区间。自定义内容会原样保留。预设只在 AnyTLS 显示，仍通过原有 `padding_scheme` / V10 `paddingScheme` 传递，无数据库迁移。

参数语义依据 [AnyTLS 协议说明](https://github.com/anytls/anytls-go/blob/main/docs/protocol.md)。减少填充会减少额外字节，也减少包长扰动；随机变体不是已验证的抗识别优化，不承诺更强的伪装效果或吞吐收益。真实线路需按延迟、流量开销和稳定性选择。预设源数据为 `resources/client/anytls-padding-presets.json`，已通过 V2Box AnyTLS 连接与业务流量计费测试。

## 公网 IP 查询与 Cloudflare DDNS

节点安装窗口提供公网 IPv4/IPv6 查询命令。查询在节点服务器执行，不会使用面板服务器或浏览器的 IP。后台侧栏“Cloudflare DDNS”统一管理凭据与节点绑定，支持 V2Node 和 V2Box，默认不启用。

1. 执行完整 [update.sh 升级流程](update-script.md)（按批准清单定向迁移，勿执行全量 migrate），确保原有 Laravel scheduler 正常运行。
2. 后台新增凭据：名称、Cloudflare Zone ID、仅限该区域 DNS 编辑权限的 API Token。Token 使用 APP_KEY 加密保存，读取接口不返回原值，编辑留空保留旧值。备份/迁移面板时须保留 APP_KEY；不可随意重生成。
3. 新建节点绑定：节点、凭据、专用域名、IPv4 / IPv6 / 双栈。面板节点地址填写同一域名，不自动修改协议或证书配置。
4. 点击“配置节点上报”，生成只允许该节点上报 IP 的独立密钥。密钥只显示这一次，数据库只保存 SHA-256；重新生成立即撤销旧密钥。
5. 在节点执行窗口中的命令，输入 HTTPS 面板地址和独立上报密钥。节点只保存上报密钥，不获取 Cloudflare Token。

需 Python 3.8+ 和 systemd，或 OpenRC + crontab/crond。独立脚本支持两种节点程序：

```bash
python3 node-network.py ip
python3 node-network.py report-configure --family ipv4
node-network status
node-network disable
```

上报密钥通过隐藏输入读取，不进入 shell 命令历史；无交互场景可用 `--panel-url https://panel.example.com --token-file /root/node-report-key`。配置文件 `/etc/node-network/cloudflare.json` 使用 0600 权限，集中模式没有 Zone ID 和 Cloudflare Token。HTTPS 请求不跟随重定向，避免跨主机转发凭据。

节点每 5 分钟上报；面板调度器每分钟查找待同步记录，正常绑定约每 5 分钟校验 DNS。A、AAAA 分别记录新鲜度，超过 15 分钟不再使用该地址；部分地址查询失败不会更新另一地址的时间或删除已有 DNS。DNS 使用仅解析、TTL 300，只在内容或代理状态变化时写入；遇到多条同名同类型记录暂停，避免破坏多地址配置。

认证失败按凭据暂停所有关联节点；更换 Token 后恢复。配置错误暂停该绑定，修正后保存恢复。429 使用凭据级退避（Retry-After，5 分钟至 24 小时），上报或更换上报密钥不绕过该退避；临时网络失败延后重试，不在一次运行中循环请求。更换地址类型会撤销上报密钥，需重新配置脚本。切换节点内核自动迁移绑定；删除节点后拒绝上报和更新。停用/删除 DDNS 不删除现存 DNS 记录。

DDNS 日志默认保留 30 天，可在系统日志页面调整，由统一日志清理任务每 5 分钟分批处理；仅记录状态变化和 DNS 写入，支持节点筛选及分页；不会保存 Token、请求头或 Cloudflare 原始响应。系统日志不记录成功 IP 心跳，以免每 5 分钟重复落库。

旧版节点直接使用 Cloudflare 的 `configure` / 安装器 `--ddns` 模式保留兼容。推荐使用后台集中模式；执行 `report-configure` 验证成功后会替换原本地配置。若从其他独立 DDNS 程序迁移，应停止旧程序，防止双方争抢解析。首次改解析后等待 DNS 生效再申请 ACME 证书。

发布顺序：先发布面板并迁移数据库，再发布包含新辅助脚本的节点版本（后台下载命令使用仓库 main 分支）。测试使用模拟 Cloudflare API，不会修改真实 DNS。
