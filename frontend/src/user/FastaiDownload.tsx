import { useId, useState } from "react";
import { trackAction } from "./product-analytics";
import { useTranslation } from "react-i18next";
import { boot } from "../shared/api";
import { currentDevice } from "../shared/user-experience";
import { safeDownloadUrl } from "./ClientDownload";
import { tx } from "../shared/i18n";
import "./fastai-download.css";

export function FastaiDownload() {
    const { t } = useTranslation("fastaiDownload");
    const releases = (boot.fastaiDownloads || []).filter((r) =>
        safeDownloadUrl(r.downloadUrl),
    );
    const [platform, setPlatform] = useState<string>(
        () => currentDevice().device,
    );
    const [architecture, setArchitecture] = useState("");
    const architectureId = useId();
    if (!releases.length) return null;
    const available = releases.filter((r) => r.platform === platform);
    const universal = available.find((release) => ["universal", "all"].includes(String(release.architecture).toLowerCase()));
    const needsChoice = available.length > 1 && !universal;
    const selected = universal || (available.length === 1 ? available[0]
        : available.find((release) => release.architecture === architecture));
    const choice = available.some((release) => release.architecture === architecture) ? architecture : "";
    function architectureLabel(value: string) {
        const normalized = value.toLowerCase();
        if (["universal", "all"].includes(normalized))
            return t("architectureUniversal", { defaultValue: "Universal installer" });
        if (platform === "macos" && normalized === "arm64")
            return t("architectureApple", { defaultValue: "Apple Silicon (M1 or later, arm64)" });
        if (platform === "macos" && normalized === "x64")
            return t("architectureIntelMac", { defaultValue: "Intel Mac (x64)" });
        if (normalized === "x64")
            return t("architectureX64", { defaultValue: "Intel / AMD 64-bit (x64)" });
        if (normalized === "x86")
            return t("architectureX86", { defaultValue: "Intel / AMD 32-bit (x86)" });
        if (normalized === "arm64")
            return t("architectureArm64", { defaultValue: "ARM 64-bit (arm64)" });
        if (normalized === "arm")
            return t("architectureArm", { defaultValue: "ARM 32-bit (arm)" });
        return value;
    }
    return (
        <section
            className="panel pad fastai-download-panel"
            aria-label="FastAI"
        >
            <span className="client-family-badge dedicated">
                {t("dedicated")}
            </span>
            <h2>FastAI · {t("title")}</h2>
            <p>{t("guide")}</p>
            <label>
                {tx("选择系统")}{" "}
                <select
                    value={platform}
                    onChange={(e) => {
                        setPlatform(e.target.value);
                        setArchitecture("");
                    }}
                >
                    {Array.from(
                        new Set([platform, ...releases.map((r) => r.platform)]),
                    ).map((p) => (
                        <option key={p} value={p}>
                            {(
                                {
                                    windows: "Windows",
                                    macos: "macOS",
                                    android: "Android",
                                    linux: "Linux",
                                    ios: "iOS",
                                } as Record<string, string>
                            )[p] || p}
                        </option>
                    ))}
                </select>
            </label>
            {available.length > 0 && <div className="fastai-architecture">
                {needsChoice ? <label htmlFor={architectureId}>
                    <span>{t("architecture", { defaultValue: "Device chip" })}</span>
                    <select id={architectureId} value={choice}
                        aria-describedby={`${architectureId}-help`}
                        onChange={(event) => setArchitecture(event.target.value)}>
                        <option value="" disabled>{t("chooseArchitecture", { defaultValue: "Choose your device chip" })}</option>
                        {available.map((release) => <option key={release.architecture} value={release.architecture}>
                            {architectureLabel(release.architecture)}
                        </option>)}
                    </select>
                </label> : <strong>{architectureLabel(selected!.architecture)}</strong>}
                <p id={`${architectureId}-help`} className="muted">
                    {t("architectureHelp", { defaultValue: "If unsure, check your device’s system information. Choose the installer that matches its chip." })}
                </p>
            </div>}
            <div className="actions">
                {selected ? (
                    <a
                        className="button primary"
                        href={safeDownloadUrl(selected.downloadUrl)!}
                        onClick={() => trackAction("download")}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {tx("下载")} FastAI {selected.latestVersion}
                    </a>
                ) : available.length > 0 ? <button type="button" className="primary" disabled
                    aria-describedby={`${architectureId}-help`}>{tx("下载")} FastAI</button> : null}
            </div>
            {!available.length && <p className="muted">{t("unavailable")}</p>}
            <p className="muted">{t("appUpdates")}</p>
        </section>
    );
}
