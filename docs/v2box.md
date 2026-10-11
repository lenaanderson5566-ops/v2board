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

升级面板后先运行 `php artisan migrate --force`，新增可空 `v2_server_v2box.sing_box` 字段；V2Node 表不变。新版 V2Box 配置 `NodeType=v2box` 默认走 V10，`ApiVersion=legacy` 可显式保留旧接口。V10 不接受查询参数 token，使用 Authorization Bearer；用户表为空时返回 `data: []`，304 才代表无变化。

管理端 V2Box 编辑页新增“sing-box 路由与 DNS”JSON 字段。开放 dns、route、outbounds，支持 HTTPS DNS、DNS 分流、inline/HTTPS remote 规则集及代理出口；非空配置替代旧 route_id 路由。保留直连出口 direct。不能覆盖入站用户、计费、服务、本机证书路径，也不能配置 auth_user 或本机 rule-set 文件。原生配置字段随节点固定的 sing-box 1.14.3 校验，错误配置先预检再重载。

节点通过 POST capabilities 上报 coreVersion 和 features，缓存 24 小时，随配置轮询更新；原生配置下发要求 X-Node-Capabilities 包含 native-routing-v1。节点能力不进入用户订阅。详细接口契约见 [node-api.json](api-v10/node-api.json)。旧节点通信仍调用相同的共享业务动作，流量上报暂未增加批次去重，202 仅表示已接受入队。

ACME 申请失败保护在节点本地实现，不通过面板清除；修复后按节点 README 恢复，重启不会绕过暂停状态。

V10 节点身份通过 `X-Node-Type: v2box` 和 `X-Node-ID: 节点编号` 请求头传递；URL 统一为 `/api/v10/server/...`。当前仅接受 v2box 类型，V2Node 继续使用旧接口。类型或编号缺失、非法时返回 422；未知节点返回 404。旧 `/api/v10/nodes/v2box/{id}/...` 路径已移除，面板与节点应同步升级。
