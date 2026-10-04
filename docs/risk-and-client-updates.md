# 风控与客户端维护

## 后台入口

- **风控概览**：替代运营概览，显示近 24 小时 / 7 天 / 30 天的规则命中、高风险事件、涉及用户、趋势、规则排行和最近 20 条事件。交易、收入和流量统计仍在原有页面。旧 `#/operations` 链接继续有效。
- **风控规则**：按登录 / 订阅筛选，使用带单位的阈值表单；「填入建议阈值」仅填入原始默认值，需要保存才生效。
- **风控设置**：连接日志采样间隔与保留天数。两项保存使用事务；输入非法或缺失时返回校验错误，不会回写默认值。

规则负责检测和记录，不因标记为高风险就自动封禁。先观察命中记录，再使用 IP / UA 黑名单和客户端策略处理确认的异常。不要仅凭多 IP 登录自动封禁移动网络用户。

命中次数不是独立请求数：一个请求可触发多条规则，现有日志还有 60 秒命中去重。趋势按固定时间桶统计，首尾时间桶可能不足一个完整周期。未识别账号的事件不计入「涉及用户」。

## 客户端更新

后台「客户端更新」监控 Clash Verge Rev、FlClash、Hiddify、v2rayN、v2rayNG、Mihomo、sing-box 的官方 GitHub 稳定版。

- 每 6 小时的第 17 分钟由 Laravel scheduler 检查；也可以检查全部或单个项目。
- 每项目 8 秒请求超时、5 分钟缓存、并发锁与 ETag 条件请求；失败保留最后成功版本，超过 24 小时标记数据过期。
- 手动检查逐项进行，一项失败继续后续项目；可以停止。定时检查在后台运行，不阻塞同轮其他计划任务，也不占用邮件队列。
- 展示版本、发布日期、检查成功时间、上个版本和更新说明。上游 Markdown 以纯文本展示，避免执行第三方 HTML。
- 只访问代码内固定仓库，不接受任意查询地址，不需要 GitHub 密钥；受限时显示错误，下轮继续。
- 数据保存在应用缓存，清空缓存后需要重新检查。最新版不代表已经通过本站节点和模板的兼容性验证，不自动修改客户端下载链接或最低版本限制。

部署无需新增数据库迁移。确保宝塔中现有 `schedule:run` 每分钟执行；可手动验证：

```sh
/www/server/php/81/bin/php artisan clients:check-releases
```

## 导入模板

- Clash / Stash 默认关闭局域网开放，绑定本机；需要共享代理的用户可在客户端显式开启。
- Clash / Stash 保留手动选择，局域网域名不使用 fake IP；Clash / Stash / Surge / Surfboard 默认测速改为 HTTPS、10 分钟。
- sing-box 默认远端 DNS 经节点选择出站，节点地址仍由本地解析器解析，避免引导循环；TUN MTU 调整为 1500。默认模板使用 sing-box 1.12+ 的 DNS 格式，请检查客户端内置内核版本。
- 通用节点命名处理控制字符、逗号和重复名字。Clash 系列 / Stash 共用组装逻辑，避免同名节点冲突、空筛选导致悬空分组。没有节点的分组使用 REJECT，而不是意外直连。
- 品牌名称在 YAML 序列化之前替换，避免特殊字符破坏语法。sing-box JSON 模板解析失败时明确报错。
- `custom.clash.yaml`、`custom.stash.yaml`、`custom.sing-box.json` 等自定义模板仍优先；默认模板的 DNS / 局域网 / 测速变更不会覆盖已有自定义文件。节点引用修复在输出阶段生效。

依据：[GitHub Releases API](https://docs.github.com/en/rest/releases/releases)、[Mihomo 全局配置](https://wiki.metacubex.one/config/general/)、[sing-box DNS](https://sing-box.sagernet.org/configuration/dns/server/udp/)。

## 验证

本地运行 `php tests/client-config-release.php`、`php tests/client-import-language.php`、`php tests/risk-summary.php`，前端运行 `npm --prefix frontend test -- src/AdminClientReleases.test.tsx` 与构建。配置解析/引用检查不等于全部真实客户端和所有节点协议连接测试，上线后先用代表性节点导入验证。
