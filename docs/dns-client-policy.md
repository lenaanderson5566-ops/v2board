# 客户端 DNS 策略与验证

## 默认订阅

`resources/rules/default.clash.yaml` 与 `default.fastai.yaml` 使用 fake-ip、按规则解析与 DoH。海外域名通过订阅的代理组解析，国内域名和节点域名使用直连 DoH；节点解析独立，避免代理启动循环。本地域名保留系统解析，兼容局域网设备。

`default-nameserver` 的普通 DNS 仅承担 DNS 服务域名的启动解析，并非普通业务域名的解析路径。它仍可能受到污染或阻断，因此该配置不能保证任何网络下都可启动。不要直接删除启动解析器，也不要把普通 DNS 或 `system://` 加到业务 `nameserver` 作为备用。

若部署了 `custom.clash.yaml` 或 `custom.fastai.yaml`，对应默认模板不会生效。更新后应核对实际返回的配置，而不是只检查仓库默认文件。

## FastAI 专用客户端

最终配置合成时禁止用户 DNS 覆盖与系统 DNS 追加，防止迁移的旧设置覆盖服务端策略。DNS 监听限制为 `127.0.0.1:1053`，DNS IPv6 关闭；安全模式不启动 DNS 监听。缺少 DNS 的旧配置仍保留核心基础兼容回退，发布时必须确保专用接口返回完整、启用的 DNS 策略，不能把兼容回退作为推荐配置。

客户端修改需要重新构建、分发 App；仅更新网站不会更新已安装 App 的合成逻辑。

## Clash Verge Rev

更新订阅，检查最终生效的 DNS，而非仅查看订阅原文。客户端的 DNS 覆盖、全局合并与脚本可能覆盖订阅策略。需要订阅策略时关闭冲突的本地覆盖；不要自动删除用户的自定义配置。

需要接管系统 DNS 的桌面场景使用 TUN，并检查自动路由和 DNS 劫持（`any:53`）已生效。系统代理主要服务遵循代理设置的应用，不保证接管全部系统 DNS。浏览器自定义安全 DNS、IPv6、排除的应用与路由可能采用独立路径，需要按实际设备验证。

参考：[Mihomo DNS](https://wiki.metacubex.one/config/dns/)、[Mihomo TUN](https://wiki.metacubex.one/config/inbound/tun/)、[Clash Verge 连接模式](https://www.clashverge.dev/guide/term.html)。

## 发布验证

1. 确认专用接口和公开订阅的最终 DNS 策略、代理组引用与节点域名解析器。
2. 分别测试系统代理、桌面 TUN、Android VPN；验证海外域名、国内域名、局域网设备和节点域名解析。
3. 在可控设备上抓包，区分启动 DNS 与业务 DNS，检查连接后业务查询的 UDP/TCP 53、IPv6 和浏览器独立 DoH 路径。
4. 测试断线重连、切换 Wi-Fi、代理不可达和 DNS 服务不可达。不要通过追加明文业务 DNS 掩盖故障。

配置回归测试只证明配置合成行为，不能替代真实网络抓包或证明零泄漏。验证日志不得记录订阅令牌、完整 YAML、节点密码或用户查询历史。
