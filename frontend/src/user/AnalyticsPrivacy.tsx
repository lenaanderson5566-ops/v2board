import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../shared/runtime-config";
import { e } from "../shared/experience-copy";
import {
    privacyChoice,
    privacyKey,
    privacySignal,
    savePrivacyChoice,
    setCollection,
} from "./product-analytics";
import { boot } from "../shared/api";
import { tx } from "../shared/i18n";
import type { V10AnalyticsConfiguration } from "../shared/v10-types";

let configuration: V10AnalyticsConfiguration | null = null;
let revision = 0;
const listeners = new Set<() => void>();
function publish() {
    revision++;
    listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
function permitted() {
    const choice = privacyChoice();
    return !!configuration?.enabled && choice?.choice === "allow" &&
        choice.retentionDays >= configuration.retentionDays && !privacySignal();
}
export function AnalyticsPrivacySetting() {
    useTranslation();
    useSyncExternalStore(subscribe, () => revision);
    const [error, setError] = useState(false);
    const descriptionId = useId();
    const enabled = permitted();
    function choose() {
        const stored = savePrivacyChoice(enabled ? "deny" : "allow", configuration?.retentionDays ?? 30);
        setError(!stored);
        setCollection(stored && permitted());
        publish();
    }
    return <div className="settings-row analytics-setting">
        <div>
            <strong>{e("analyticsPrivacy")}</strong>
            <p id={descriptionId} className="muted">{e("analyticsConsent")}</p>
            <details className="analytics-setting-details">
                <summary>{e("analyticsDetails")}</summary>
                <p>{e("analyticsSummary")}</p>
                <p>{e("analyticsSources")}</p>
                <p>{e("analyticsExperience")}</p>
                <p>{e("analyticsExplanation")}</p>
                {configuration && <p>{e("analyticsRetention")} {configuration.retentionDays} {e("analyticsDays")}</p>}
            </details>
            {!configuration?.enabled && <p className="muted">{e("analyticsUnavailable")}</p>}
            {privacySignal() && <p className="muted">{e("analyticsSignal")}</p>}
            {error && <p role="status">{e("analyticsStorageError")}</p>}
        </div>
        <button type="button" role="switch" className="toggle-control"
            aria-label={e("analyticsPrivacy")} aria-describedby={descriptionId}
            aria-checked={enabled} disabled={!enabled && (!configuration?.enabled || privacySignal())}
            onClick={choose}><span className="toggle-track" aria-hidden="true"><i /></span></button>
    </div>;
}
export function PrivacyFooterLinks() {
    useTranslation();
    return (
        <div className="privacy-footer-links">
            {boot.tosUrl && (
                <a href={boot.tosUrl} target="_blank" rel="noopener noreferrer">
                    {tx("服务条款")}
                </a>
            )}
        </div>
    );
}
export function AnalyticsPrivacyFooter() {
    return (
        <footer className="access-footer">
            <PrivacyFooterLinks />
        </footer>
    );
}

// Global consent controller: deliberately renders no banner or preference entry.
export function AnalyticsPrivacy() {
    useEffect(() => {
        let disposed = false;
        let timer: ReturnType<typeof setTimeout>;
        let controller: AbortController;
        async function refresh() {
            controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 5000);
            try {
                const response = await fetch(apiUrl("/api/v10/public/analytics/configuration"), {
                    credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal,
                });
                if (!response.ok) throw new Error();
                const { data } = await response.json() as { data: V10AnalyticsConfiguration };
                if (disposed) return;
                if (typeof data.enabled !== "boolean" || ![7, 30, 90].includes(data.retentionDays)) throw new Error();
                configuration = data;
                setCollection(permitted());
            } catch {
                if (disposed) return;
                configuration = null;
                setCollection(false);
            } finally {
                clearTimeout(timeout);
                if (!disposed) {
                    publish();
                    timer = setTimeout(refresh, 300000);
                }
            }
        }
        void refresh();
        const sync = (event: StorageEvent) => {
            if (event.key !== privacyKey && event.key !== null) return;
            setCollection(permitted());
            publish();
        };
        window.addEventListener("storage", sync);
        return () => {
            disposed = true;
            controller.abort();
            clearTimeout(timer);
            configuration = null;
            setCollection(false);
            publish();
            window.removeEventListener("storage", sync);
        };
    }, []);
    return null;
}
