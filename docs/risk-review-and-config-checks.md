# 风控复核与配置检查
规则仍是观察记录，不自动封禁。规则卡片展示当前阈值说明；命中日志展示最新原始记录的数值证据。人工复核支持待处理、已确认、误报、已忽略及备注，写入命中 payload 的 review 与 review_history，保留管理员 ID、时间及历史。复核只影响选中原始记录，不批量修改整组、不豁免后续请求。无需数据库迁移。

版本识别只解析明确命名的 UA，不再把格式 flag 或系统版本当作客户端版本。sing 识别 sing-box，meta 识别 Mihomo / Clash.Meta；flclash 与 verge 识别对应应用。无法识别时返回未知；已设置最低版本的策略仍会拒绝未知版本，因此上线前需检查实际客户端 UA 与最低版本设置。UA 可伪造，不是设备身份认证。

部署配置前运行：
```
php artisan clients:check-configs --sing-box=/usr/local/bin/sing-box --mihomo=/usr/local/bin/mihomo
```
用现有模板生成示例配置，分别执行内核校验。不修改线上模板，不启动代理。退出码 0 为通过、1 为失败、2 为未提供内核仅完成结构检查。生成样本使用虚拟节点，不读取用户凭据。需要由运维提供已验证的内核程序；本命令不自动下载安装。只验证当前模板和样例节点，并非所有协议和平台的完整兼容认证。校验失败时应停止发布并保留线上文件。
参考：https://sing-box.sagernet.org/configuration/ 、https://wiki.metacubex.one/
