import { useState } from "react";
import { AdminChoiceGroup } from "./AdminChoices";

export function NodeSetupGuide() {
    const [mode, setMode] = useState("direct");
    return (
        <details className="pad admin-deployment-tools">
            <summary>新增节点与部署流程</summary>
            <AdminChoiceGroup
                label="部署流程"
                value={mode}
                onChange={setMode}
                options={[
                    { value: "direct", label: "直连节点" },
                    { value: "relay", label: "中转节点" },
                ]}
            />
            <ol>
                <li>
                    在 <a href="#/node-domains">维护根域名</a> 添加并验证
                    Cloudflare 根域名凭据。
                </li>
                {mode === "relay" && (
                    <li>
                        在 <a href="#/servers">服务器管理</a>{" "}
                        添加中转服务器，可同时配置入口域名；已有服务器在“详情 →
                        入口域名”中添加。编辑服务器生成上报命令，在中转服务器执行，等待入口解析正常。
                    </li>
                )}
                <li>
                    点击“新增节点”，选择“新建代理服务”，使用自动管理服务器与域名，接入方式选择
                    {mode === "relay" ? "入口中转" : "直连"}。
                    {mode === "relay"
                        ? "选择入口域名和入口端口，再配置回源根域名、回源服务器与节点监听端口。"
                        : "选择根域名与监听端口。首次部署可自动创建所属服务器，无需另建记录。"}
                </li>
                <li>
                    {mode === "relay"
                        ? "普通 TLS 选择 DNS 申请并填写证书验证凭据，SNI 自动使用入口域名；Reality 保持独立 SNI。"
                        : "普通 TLS 可选择 HTTP 或 DNS 申请；HTTP 验证需开放节点 TCP 80，DNS 申请需单独填写证书验证凭据。"}{" "}
                    Cloudflare 解析管理凭据不自动作为证书申请凭据。
                </li>
                <li>
                    保存后进入“部署与接入 →
                    部署”，生成并复制一键部署命令，在运行代理服务的服务器以 root
                    执行。命令自动配置该服务器的 IP
                    上报，等待解析、证书和节点就绪；中断时按终端提示恢复。
                </li>
                {mode === "relay" && (
                    <li>
                        进入“域名与解析 → 入口转发配置”，复制片段至中转服务器的
                        Nginx stream 配置；执行 nginx -t，通过后重载，并开放所需
                        TCP／UDP
                        端口。此步骤需在入口服务器完成，面板不会自动安装转发。
                    </li>
                )}
                <li>
                    {mode === "relay"
                        ? "通过入口完成客户端连接测试，点击“确认转发测试完成”，再开启节点展示。"
                        : "完成客户端连接测试后开启节点展示。"}{" "}
                    新增多入口共用服务时，仍点击“新增节点”，选择“复用已有服务”；保存、检查转发并发布线路，无需再次安装
                    V2Box。
                </li>
            </ol>
            <p className="muted">
                服务器管理维护机器、IP
                上报与入口域名；节点管理维护入口端口到代理服务的关系，并提供转发配置和验证。证书申请成功与节点就绪不代表入口链路已连通。
            </p>
        </details>
    );
}
