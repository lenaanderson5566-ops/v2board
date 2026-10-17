import { useState } from "react";
import { useTranslation } from "react-i18next";
import { boot } from "../shared/api";
import { currentDevice } from "../shared/user-experience";
import { safeDownloadUrl } from "./ClientDownload";
import { tx } from "../shared/i18n";

export function FastaiDownload() {
    const { t } = useTranslation("fastaiDownload");
    const releases = (boot.fastaiDownloads || []).filter((r) =>
        safeDownloadUrl(r.downloadUrl),
    );
    const [platform, setPlatform] = useState<string>(
        () => currentDevice().device,
    );
    if (!releases.length) return null;
    const available = releases.filter((r) => r.platform === platform);
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
                    onChange={(e) => setPlatform(e.target.value)}
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
            <div className="actions">
                {available.map((r) => (
                    <a
                        className="button primary"
                        key={r.architecture}
                        href={safeDownloadUrl(r.downloadUrl)!}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {tx("下载")} FastAI {r.latestVersion} · {r.architecture}
                    </a>
                ))}
            </div>
            {!available.length && <p className="muted">{t("unavailable")}</p>}
            <p className="muted">{t("appUpdates")}</p>
        </section>
    );
}
