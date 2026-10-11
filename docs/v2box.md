# V2Box 节点接入

后台节点管理新增 `v2box`，与 `v2node` 并列。两类节点使用独立表、ID、状态缓存和流量统计类型；同一数字 ID 不会指向同一条节点。支持新增、编辑、复制、删除、排序、父节点、地域显示和一键安装命令。

升级面板时，`update.sh` 定向执行 `2026_10_11_000001_create_v2box_nodes.php`。此迁移只复制 V2Node 表结构，不迁移节点或流量历史。全新安装也会创建该表。

节点侧需要使用包含 `NodeType` 支持的新版 V2Box。Nodes 中配置 `"NodeType": "v2box"`，并填入后台 V2Box 节点的 `NodeID`。一键安装命令传入 `--node-type v2box`。安装器保留已有配置；已有机器需要手动核对 NodeType 和 NodeID。未填写 NodeType 的旧配置继续使用 v2node。

通信沿用 `/api/v2/server/config` 与 `/api/v1/server/UniProxy/{user,alivelist,push,alive}`，参数为 `node_type=v2box`。管理接口沿用管理员前缀下的 `server/v2box/{save,update,copy,drop}`。用户订阅仍走 V10，按底层协议生成；原生节点稳定标识使用 `node_v2box_ID`。

V2Box 支持 Shadowsocks、VMess、VLESS、Trojan、TUIC、Hysteria2、AnyTLS。表单提供 TCP、WebSocket、gRPC、HTTPUpgrade；VLESS 支持 Reality。当前实现不接受 XHTTP、HTTP 传输、Xray VLESS 加密、可信 X-Forwarded-For、Proxy Protocol、ECH 等不兼容配置。高级传输参数也由后端检查。

部署顺序：先发布包含 NodeType 支持的 V2Box Release，再升级面板并创建 V2Box 节点，最后使用后台安装命令部署。不要让旧 V2Node 与新 V2Box 同时监听同一端口。

验证：`php tests/v2box.php`（仅本地环境，事务回滚测试数据），前端 `npm test -- src/admin/admin-linkage.test.ts src/shared/critical-config.test.ts`，节点仓库 `go test ./api/v2board ./conf`。

## 节点类型收敛

节点管理现仅保留 V2Node 和 V2Box。旧独立 VMess、VLESS、Shadowsocks、Trojan、Hysteria、TUIC、AnyTLS 节点入口与后台 CRUD、旧节点通信已移除，旧记录不再进入订阅、排序、权限组节点计数及节点排行。底层协议仍可在 V2Node/V2Box 中选择。升级迁移 `2026_10_11_000002_drop_retired_node_tables.php` 删除七张旧节点配置表及其中数据，不自动转换。共享账务、流量历史、权限组和路由表保留。升级前应把仍在使用的旧节点重新配置为 V2Node/V2Box，并更新对应服务。删表无法通过回滚恢复数据，只能从数据库备份恢复。新安装不再创建这些表。
