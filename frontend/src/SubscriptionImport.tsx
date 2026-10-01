import { useState } from "react";
import { ArrowUpRight, Copy, Check, QrCode, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Modal } from "./ui";
import { boot } from "./api";
import { tx } from "./i18n";
import {
    clients,
    importLink,
    subscriptionUrl,
    type ClientId,
} from "./import-links";

export function SubscriptionImport({ url }: { url: string }) {
    const [open, setOpen] = useState(false),
        [selected, setSelected] = useState<ClientId>("clash");
    const [copied, setCopied] = useState(false),
        [attempted, setAttempted] = useState(false),
        [error, setError] = useState("");
    let link = "",
        raw = "";
    try {
        raw = subscriptionUrl(url);
        link = importLink(selected, url, boot.title);
    } catch {
        return null;
    }
    return (
        <>
            <button className="primary" onClick={() => setOpen(true)}>
                <Smartphone size={17} />
                {tx("一键导入")}
            </button>
            {open && (
                <Modal
                    title={tx("连接你的客户端")}
                    close={() => setOpen(false)}
                >
                    <div className="pad import-content">
                        <p className="muted">
                            {tx("选择已安装的客户端，直接导入订阅。")}
                        </p>
                        <div className="client-grid">
                            {clients.map((client) => (
                                <button
                                    key={client.id}
                                    className={
                                        selected === client.id
                                            ? "client-card selected"
                                            : "client-card"
                                    }
                                    aria-pressed={selected === client.id}
                                    onClick={() => {
                                        setSelected(client.id);
                                        setAttempted(false);
                                    }}
                                >
                                    <span className="client-symbol">
                                        <Smartphone size={19} />
                                    </span>
                                    <span>
                                        <strong>{client.name}</strong>
                                        <small>{client.platform}</small>
                                    </span>
                                    {selected === client.id && (
                                        <Check size={17} />
                                    )}
                                </button>
                            ))}
                        </div>
                        <a
                            className="button primary import-open"
                            href={link}
                            onClick={() => setAttempted(true)}
                        >
                            {tx("在 {{client}} 中打开", {
                                client: clients.find((c) => c.id === selected)
                                    ?.name,
                            })}
                            <ArrowUpRight size={17} />
                        </a>
                        {attempted && (
                            <p role="status" className="import-help">
                                {tx(
                                    "如果客户端没有打开，请先安装客户端，或复制订阅链接手动添加。",
                                )}
                            </p>
                        )}
                        <div className="import-fallback">
                            <div>
                                <h3>
                                    <QrCode size={17} />
                                    {tx("扫码或手动添加")}
                                </h3>
                                <p className="muted">
                                    {tx(
                                        "在另一台设备上扫描，或复制链接到客户端。",
                                    )}
                                </p>
                                <button
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(
                                                raw,
                                            );
                                            setCopied(true);
                                            setError("");
                                        } catch {
                                            setError(
                                                tx("复制失败，请手动复制链接"),
                                            );
                                        }
                                    }}
                                >
                                    {copied ? (
                                        <Check size={16} />
                                    ) : (
                                        <Copy size={16} />
                                    )}{" "}
                                    {tx(copied ? "已复制" : "复制订阅链接")}
                                </button>
                            </div>
                            <QRCodeSVG
                                value={raw}
                                size={116}
                                marginSize={3}
                                title={tx("订阅二维码")}
                            />
                        </div>
                        <input
                            className="subscription-input"
                            readOnly
                            value={raw}
                            dir="ltr"
                            aria-label={tx("订阅链接")}
                            onFocus={(e) => e.target.select()}
                        />
                        {error && <p role="alert">{error}</p>}
                        <small className="muted">
                            {tx("订阅链接和二维码包含访问凭据，请勿分享。")}
                        </small>
                    </div>
                </Modal>
            )}
        </>
    );
}
