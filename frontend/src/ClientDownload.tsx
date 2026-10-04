import { useState } from "react";
import { AccountList } from "./AppleAccounts";
import "./ios-download-copy";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Download, Globe } from "lucide-react";
import { boot } from "./api";
import { Modal } from "./ui";
import { clients, type ClientId } from "./import-links";
import type { Device } from "./user-experience";
import "./download-copy";
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
        if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch {}
}
export function mirrorDownload(client: ClientId, device: Device) {
    const dedicated = boot.clientMirrors?.[`${client}_${device}`];
    const legacy = ((client === "clash" && ["windows", "macos"].includes(device)) || (client === "hiddify" && device === "android")) ? boot.legacyDownloads?.[device] : undefined;
    return safeDownloadUrl(dedicated || legacy);
}
export function ClientDownload({ client, device, official, close }: { client: ClientId; device: Device; official: string; close: () => void }) {
    const { t } = useTranslation("clientDownload");
    const variants=Object.entries(boot.clientMirrors || {}).filter(([key,url])=>key.startsWith(`${client}_${device}:`) && safeDownloadUrl(url));
    const [architecture,setArchitecture]=useState("");
    const variant=variants.find(([key])=>key.split(":")[1]===architecture);
    const universal=variants.find(([key])=>key.endsWith(":universal"));
    const mirror = variants.length ? safeDownloadUrl(variant?.[1] || universal?.[1]) : mirrorDownload(client, device);
    const { t: ios } = useTranslation("iosDownload");
    const [showAccounts, setShowAccounts] = useState(false);
    return <Modal title={t("title")} close={close} className="client-download-modal">
        <div className="pad download-options">
            <p className="download-client">{clients.find(item => item.id === client)?.name}<span>{device === "unknown" ? "" : device}</span></p>
            <a className="download-source" href={safeDownloadUrl(official)} target="_blank" rel="noopener noreferrer"><Globe size={22}/><span><strong>{t("official")}</strong><small>{new URL(official).hostname}</small></span><ArrowUpRight size={18}/></a>
            {device !== "ios" && variants.length>0 && <select aria-label={t("hint")} value={architecture} onChange={e=>setArchitecture(e.target.value)}>
                <option value="">{t("hint")}</option>
                {variants.map(([key])=>{const arch=key.split(":")[1];return <option key={key} value={arch}>{arch==="arm64" ? (device==="macos" ? "Apple Silicon · M1 / M2 / M3 / M4 / ARM64" : "ARM64") : arch==="x64" ? "Intel / AMD · x64" : arch==="universal" ? "Universal" : arch==="unknown" ? "—" : arch.toUpperCase()}</option>;})}
            </select>}
            {device !== "ios" && (mirror ? <a className="download-source" href={mirror} target="_blank" rel="noopener noreferrer"><Download size={22}/><span><strong>{t("mirror")}</strong><small>{t("provided")}</small></span><ArrowUpRight size={18}/></a> : <button className="download-source" disabled><Download size={22}/><span><strong>{t("mirror")}</strong><small>{t("unavailable")}</small></span></button>)}
            {device === "ios" ? <>
                <p className="muted">{ios("own")}</p>
                {boot.appleAccountEnabled && <>
                    <button className="download-source" aria-expanded={showAccounts} onClick={() => setShowAccounts(value => !value)}><Download size={22}/><span><strong>{ios("account")}</strong><small>{ios("eligibility")}</small></span></button>
                    {showAccounts && <div className="ios-account-guide">
                        <p className="import-help">{ios("warning")}</p>
                        <ol>{["step1", "step2", "step3"].map(key => <li key={key}>{ios(key)}</li>)}</ol>
                        <p className="muted">{ios("paid")}</p>
                        <AccountList />
                    </div>}
                </>}
            </> : <small className="muted">{t("hint")}</small>}
        </div>
    </Modal>;
}
