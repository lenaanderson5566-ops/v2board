import { date, type Row } from "../shared/api";

export function NodeDnsObservation({observation}:{observation?:Row | null}) {
    return <>{observation && observation.state !== "verified" && <div role="status" className="node-domain-progress">
                            <strong>节点端 DNS 检查 · {({origin:"回源域名",entry:"入口域名",certificate:"证书域名"} as Record<string,string>)[observation.role]}</strong>
                            <p>{({checking:"正在查询公网解析。",mismatch:"解析与预期 IP 不一致。请核对 A/AAAA、遗留记录与 DNS only 设置，再恢复部署。",unavailable:"公共 DNS 查询服务均不可用。请检查节点的出站 HTTPS 与本机 DNS，再恢复部署；无需重装或更换证书凭据。"} as Record<string,string>)[observation.state]}</p>
                            <small>节点上报：{date(observation.checkedAt)} · 此结果不代表证书或部署已完成。</small>
                        </div>}</>;
}
