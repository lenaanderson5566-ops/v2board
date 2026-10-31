import { useId, useState } from "react";
import { trackAction } from "./product-analytics";
import { BrowserHandoffHelp } from "./BrowserHandoffHelp";
import { AccountList } from "./AppleAccounts";
import { useTranslation } from "react-i18next";
import { ArrowRight, ArrowUpRight, ChevronDown, Download, Globe, KeyRound, ShieldAlert } from "lucide-react";
import { boot } from "../shared/api";
import { Modal } from "../shared/ui";
import { clients, type ClientId } from "../shared/import-links";
import type { Device } from "../shared/user-experience";
export const iosDownloads: Partial<Record<ClientId, string>> = {
    shadowrocket: "https://apps.apple.com/app/id932747118",
    hiddify: "https://apps.apple.com/app/id6596777532",
    singbox: "https://sing-box.sagernet.org/clients/apple/",
    quantumult: "https://apps.apple.com/app/id1443988620",
    stash: "https://apps.apple.com/app/id1596063349",
    surge: "https://nssurge.com/",
};
export function safeDownloadUrl(value?: string): string | undefined {
    try {
        const url = new URL(value || "");
        if (
            ["https:", "http:"].includes(url.protocol) &&
            !url.username &&
            !url.password
        )
            return url.href;
    } catch {}
}
export function mirrorDownload(client: ClientId, device: Device) {
    const dedicated = boot.clientMirrors?.[`${client}_${device}`];
    const legacy =
        (client === "clash" && ["windows", "macos"].includes(device)) ||
        (client === "hiddify" && device === "android")
            ? boot.legacyDownloads?.[device]
            : undefined;
    return safeDownloadUrl(dedicated || legacy);
}
export function ClientDownload({
    client,
    device,
    official,
    close,
}: {
    client: ClientId;
    device: Device;
    official: string;
    close: () => void;
}) {
    const { t } = useTranslation("clientDownload");
    const { t: kind } = useTranslation("fastaiDownload");
    const officialUrl = safeDownloadUrl(official);
    const variants = Object.entries(boot.clientMirrors || {}).filter(
        ([key, url]) =>
            key.startsWith(`${client}_${device}:`) && safeDownloadUrl(url),
    );
    const [architecture, setArchitecture] = useState("");
    const variant = variants.find(
        ([key]) => key.split(":")[1] === architecture,
    );
    const universal = variants.find(([key]) => key.endsWith(":universal"));
    const mirror = variants.length
        ? safeDownloadUrl(universal?.[1] || variant?.[1])
        : mirrorDownload(client, device);
    const { t: ios } = useTranslation("iosDownload");
    const [showAccounts, setShowAccounts] = useState(false);
    const accountPanelId = useId();
    return (
        <Modal
            title={t("title")}
            close={close}
            className="client-download-modal"
        >
            <div className="pad download-options">
                <span className="client-family-badge">
                    {kind("thirdParty")}
                </span>
                <p className="download-client">
                    {clients.find((item) => item.id === client)?.name}
                    <span>{device === "unknown" ? "" : device}</span>
                </p>
                <p className="muted download-next-step">
                    {t("installThenImport", {
                        defaultValue: "Install the client, then return here to import your subscription.",
                    })}
                </p>
                {officialUrl ? (
                    <a
                        className="download-source"
                        onClick={() => trackAction("download")}
                        href={officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Globe size={22} />
                        <span>
                            <strong>{t("official")}</strong>
                            <small>{new URL(officialUrl).hostname}</small>
                        </span>
                        <ArrowUpRight size={18} />
                    </a>
                ) : (
                    <p role="status" className="muted">
                        {t("officialUnavailable", {
                            defaultValue: "The official download is unavailable. Use an available mirror or choose another client.",
                        })}
                    </p>
                )}
                {device !== "ios" && variants.length > 0 && !universal && (
                    <select
                        aria-label={t("hint")}
                        value={architecture}
                        onChange={(e) => setArchitecture(e.target.value)}
                    >
                        <option value="">{t("hint")}</option>
                        {variants.map(([key]) => {
                            const arch = key.split(":")[1];
                            return (
                                <option key={key} value={arch}>
                                    {arch === "arm64"
                                        ? device === "macos"
                                            ? "Apple Silicon · M1 / M2 / M3 / M4 / ARM64"
                                            : "ARM64"
                                        : arch === "x64"
                                          ? "Intel / AMD · x64"
                                          : arch === "universal"
                                            ? "Universal"
                                            : arch === "unknown"
                                              ? "—"
                                              : arch.toUpperCase()}
                                </option>
                            );
                        })}
                    </select>
                )}
                {device !== "ios" &&
                    (mirror ? (
                        <a
                            className="download-source"
                            onClick={() => trackAction("download")}
                            href={mirror}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <Download size={22} />
                            <span>
                                <strong>{t("mirror")}</strong>
                            </span>
                            <ArrowUpRight size={18} />
                        </a>
                    ) : (
                        <button className="download-source" disabled>
                            <Download size={22} />
                            <span>
                                <strong>{t("mirror")}</strong>
                                <small>{t("unavailable")}</small>
                            </span>
                        </button>
                    ))}
                {device === "ios" ? (
                    <>
                        <p className="muted">{ios("own")}</p>
                        {boot.appleAccountEnabled && (
                            <>
                                <button
                                    className="download-source"
                                    aria-expanded={showAccounts}
                                    aria-controls={accountPanelId}
                                    onClick={() =>
                                        setShowAccounts((value) => !value)
                                    }
                                >
                                    <KeyRound size={22} aria-hidden="true" />
                                    <span>
                                        <strong>{ios("account")}</strong>
                                        <small>{ios("eligibility")}</small>
                                    </span>
                                    <ChevronDown size={18} className="ios-account-chevron" aria-hidden="true" />
                                </button>
                                {showAccounts && (
                                    <div className="ios-account-guide" id={accountPanelId}>
                                        <p className="apple-account-notice"><ShieldAlert size={18} aria-hidden="true" /><span>{ios("warning")}</span></p>
                                        <AccountList showNotice={false} />
                                        <p className="ios-account-purchase-note muted">{ios("paid")}</p>
                                        <details className="ios-account-instructions">
                                            <summary>{ios("instructions", { defaultValue: "How to use a download account" })}</summary>
                                            <ol>
                                                {["step1", "step2", "step3"].map((key) => <li key={key}>{ios(key)}</li>)}
                                            </ol>
                                        </details>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                ) : (
                    <small className="muted">{t("hint")}</small>
                )}
                <BrowserHandoffHelp context="setup" />
                <button className="primary download-continue" onClick={close}>
                    {t("continueImport", {
                        defaultValue: "Installed? Continue to import",
                    })}
                    <ArrowRight size={17} aria-hidden="true" />
                </button>
            </div>
        </Modal>
    );
}
