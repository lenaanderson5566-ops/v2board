import type { Row } from "../shared/api";

export function lightsailFailure(row: Row): { title: string; advice: string; operation?: string; provider?: string } {
    const code = String(row.error_code || "");
    const [prefix, operation, provider, category] = code.split(":");
    const phase = row.phase === "allocate" ? "申请新静态 IP" : "IP 操作";
    if (prefix !== "aws") {
        if (code === "aws_request_failed") return { title: `${phase}时 AWS 请求失败，旧记录没有保留具体原因`, advice: "此记录无法区分权限、凭据、配额或限流。更新后台及队列进程后，通过“继续操作”重新执行当前步骤，新的失败会显示具体 AWS 错误。" };
        const known: Record<string, [string, string]> = {
            credential_missing: ["所选 AWS 密钥不存在", "在配置中重新选择有效密钥。"],
            worker_failed: ["后台任务异常退出", "检查 infrastructure 队列进程及超时设置，再继续当前操作。"],
            dns_update_failed: ["新 IP 的 DNS 更新尚未成功", "检查 Cloudflare 凭据和解析状态；旧静态 IP 保留，可继续或恢复。"],
            dns_not_ready: ["DNS 尚未就绪", "检查域名凭据的暂停、限流和等待状态。"],
            operation_pending: ["AWS 操作仍未确认完成", "稍后继续，系统会先核对已有资源，不会重复申请已存在的新 IP。"],
        };
        const entry = known[code];
        return { title: entry?.[0] || `操作未完成：${code}`, advice: entry?.[1] || "检查当前步骤状态后继续；恢复旧 IP 前需确认旧地址仍可用。" };
    }
    const actions: Record<string, string> = { instance: "查询实例", list: "列出静态 IP", get: "查询静态 IP", allocate: "申请新静态 IP", attach: "绑定静态 IP", detach: "解绑静态 IP", release: "释放静态 IP", request: "AWS 请求" };
    const result = (title: string, advice: string) => ({ title, advice, operation: actions[operation] || "AWS 请求", provider });
    if (["Curl51", "Curl60", "Curl77"].includes(provider)) return result("连接 AWS 时证书验证失败", "检查队列服务器的 CA 根证书、PHP cURL 的证书路径及 HTTPS 代理证书，修复证书链后继续；不要关闭 TLS 验证。" );
    if (["Curl5", "Curl6"].includes(provider)) return result("无法解析 AWS 或代理地址", "检查队列服务器的 DNS、HTTPS_PROXY 代理配置和出站网络后继续。" );
    if (["Curl7", "Curl28", "Curl35", "RequestTimeout", "RequestTimeoutException"].includes(provider)) return result("连接 AWS 失败或超时", "检查队列服务器到 AWS 的 HTTPS 网络、代理和 TLS 握手；稍后继续。" );
    if (/^Http[45]\d{2}$/.test(provider)) return result(`AWS 请求返回 HTTP ${provider.slice(4)}，未解析到已识别的 AWS 错误码`, "此状态码不能单独确定权限或配额问题。检查队列服务器使用的出站代理、网关和 AWS 端点；确认响应来自 AWS，并核对该请求的权限。不要把未识别的 404 当作静态 IP 不存在。" );
    if (provider === "UnknownError") return result("AWS 请求失败，但未取得可识别的错误码或 HTTP 状态", "当前信息不足以判断原因。先更新后台并重启队列以记录 HTTP/cURL 诊断；如果仍无诊断，需检查队列服务器的 AWS SDK、HTTPS 网络及代理配置。" );
    if (category === "quota" || ["ServiceQuotaExceededException", "LimitExceededException", "ResourceLimitExceededException"].includes(provider)) return result("静态 IP 配额不足，未能申请新地址", "此流程需要先保留旧 IP，再额外申请一个新静态 IP。核对该 AWS 账号在当前区域的静态 IP 配额及闲置地址；仅清理确认不再使用的地址，或申请提高配额，然后继续。不要释放仍在使用的旧 IP。" );
    if (["AccessDenied", "AccessDeniedException", "UnauthorizedException", "UnauthorizedOperation"].includes(provider)) return result("AWS 权限不足", `检查所选密钥是否允许 lightsail:${({allocate:"AllocateStaticIp",get:"GetStaticIp",list:"GetStaticIps",instance:"GetInstance",attach:"AttachStaticIp",detach:"DetachStaticIp",release:"ReleaseStaticIp"} as Record<string,string>)[operation] || "对应动作"}。申请和列出静态 IP 的权限需使用 Resource: *；实例 ARN 的授权不足以允许申请新 IP。还需检查显式拒绝、权限边界及区域限制。`);
    if (["ExpiredToken", "ExpiredTokenException", "RequestExpired"].includes(provider)) return result("AWS 临时凭据或请求已过期", "在 AWS 密钥管理中同步更新 Access Key、Secret Key 和 Session Token，并检查服务器时间。" );
    if (["UnauthenticatedException", "InvalidClientTokenId", "UnrecognizedClientException", "SignatureDoesNotMatch", "InvalidSignatureException", "MissingAuthenticationTokenException", "IncompleteSignature", "IncompleteSignatureException", "InvalidAccessKeyId", "AuthFailure"].includes(provider)) return result("AWS 凭据或签名校验失败", "检查 Key/Secret 是否配对、密钥是否已停用；临时凭据须填写有效 Session Token，并检查服务器时间。" );
    if (["Throttling", "ThrottlingException", "TooManyRequestsException", "RequestLimitExceeded"].includes(provider)) return result("AWS 请求被限流", "等待限流窗口恢复后继续，避免连续重复换 IP。" );
    if (provider === "NetworkError") return result("无法连接 AWS API", "检查后台队列服务器的 DNS、HTTPS 出站网络和系统时间后继续。" );
    if (provider === "RequestTimeTooSkewed") return result("服务器时间与 AWS 偏差过大", "同步后台队列服务器的系统时间后继续。" );
    if (["AccountSetupInProgressException", "RegionSetupInProgressException"].includes(provider)) return result("AWS 账号或区域尚在初始化", "等待 AWS 完成初始化，核对实例区域后继续。" );
    if (provider === "InvalidInputException") return result("AWS 拒绝了请求参数", "核对区域和实例配置。此错误不一定是权限不足；若怀疑配额，请核对当前区域的静态 IP 使用情况。" );
    return result("AWS 未完成当前请求", "核对区域、实例和 AWS 服务状态后继续；联系 AWS 支持时提供这里的动作和错误码。" );
}
