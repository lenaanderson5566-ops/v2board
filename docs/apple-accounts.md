# iOS 下载账号

使用 AppleAuto User API，后台可配置 HTTPS 接口域名，默认 `https://account.fastdog66.com`。禁止重定向和代理，拒绝内网/保留 IP，并锁定通过校验的 DNS 地址。当前连接使用 IPv4。

部署后进入 **系统配置 → 客户端下载**：

1. 填写 HTTPS 接口域名（不含 /share、/client 等路径），再填写 AppleAuto 用户 API Key（不使用管理员 API Key）。密钥留空保留旧值，不通过配置读取接口回显。
2. 填写分享链接末尾的分享代码（不是完整 URL，也不是数字 ID）。后端自动从 getAllSharepages 匹配数字 ID，再调用 getShareAccounts。
3. 保存并点击“测试下载账号连接”。测试只返回可用数量，不返回密码。
4. 测试成功后启用 iOS 下载账号，刷新用户页面。

密钥保存在服务器 config/v2board.php，与现有私密配置相同；不要提交此文件，限制文件权限。停用功能使用启用开关；更换密钥填写新值后保存。

用户在配置中心选择 iOS，点击“获取下载账号”。每次读取重新检查未封禁且有有效订阅或剩余额度；账号仅限所选分享页，且 status=1、last_check_success=true。弹窗关闭即卸载，响应 private/no-store，不保存到浏览器存储。仅用于 App Store，不用于 iCloud。

无数据库迁移，无队列依赖。网络连接超时 3 秒、单次请求超时 8 秒，不自动重试；失败可以手动重试，不影响其他配置操作。不向用户透传上游错误或密钥。

HTTP 403 表示上游拒绝请求，须检查上游访问日志、密钥归属、账号状态以及服务器 IP 访问策略；不要关闭整站防护。HTTP 200 也须检查 ret=1。没有匹配分享页或分享页过期不会回退到全部账号。

验证：`php tests/apple-accounts.php`（仅本地，HTTP 全部模拟），`npm --prefix frontend run build`。
