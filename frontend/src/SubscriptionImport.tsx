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
import { currentDevice, type Device } from "./user-experience";
import {
    clients,
    importLink,
    clientSubscriptionUrl,
    recommendedClients,
    type ClientId,
} from "./import-links";
export function SubscriptionImport({
    url,
    inline = false,
}: {
    url: string;
    inline?: boolean;
}) {
    const [device, setDevice] = useState<Device>(() => currentDevice().device);
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
    async function copy() {
        try {
            await navigator.clipboard.writeText(raw);
            setCopied(true);
            setError("");
        } catch {
            setError(tx("复制失败，请手动复制链接"));
        }
    }
    const downloads: Partial<Record<ClientId, string>> = {
        clash: "https://github.com/clash-verge-rev/clash-verge-rev/releases",
        hiddify: "https://github.com/hiddify/hiddify-app/releases",
        singbox: "https://sing-box.sagernet.org/clients/",
    };
    const content = (
        <div className="pad import-content">
            <section className="quick-step">
                <h3>
                    <span>1</span>
                    {tx("选择系统")}
                </h3>
                <p className="muted">
                    {tx("已根据当前设备推荐，可手动选择其他系统。")}
                </p>
                <div
                    className="device-options"
                    role="group"
                    aria-label={tx("选择系统")}
                >
                    {(
                        [
                            "windows",
                            "macos",
                            "android",
                            "ios",
                            "linux",
                        ] as Device[]
                    ).map((value) => (
                        <button
                            key={value}
                            aria-pressed={device === value}
                            onClick={() => {
                                setDevice(value);
                                setAll(false);
                                setSelected(recommendedClients(value)[0].id);
                                setCopied(false);
                                setAttempted(false);
                                setError("");
                            }}
                        >
                            {
                                {
                                    windows: "Windows",
                                    macos: "macOS",
                                    android: "Android",
                                    ios: "iOS",
                                    linux: "Linux",
                                    unknown: "",
                                }[value]
                            }
                            {device === value && <Check size={16} />}
                        </button>
                    ))}
                </div>
            </section>
            <section className="quick-step">
                <h3>
                    <span>2</span>
                    {tx("安装并导入")}
                </h3>
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
                    <button aria-pressed={all} onClick={() => setAll(true)}>
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
                            {selected === client.id && <Check size={17} />}
                        </button>
                    ))}
                </div>
                <div className="quick-actions">
                    {downloads[selected] && (
                        <a
                            className="button import-download"
                            href={downloads[selected]}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {tx("获取客户端")}
                            <ArrowUpRight size={16} />
                        </a>
                    )}
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
                    <button onClick={copy}>
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {tx(copied ? "已复制" : "复制订阅链接")}
                    </button>
                </div>
                {error && <p role="alert">{error}</p>}
                {attempted && (
                    <p role="status" className="import-help">
                        {tx(
                            "如果客户端没有打开，请先安装客户端，或复制订阅链接手动添加。",
                        )}
                    </p>
                )}
            </section>
            <section className="quick-step">
                <h3>
                    <span>3</span>
                    {tx("开始使用")}
                </h3>
                <p className="muted">
                    {tx("打开客户端，更新配置，选择可用线路并启用连接。")}
                </p>
                <a
                    className="import-guide"
                    href="#/knowledge"
                    onClick={() => setOpen(false)}
                >
                    <BookOpen size={16} />
                    {tx("使用文档")}
                </a>
            </section>
            <details className="import-manual">
                <summary>
                    <QrCode size={17} />
                    {tx("扫码或手动添加")}
                </summary>
                <div className="import-fallback">
                    <div>
                        <p className="muted">
                            {tx("在另一台设备上扫描，或复制链接到客户端。")}
                        </p>
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
                <small className="muted">
                    {tx("订阅链接和二维码包含访问凭据，请勿分享。")}
                </small>
            </details>
        </div>
    );
    if (inline) return content;
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
                    {content}
                </Modal>
            )}
        </>
    );
}
