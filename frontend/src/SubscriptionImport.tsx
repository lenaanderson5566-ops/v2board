import { iosDownloads, ClientDownload } from "./ClientDownload";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./import-copy";
import "./client-choice-copy";
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
import { tx, locale } from "./i18n";
import { currentDevice, type Device } from "./user-experience";
import {
    localizedSubscriptionUrl,
    clients,
    importLink,
    clientSubscriptionUrl,
    recommendedClients,
    supportedClients,
    type ClientId,
} from "./import-links";
export function SubscriptionImport({
    url,
    inline = false,
}: {
    url: string;
    inline?: boolean;
}) {
    const { t } = useTranslation("clientImport");
    const { t: choice } = useTranslation("clientChoice");
    const enabled = (id: ClientId) => boot.clientPolicies?.[id]?.enabled !== false;
    const [downloadOpen, setDownloadOpen] = useState(false);
    const [device, setDevice] = useState<Device>(() => currentDevice().device);
    const recommended = recommendedClients(device);
    const [open, setOpen] = useState(false),
        [all, setAll] = useState(false);
    const [selected, setSelected] = useState<ClientId>(() => {
        let saved: string | null = null;
        try {
            saved = localStorage.getItem("v2board.import-client");
        } catch {}
        return (
            recommended.find((client) => client.id === saved && enabled(client.id))?.id ||
            recommended.find(client => enabled(client.id))?.id || supportedClients(device).find(client => enabled(client.id))?.id || recommended[0].id
        );
    });
    const [copied, setCopied] = useState(false),
        [attempted, setAttempted] = useState(false),
        [error, setError] = useState("");
    let link = "",
        raw = "";
    try {
        const localized = localizedSubscriptionUrl(url, locale());
        raw = clientSubscriptionUrl(selected, localized);
        link = importLink(selected, localized, boot.title);
    } catch {
        return <p className="pad" role="alert">{t("invalid")}</p>;
    }
    const extra = supportedClients(device).filter(client => !recommended.some(item => item.id === client.id));
    const visible = all ? [...recommended, ...extra] : recommended.some(client => client.id === selected) ? recommended : [...recommended, ...extra.filter(client => client.id === selected)];
    const policy = boot.clientPolicies?.[selected];
    async function copy() {
        try {
            await navigator.clipboard.writeText(raw);
            setCopied(true);
            setError("");
        } catch {
            setError(tx("复制失败，请使用一键导入或扫码。"));
        }
    }
    const downloads: Partial<Record<ClientId, string>> = {
        flclash: "https://github.com/chen08209/FlClash/releases",
        clash: "https://github.com/clash-verge-rev/clash-verge-rev/releases",
        hiddify: "https://github.com/hiddify/hiddify-app/releases",
        singbox: "https://sing-box.sagernet.org/clients/",
    };
    const downloadUrl = selected === "singbox"
        ? `https://sing-box.sagernet.org/clients/${device === "windows" || device === "linux" ? "desktop/" : device === "ios" || device === "macos" ? "apple/" : device === "android" ? "android/" : ""}`
        : device === "ios" ? iosDownloads[selected] : downloads[selected];
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
                                setSelected(recommendedClients(value).find(client => enabled(client.id))?.id || supportedClients(value).find(client => enabled(client.id))?.id || recommendedClients(value)[0].id);
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
                {extra.length > 0 && <button className="import-more" aria-expanded={all} onClick={() => setAll(value => !value)}>{choice(all ? "less" : "more")}</button>}
                <div className="client-grid">
                    {visible.map((client) => (
                        <button
                            key={client.id}
                            className={
                                selected === client.id
                                    ? "client-card selected"
                                    : "client-card"
                            }
                            disabled={!enabled(client.id)}
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
                                <small>{enabled(client.id) ? client.platform : choice("disabled")}</small>
                            </span>
                            {selected === client.id && <Check size={17} />}
                        </button>
                    ))}
                </div>
                {!enabled(selected) && <p role="status">{choice("disabled")}</p>}
                {policy?.minVersion && <p className="muted">{choice("version", { version: policy.minVersion })}</p>}
                {enabled(selected) && <div className="quick-actions">
                    {downloadUrl && (
                        <button
                            className="button import-download"
                            onClick={() => setDownloadOpen(true)}
                        >
                            {tx("获取客户端")}
                            <ArrowUpRight size={16} />
                        </button>
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
                }
                {error && <p role="alert">{error}</p>}
                {copied && <p role="status" className="import-help">{t("copied")}</p>}
                {attempted && (
                    <p role="status" className="import-help">
                        {t("opened")}
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
            {enabled(selected) && <details className="import-manual">
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
                <small className="muted">
                    {tx("订阅链接和二维码包含访问凭据，请勿分享。")}
                </small>
            </details>}
        </div>
    );
    const downloadDialog = downloadOpen && <ClientDownload client={selected} device={device} official={downloadUrl!} close={() => setDownloadOpen(false)} />;
    if (inline) return <>{content}{downloadDialog}</>;
    return (
        <>
            <button className="primary" onClick={() => setOpen(true)}>
                <Smartphone size={17} />
                {tx("一键导入")}
            </button>
            {downloadDialog}
            {open && !downloadOpen && (
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
