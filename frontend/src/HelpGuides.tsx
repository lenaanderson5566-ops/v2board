import { tx } from "./i18n";
import { Panel } from "./ui";

export function HelpGuides() {
    return (
        <Panel title={tx("常见问题与问题排查")}>
            <div className="pad help-guides">
                {[
                    [
                        "配置导入",
                        "在总览中选择适合当前设备的导入方式。若无法打开客户端，请先安装客户端，再用系统浏览器重试。",
                    ],
                    [
                        "连接问题",
                        "先在总览确认套餐有效期和剩余额度，再更新客户端配置并切换可用节点；仍有问题时记录设备和客户端版本。",
                    ],
                    [
                        "支付问题",
                        "先在订单详情检查支付结果。已付款仍未到账时，可从订单详情联系客服，订单编号会自动带入。",
                    ],
                    [
                        "账号问题",
                        "忘记密码可在登录页重置；其他账户设置可在账户设置中修改。请勿在工单中发送密码或完整订阅链接。",
                    ],
                ].map(([title, text]) => (
                    <details key={title}>
                        <summary>{tx(title)}</summary>
                        <p>{tx(text)}</p>
                    </details>
                ))}
            </div>
        </Panel>
    );
}

export function ContactSupport() {
    return (
        <Panel title={tx("仍需帮助？")}>
            <div className="pad">
                <p className="muted">
                    {tx(
                        "请先查看使用文档和排查建议；问题仍未解决时，再联系客服。已有未关闭的工单请继续回复。",
                    )}
                </p>
                <a className="button" href="#/ticket">
                    {tx("联系客服 / 查看已有工单")}
                </a>
            </div>
        </Panel>
    );
}
