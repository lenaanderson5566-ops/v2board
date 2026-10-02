import { useState } from "react";
import {
    ArrowUpRight,
    Copy,
    Check,
    QrCode,
    Smartphone,
    BookOpen,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Modal } from "./ui";
import { boot } from "./api";
import { tx } from "./i18n";
import { e } from "./experience-copy";
import { currentDevice } from "./user-experience";
import {
    clients,
    importLink,
    clientSubscriptionUrl,
    recommendedClients,
    type ClientId,
} from "./import-links";
export function SubscriptionImport({ url }: { url: string }) {
    const { device } = currentDevice();
    const recommended = recommendedClients(device);
    const [open, setOpen] = useState(false),
        [all, setAll] = useState(device === "unknown");
    const [selected, setSelected] = useState<ClientId>(() => {
        let saved: string | null = null;
        try {
            saved = localStorage.getItem("v2board.import-client");
        } catch {}
        return (
            recommended.find((client) => client.id === saved)?.id ||
            recommended[0].id
        );
    });
    const [copied, setCopied] = useState(false),
        [attempted, setAttempted] = useState(false),
        [error, setError] = useState("");
    let link = "",
        raw = "";
    try {
        raw = clientSubscriptionUrl(selected, url);
        link = importLink(selected, url, boot.title);
    } catch {
        return null;
    }
    const visible = all ? clients : recommended;
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
                        <div className="import-tabs">
                            <button
                                aria-pressed={!all}
                                onClick={() => {
                                    setAll(false);
                                    if (
                                        !recommended.some(
                                            (client) => client.id === selected,
                                        )
                                    ) {
                                        setSelected(recommended[0].id);
                                        setCopied(false);
                                        setAttempted(false);
                                    }
                                }}
                            >
                                {e("recommended")}
                            </button>
                            <button
                                aria-pressed={all}
                                onClick={() => setAll(true)}
                            >
                                {e("allClients")}
                            </button>
                        </div>
                        <small className="muted">{e("deviceHint")}</small>
                        <div className="client-grid">
                            {visible.map((client) => (
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
                                        setCopied(false);
                                        setError("");
                                        try {
                                            localStorage.setItem(
                                                "v2board.import-client",
                                                client.id,
                                            );
                                        } catch {}
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
                                client: clients.find(
                                    (client) => client.id === selected,
                                )?.name,
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
                        <a
                            className="import-guide"
                            href="#/knowledge"
                            onClick={() => setOpen(false)}
                        >
                            <BookOpen size={16} />
                            {tx("使用文档")}
                        </a>
                        <details className="import-manual">
                            <summary>
                                <QrCode size={17} />
                                {tx("扫码或手动添加")}
                            </summary>
                            <div className="import-fallback">
                                <div>
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
                                                    tx(
                                                        "复制失败，请手动复制链接",
                                                    ),
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
                                onFocus={(event) => event.target.select()}
                            />
                            {error && <p role="alert">{error}</p>}
                            <small className="muted">
                                {tx("订阅链接和二维码包含访问凭据，请勿分享。")}
                            </small>
                        </details>
                    </div>
                </Modal>
            )}
        </>
    );
}
