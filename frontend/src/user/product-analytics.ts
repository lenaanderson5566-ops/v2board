import { useEffect } from "react";
import { apiUrl } from "../shared/runtime-config";
import { locale } from "../shared/i18n";
import type { V10AnalyticsEvent } from "../shared/v10-types";

export const privacyRevision = 3;
export const privacyKey = `v2board.analytics.consent.v2.${encodeURIComponent(apiUrl("/api/v10"))}`;
export type PrivacyChoice = {
    choice: "allow" | "deny";
    version: number;
    chosenAt: number;
    retentionDays: number;
};
export function privacyChoice(): PrivacyChoice | null {
    try {
        const value = JSON.parse(localStorage.getItem(privacyKey) || "null");
        if (
            !value ||
            (value.version !== privacyRevision &&
                !(value.version === 2 && value.choice === "deny")) ||
            !["allow", "deny"].includes(value.choice) ||
            !Number.isFinite(value.chosenAt) ||
            value.chosenAt > Date.now() ||
            Date.now() - value.chosenAt > 180 * 86400000 ||
            ![7, 30, 90].includes(value.retentionDays)
        )
            return null;
        return value;
    } catch {
        return null;
    }
}
export function savePrivacyChoice(
    choice: "allow" | "deny",
    retentionDays: number,
): boolean {
    try {
        localStorage.setItem(
            privacyKey,
            JSON.stringify({
                choice,
                retentionDays,
                version: privacyRevision,
                chosenAt: Date.now(),
            }),
        );
        return true;
    } catch {
        return false;
    }
}
const sessionKey = "v2board.analytics.session.v2";
const screens = new Map<symbol, V10AnalyticsEvent["page"]>();
let enabled = false;
let entryConsumed = false;
let chain = Promise.resolve();
let generation = 0;
let lastEvent = "";
let lastAt = 0;
let activeRequest: AbortController | undefined;
export function privacySignal() {
    return (
        (navigator as Navigator & { globalPrivacyControl?: boolean })
            .globalPrivacyControl === true || navigator.doNotTrack === "1"
    );
}
export function consent() {
    return privacyChoice()?.choice ?? null;
}
export function setCollection(value: boolean) {
    enabled = value && !privacySignal() && consent() === "allow";
    generation++;
    lastEvent = "";
    if (!enabled) {
        activeRequest?.abort();
        try {
            sessionStorage.removeItem(sessionKey);
            sessionStorage.removeItem("v2board.analytics.session.v1");
        } catch {}
    } else screens.forEach(send);
}
type Attribution = Pick<
    V10AnalyticsEvent,
    "attributionVersion" | "sourceDomain"
>;
function attribution(): Attribution {
    const result: Attribution = { attributionVersion: 1 };
    try {
        const source = new URL(document.referrer);
        const host = source.hostname.toLowerCase().replace(/\.$/, "");
        if (
            ["https:", "http:"].includes(source.protocol) &&
            !source.username &&
            !source.password &&
            host !== location.hostname.toLowerCase() &&
            host.length <= 253 &&
            /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
                host,
            ) &&
            !/\.(local|localhost|internal|test|invalid)$/.test(host)
        )
            result.sourceDomain = host;
    } catch {
        /* Referrer may be empty or unavailable. */
    }
    return result;
}
function send(page: V10AnalyticsEvent["page"]) {
    if (
        !enabled ||
        consent() !== "allow" ||
        privacySignal() ||
        document.visibilityState !== "visible"
    )
        return;
    const now = Date.now();
    if (page === lastEvent && now - lastAt < 1000) return;
    lastEvent = page;
    lastAt = now;
    const version = generation;
    chain = chain.then(async () => {
        if (
            !enabled ||
            version !== generation ||
            consent() !== "allow" ||
            privacySignal()
        )
            return;
        try {
            const entry = entryConsumed
                ? { attributionVersion: 1 as const }
                : attribution();
            entryConsumed = true;
            let session = JSON.parse(
                sessionStorage.getItem(sessionKey) || "null",
            ) as {
                id: string;
                start: number;
                last: number;
                attribution: Attribution;
            } | null;
            if (
                !session ||
                now - session.last >= 30 * 60000 ||
                now - session.start >= 86400000
            )
                session = {
                    id: crypto.randomUUID(),
                    start: now,
                    last: now,
                    attribution: entry,
                };
            session.last = now;
            sessionStorage.setItem(sessionKey, JSON.stringify(session));
            const event: V10AnalyticsEvent = {
                sessionId: session.id,
                ...session.attribution,
                page,
                device: /iPad|Tablet/i.test(navigator.userAgent)
                    ? "tablet"
                    : /Mobi/i.test(navigator.userAgent)
                      ? "mobile"
                      : "desktop",
                language: locale() as V10AnalyticsEvent["language"],
                consent: true,
            };
            const controller = new AbortController();
            activeRequest = controller;
            const timeout = window.setTimeout(() => controller.abort(), 5000);
            let response: Response;
            try {
                response = await fetch(
                    apiUrl("/api/v10/public/analytics/events"),
                    {
                        method: "POST",
                        credentials: "omit",
                        referrerPolicy: "no-referrer",
                        headers: {
                            "Content-Type": "application/json",
                            "Accept-Language": locale(),
                        },
                        body: JSON.stringify(event),
                        signal: controller.signal,
                    },
                );
            } finally {
                clearTimeout(timeout);
                if (activeRequest === controller) activeRequest = undefined;
            }
            if (!response.ok && version === generation) enabled = false;
        } catch {
            if (version === generation) enabled = false;
        }
    });
}
// Only named views and the external referrer hostname are collected.
export function useAnalyticsPage(page: V10AnalyticsEvent["page"] | null) {
    useEffect(() => {
        if (!page) return;
        const key = Symbol();
        screens.set(key, page);
        send(page);
        return () => {
            screens.delete(key);
        };
    }, [page]);
}
