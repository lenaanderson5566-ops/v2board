# Lightsail 静态 IP 管理

节点管理 → Lightsail IP。配置 AWS 区域、实例名称、关联主节点，并选择共享 AWS 密钥；同一密钥可以绑定多个服务器。密钥管理中编辑时凭据留空保留原值，凭据使用 APP_KEY 加密，列表及操作日志不返回原始凭据。

更换公网地址属于管理员主动操作，需要输入实例名称确认。任务进入独立 infrastructure 队列，按实例加锁。先查询当前静态 IP、申请新静态 IP，确认申请成功后解绑旧地址并绑定新地址；确认新绑定、更新关联的 Cloudflare A 记录后才释放旧静态 IP。AWS 不保证分配到某个特定地址，也不保证释放后能够重新找回旧地址。必须有可用静态 IP 配额。

连接会暂时中断；已有 TCP 会话不会迁移。Cloudflare DNS 传播受 TTL 影响。没有启用 DDNS 的域名需人工更新解析；使用字面 IP 的节点 host 需人工改为新地址，不能把域名或监听地址直接覆盖为公网 IP。仅处理 Lightsail IPv4 静态 IP，不修改 IPv6。

失败不会无限重试。任务持久保存阶段与新旧 IP 名称；“继续操作”先核对 AWS 实际状态，再继续同一操作，不重复申请地址。“恢复旧 IP”仅在旧地址尚未释放时有效。旧地址可能临时处于未绑定状态并产生费用，应及时完成或恢复。队列任务超过六分钟未完成时开放继续入口；操作仍受实例锁保护。

AWS 最小动作权限：lightsail:GetInstance、lightsail:GetStaticIp、lightsail:GetStaticIps、lightsail:AllocateStaticIp、lightsail:DetachStaticIp、lightsail:AttachStaticIp、lightsail:ReleaseStaticIp。凭据必须针对配置的区域和实例；不要使用 AWS 根账户密钥。支持填写临时 session token，过期后需更新。实际权限范围按 AWS IAM 对每项动作支持的资源类型配置。

AllocateStaticIp 和 GetStaticIps 不支持资源级授权，需要单独授予 Resource: "*"；仅授权实例 ARN 不足以申请新静态 IP。参考 [AWS Lightsail IAM 动作表](https://docs.aws.amazon.com/service-authorization/latest/reference/list_lightsail.html)。换 IP 要在保留旧地址的同时额外申请一个地址，必须有剩余区域配额；不要为腾配额自动释放正在使用的旧地址。

失败卡片显示具体 AWS 动作和经过白名单过滤的错误码，并区分权限、凭据过期、配额、限流、网络及时间偏差。数据库仅保存短错误码，不保存可能带签名或凭据的 AWS 原始异常文本。allocate 阶段包含查询候选静态 IP 和申请新静态 IP，两种失败分别显示。历史 aws_request_failed 记录无法追溯已丢失的错误原因；部署更新并重启 infrastructure 队列后，管理员通过“继续操作”重新核对当前资源，新的失败会保存具体原因。此操作会继续原换 IP 流程，成功时也会继续绑定新地址。

部署须运行 update.sh：安装 AWS PHP SDK，执行 2026_10_11_000010_create_lightsail_servers.php，更新 Horizon 配置并重启队列。独立连接 redis-infrastructure 的 retry_after=360，大于任务 timeout=180；生产须运行 Horizon。

Laravel 13 的 Queue、Connection、Tries、Timeout 属性统一声明新任务行为；afterCommit 防止事务尚未提交时任务读取旧数据。Cache::lock 保护同一实例，DB 行锁保护重复提交；这些并发设施并非都在 Laravel 13 首次引入。保留现有账务和节点接口，不为了使用新语法重写业务。

参考：https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_AttachStaticIp.html 、https://laravel.com/docs/13.x/queues

管理员接口沿用现有认证前缀：GET server/lightsail/fetch、GET server/lightsail/inspect?id=ID、POST server/lightsail/save、POST server/lightsail/operate、POST server/lightsail/drop。查询接口只返回实例公网 IP 和是否为静态 IP，不写配置、不执行换 IP。移除管理配置不删除 AWS 资源；正在执行或未恢复的失败操作不能移除配置。操作阶段 idle / allocate / attach / publish / release / complete 持久保存在数据库。

后台优化：侧栏按功能名、分组及英文标识搜索；Lightsail 使用卡片、状态标签、独立确认窗口和有内边距的表单，队列处理中每五秒刷新状态。失败时保留实例关联，仅允许修复凭据；关联的节点转换类型会迁移云配置，未完成操作期间阻止转换和删除。

尚未进入资源变更阶段（idle）的失败配置可以移除；进入分配或绑定阶段后需先完成或恢复，防止遗留计费资源。节点列表另支持名称、域名、当前 IP 搜索、后端类型筛选及仅查看额度受限节点。

若 AWS 错误码缺失或未识别，诊断保留 HTTP 状态（Http403/Http404/Http502 等）或白名单中的 cURL errno（DNS、连接、超时、TLS、CA 证书错误），不保存响应正文、请求地址或异常原文。HTTP 状态不能单独证明权限、配额或资源是否存在；未知 404 仍按失败处理，不进入申请。

GetStaticIp 返回 HTTP 400 且 SDK 未解析出错误码时，使用 GetStaticIps 分页按完整名称核验：找到则复用资源，所有页查询成功且均未找到才判定不存在。这也用于释放后的消失确认。列表查询失败、缺少列表或分页标记循环均停止操作；已识别的权限等错误不会触发此回退。这样不依赖“资源不存在”异常的解析，也不会将未知 400 直接当作不存在。部署后台代码并重启 infrastructure 队列后，对原失败记录选择“继续操作”，保留原新旧 IP 名称进行核验。
