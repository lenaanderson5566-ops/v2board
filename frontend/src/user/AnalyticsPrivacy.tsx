import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { apiUrl } from "../shared/runtime-config";
import { e } from "../shared/experience-copy";
import {
    privacyChoice,
    privacyKey,
    privacySignal,
    savePrivacyChoice,
    setCollection,
} from "./product-analytics";
import type { V10AnalyticsConfiguration } from "../shared/v10-types";

export function AnalyticsPrivacyEntry() {
    useTranslation();
    return (
        <button
            type="button"
            className="analytics-privacy-entry"
            onClick={() =>
                window.dispatchEvent(new Event("analytics-preferences"))
            }
        >
            <ShieldCheck size={16} aria-hidden />
            {e("analyticsPrivacy")}
        </button>
    );
}
export function AnalyticsPrivacy() {
    useTranslation();
    const [configuration, setConfiguration] =
        useState<V10AnalyticsConfiguration | null>(null);
    const [open, setOpen] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const detailsId = useId();
    const [error, setError] = useState(false);
    const [chosenAt, setChosenAt] = useState<number | null>(
        () => privacyChoice()?.chosenAt ?? null,
    );
    const region = useRef<HTMLElement>(null);
    const [height, setHeight] = useState(0);
    useEffect(() => {
        if (!open || !region.current) return;
        const element = region.current;
        const measure = () =>
            setHeight(Math.ceil(element.getBoundingClientRect().height));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [open]);
    const current = useRef<V10AnalyticsConfiguration | null>(null);
    const requested = useRef(false);
    const opener = useRef<HTMLElement | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        async function refresh() {
            const timeout = window.setTimeout(() => controller.abort(), 5000);
            try {
                const response = await fetch(
                    apiUrl("/api/v10/public/analytics/configuration"),
                    {
                        credentials: "omit",
                        referrerPolicy: "no-referrer",
                        signal: controller.signal,
                    },
                );
                if (!response.ok) throw new Error();
                const { data } = (await response.json()) as {
                    data: V10AnalyticsConfiguration;
                };
                if (controller.signal.aborted) return;
                if (
                    typeof data.enabled !== "boolean" ||
                    ![7, 30, 90].includes(data.retentionDays)
                )
                    throw new Error();
                const old = current.current;
                current.current = data;
                setConfiguration(data);
                const choice = privacyChoice();
                const renewed =
                    choice?.choice === "allow" &&
                    choice.retentionDays < data.retentionDays;
                if (
                    !old ||
                    old.enabled !== data.enabled ||
                    old.retentionDays !== data.retentionDays ||
                    !choice
                )
                    setCollection(data.enabled && !renewed);
                if (data.enabled && (!choice || renewed) && !privacySignal())
                    setOpen(true);
                if (!data.enabled && !requested.current) setOpen(false);
                setError(false);
            } catch {
                current.current = null;
                if (!controller.signal.aborted) setError(true);
                setCollection(false);
            } finally {
                clearTimeout(timeout);
                if (!controller.signal.aborted)
                    timer = setTimeout(refresh, 300000);
            }
        }
        void refresh();
        const show = () => {
            opener.current =
                document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
            requested.current = true;
            setOpen(true);
            requestAnimationFrame(() => {
                region.current?.focus({ preventScroll: true });
            });
        };
        const sync = (event: StorageEvent) => {
            if (event.key !== privacyKey && event.key !== null) return;
            const choice = privacyChoice();
            setChosenAt(choice?.chosenAt ?? null);
            setCollection(
                !!current.current?.enabled &&
                    !!choice &&
                    choice.retentionDays >= current.current.retentionDays,
            );
            setOpen(!choice && !!current.current?.enabled && !privacySignal());
        };
        window.addEventListener("analytics-preferences", show);
        window.addEventListener("storage", sync);
        return () => {
            controller.abort();
            clearTimeout(timer);
            setCollection(false);
            window.removeEventListener("analytics-preferences", show);
            window.removeEventListener("storage", sync);
        };
    }, []);
    function choose(value: "allow" | "deny") {
        const stored = savePrivacyChoice(
            value,
            configuration?.retentionDays ?? 30,
        );
        setError(!stored);
        setChosenAt(stored ? (privacyChoice()?.chosenAt ?? null) : null);
        setCollection(
            stored && configuration?.enabled === true && value === "allow",
        );
        if (stored) {
            requested.current = false;
            setOpen(false);
            requestAnimationFrame(() => {
                if (opener.current?.isConnected) opener.current.focus();
            });
        }
    }
    if (!open) return null;
    return (
        <>
            <div
                className="analytics-privacy-spacer"
                style={{ height: height + 32 }}
                aria-hidden="true"
            />
            <section
                ref={region}
                tabIndex={-1}
                className="analytics-privacy"
                aria-label={e("analyticsPrivacy")}
            >
                <div className="analytics-privacy-copy">
                    <div className="analytics-privacy-heading">
                        <span className="analytics-privacy-icon">
                            <ShieldCheck size={20} aria-hidden />
                        </span>
                        <strong>{e("analyticsPrivacy")}</strong>
                    </div>
                    <p>{e("analyticsConsent")}</p>
                    <div
                        id={detailsId}
                        hidden={!expanded}
                        className="analytics-privacy-details"
                    >
                        <p>{e("analyticsSummary")}</p>
                        <details>
                            <summary>{e("analyticsDetails")}</summary>
                            <p>{e("analyticsExplanation")}</p>
                            {configuration && (
                                <p>
                                    {e("analyticsRetention")}{" "}
                                    {configuration.retentionDays}{" "}
                                    {e("analyticsDays")}
                                </p>
                            )}
                            {chosenAt && (
                                <p>
                                    {e("analyticsChosenAt")}{" "}
                                    {new Date(chosenAt).toLocaleString()}
                                </p>
                            )}
                        </details>
                    </div>
                    {!configuration?.enabled && (
                        <p>{e("analyticsUnavailable")}</p>
                    )}
                    {privacySignal() && <p>{e("analyticsSignal")}</p>}
                    {error && <p role="status">{e("analyticsStorageError")}</p>}
                </div>
                <div className="actions">
                    <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        onClick={() => setExpanded(!expanded)}
                    >
                        {e("analyticsManage")}
                    </button>
                    <button type="button" onClick={() => choose("deny")}>
                        {e("analyticsDecline")}
                    </button>
                    <button
                        type="button"
                        disabled={
                            !configuration?.enabled || privacySignal() || error
                        }
                        onClick={() => choose("allow")}
                    >
                        {e("analyticsAllow")}
                    </button>
                </div>
            </section>
        </>
    );
}
