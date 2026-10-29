import { iosDownloads, ClientDownload } from "./ClientDownload";
import { trackAction } from "./product-analytics";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    ArrowUpRight,
    ArrowRightLeft,
    ChevronRight,
    Copy,
    Check,
    QrCode,
    Smartphone,
    BookOpen,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Modal } from "../shared/ui";
import { boot } from "../shared/api";
import { tx, locale } from "../shared/i18n";
import { currentDevice, type Device } from "../shared/user-experience";
import {
    localizedSubscriptionUrl,
    clients,
    importLink,
    clientSubscriptionUrl,
    recommendedClients,
    supportedClients,
    type ClientId,
} from "../shared/import-links";
export function SubscriptionImport({
    url,
    inline = false,
}: {
    url: string;
    inline?: boolean;
}) {
    const { t } = useTranslation("clientImport");
    const { t: downloadKind } = useTranslation("fastaiDownload");
    const { t: choice } = useTranslation("clientChoice");
    const enabled = (id: ClientId) =>
        boot.clientPolicies?.[id]?.enabled !== false;
    const [downloadOpen, setDownloadOpen] = useState(false);
    const [device, setDevice] = useState<Device>(() => currentDevice().device);
    const recommended = recommendedClients(device, boot.clientRecommendations);
    const [open, setOpen] = useState(false),
        [all, setAll] = useState(false);
    function preferredClient(target: Device): ClientId {
        let saved: string | null = null;
        try {
            saved =
                localStorage.getItem(`v2board.import-client.${target}`) ||
                localStorage.getItem("v2board.import-client");
        } catch {}
        return (
            supportedClients(target).find(
                (client) => client.id === saved && enabled(client.id),
            )?.id ||
            recommendedClients(target, boot.clientRecommendations).find(
                (client) => enabled(client.id),
            )?.id ||
            supportedClients(target).find((client) => enabled(client.id))?.id ||
            recommendedClients(target, boot.clientRecommendations)[0].id
        );
    }
    const [selected, setSelected] = useState<ClientId>(() =>
        preferredClient(device),
    );
    const [copied, setCopied] = useState(false),
        [attempted, setAttempted] = useState(false),
        [error, setError] = useState("");
    const [helpOpen, setHelpOpen] = useState(false);
    const helpId = useId();
    const copyRequest = useRef(0);
    const language = locale();
    useEffect(() => {
        copyRequest.current += 1;
        setCopied(false);
        setAttempted(false);
        setError("");
        setHelpOpen(false);
        return () => {
            copyRequest.current += 1;
        };
    }, [url, selected, device, language]);
    let link = "",
        raw = "";
    try {
        const localized = localizedSubscriptionUrl(url, language);
        raw = clientSubscriptionUrl(selected, localized);
        link = importLink(selected, localized, boot.title);
    } catch {
        return (
            <p className="pad" role="alert">
                {t("invalid")}
            </p>
        );
    }
    const available = supportedClients(device).filter(client => enabled(client.id));
    const primary = recommended.find((client) => enabled(client.id));
    const alternative =
        selected !== primary?.id
            ? primary
            : recommended.find(
                  (client) => enabled(client.id) && client.id !== primary?.id,
              );
    function choose(id: ClientId) {
        setSelected(id);
        setAll(false);
        setAttempted(false);
        setCopied(false);
        setError("");
        try {
            localStorage.setItem(`v2board.import-client.${device}`, id);
        } catch {}
    }
    const policy = boot.clientPolicies?.[selected];
    async function copy() {
        const attempt = ++copyRequest.current;
        setCopied(false);
        setError("");
        try {
            await navigator.clipboard.writeText(raw);
            if (attempt !== copyRequest.current) return;
            trackAction("copy_success");
            setCopied(true);
            setError("");
        } catch {
            if (attempt !== copyRequest.current) return;
            trackAction("copy_failed");
            setError(tx("复制失败，请使用一键导入或扫码。"));
        }
    }
    const downloads: Partial<Record<ClientId, string>> = {
        cmfa: "https://github.com/MetaCubeX/ClashMetaForAndroid/releases",
        flclash: "https://github.com/chen08209/FlClash/releases",
        clash: "https://github.com/clash-verge-rev/clash-verge-rev/releases",
        hiddify: "https://github.com/hiddify/hiddify-app/releases",
        singbox: "https://sing-box.sagernet.org/clients/",
    };
    const downloadUrl =
        selected === "singbox"
            ? `https://sing-box.sagernet.org/clients/${device === "windows" || device === "linux" ? "desktop/" : device === "ios" || device === "macos" ? "apple/" : device === "android" ? "android/" : ""}`
            : device === "ios"
              ? iosDownloads[selected]
              : downloads[selected];
    const content = (
        <div className="pad import-content">
            <header className="client-family-header third-party">
                <span className="client-family-badge">
                    {downloadKind("thirdParty")}
                </span>
            </header>
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
                                setSelected(preferredClient(value));
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
                {enabled(selected) && <div className="client-focus">
                    <span className="client-symbol">
                        <Smartphone size={22} />
                    </span>
                    <div>
                        <strong>
                            {
                                clients.find((client) => client.id === selected)
                                    ?.name
                            }
                        </strong>
                        <small>
                            {selected === primary?.id
                                ? choice("recommended")
                                : choice("selected")}
                        </small>
                    </div>
                </div>}
                <div className="client-switches">
                    {alternative && (
                        <button
                            className="client-alternative"
                            onClick={() => choose(alternative.id)}
                        >
                            <ArrowRightLeft size={16} aria-hidden="true" />
                            <span className="client-alternative-label">
                                {choice("alternative")}
                            </span>
                            <span className="client-alternative-name">
                                {alternative.name}
                            </span>
                            <ChevronRight size={15} aria-hidden="true" />
                        </button>
                    )}
                    {available.length > 0 && <button
                        className="client-text-link"
                        onClick={() => setAll(true)}
                    >
                        {choice("more")} <ArrowUpRight size={14} />
                    </button>}
                </div>
                {!enabled(selected) && (
                    <p role="status">{choice("disabled")}</p>
                )}
                {policy?.minVersion && (
                    <p className="muted">
                        {choice("version", { version: policy.minVersion })}
                    </p>
                )}
                {enabled(selected) && (
                    <div className="quick-actions">
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
                            onClick={() => {
                                trackAction("import_start");
                                setAttempted(true);
                            }}
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
                )}
                {error && <p role="alert">{error}</p>}
                {copied && (
                    <p role="status" className="import-help">
                        {t("copied")}
                    </p>
                )}
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
                {enabled(selected) && <><p className="muted import-completion-help">
                    {t("confirmConnection", { defaultValue: "Confirm the connection works in your client before finishing setup." })}
                </p>
                <div className="import-completion-actions">
                    <a className="button soft-button" href="#/dashboard" onClick={() => setOpen(false)}>
                        {t("finishSetup", { defaultValue: "Setup complete — view usage" })}
                    </a>
                    <button type="button" aria-expanded={helpOpen} aria-controls={helpId}
                        onClick={() => { setHelpOpen((value) => !value); if (!helpOpen) trackAction("help_open"); }}>
                        {t("needHelp", { defaultValue: "Having trouble?" })}
                    </button>
                </div>
                {helpOpen && (
                    <div className="import-troubleshooting" id={helpId}>
                        <h4>{t("helpFor", { client: clients.find((client) => client.id === selected)?.name || selected,
                            defaultValue: "Troubleshoot {{client}}" })}</h4>
                        <ol>
                            <li>{t("helpInstall", { defaultValue: "Check that the selected client is installed, then retry opening it. If the browser does not open it, copy or manually import the subscription below." })}</li>
                            <li>{t("helpRefresh", { defaultValue: "In the client, refresh the imported subscription and select an available connection." })}</li>
                            <li>{device === "ios"
                                ? t("helpIos", { defaultValue: "When iOS asks, allow the client to add its VPN configuration, then enable the connection." })
                                : device === "android"
                                  ? t("helpAndroid", { defaultValue: "If Android asks to allow a VPN connection, confirm the request in the client and enable it." })
                                  : t("helpDesktop", { defaultValue: "Follow the client’s prompts for required system network permissions, then enable the connection." })}</li>
                        </ol>
                        <p className="muted">{t("contactSupport", { defaultValue: "Still unable to connect? Contact support with your device, client version and error message." })}</p>
                        <a href="#/ticket" className="import-guide" onClick={() => setOpen(false)}>
                            {tx("联系客服 / 查看已有工单")}<ArrowUpRight size={15} aria-hidden="true" />
                        </a>
                    </div>
                )}</>}
                <a
                    className="import-guide"
                    href="#/knowledge"
                    onClick={() => {
                        trackAction("help_open");
                        setOpen(false);
                    }}
                >
                    <BookOpen size={16} />
                    {tx("使用文档")}
                </a>
            </section>
            {enabled(selected) && (
                <details className="import-manual" open={error ? true : undefined}>
                    <summary>
                        <QrCode size={17} />
                        {tx("扫码或手动添加")}
                    </summary>
                    <div className="import-fallback">
                        <div>
                            <p className="muted">
                                {tx("在另一台设备上扫描，或复制链接到客户端。")}
                            </p>
                            <label className="import-manual-url">
                                <span>{t("manualUrl", { defaultValue: "Subscription link" })}</span>
                                <input
                                    readOnly
                                    value={raw}
                                    onFocus={(event) => event.currentTarget.select()}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </label>
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
                </details>
            )}
        </div>
    );
    const downloadDialog = downloadOpen && enabled(selected) && (
        <ClientDownload
            client={selected}
            device={device}
            official={downloadUrl!}
            close={() => setDownloadOpen(false)}
        />
    );
    const chooser = all && available.length > 0 && (
        <Modal
            title={choice("more")}
            close={() => setAll(false)}
            className="client-picker-modal"
        >
            <div className="pad client-picker-list">
                {available.map((client) => (
                    <button
                        key={client.id}
                        className={`client-card${selected === client.id ? " selected" : ""}`}
                        disabled={!enabled(client.id)}
                        aria-pressed={selected === client.id}
                        onClick={() => choose(client.id)}
                    >
                        <Smartphone size={20} />
                        <span>
                            <strong>{client.name}</strong>
                            <small>
                                {!enabled(client.id)
                                    ? choice("disabled")
                                    : client.id === primary?.id
                                      ? choice("recommended")
                                      : client.platform}
                            </small>
                        </span>
                        {selected === client.id && <Check size={18} />}
                    </button>
                ))}
            </div>
        </Modal>
    );
    if (inline)
        return (
            <>
                {content}
                {downloadDialog}
                {chooser}
            </>
        );
    return (
        <>
            <button className="primary" onClick={() => setOpen(true)}>
                <Smartphone size={17} />
                {tx("一键导入")}
            </button>
            {downloadDialog}
            {chooser}
            {open && !downloadOpen && !all && (
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
