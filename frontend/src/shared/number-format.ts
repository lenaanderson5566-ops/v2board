import { locale } from "./i18n";

/** Display conversion only. Monetary and metering calculations keep their source values. */
export function finiteNumber(value: unknown): number | null {
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? (Object.is(number, -0) ? 0 : number) : null;
}

const formatters = new Map<string, Intl.NumberFormat>();
export function formatNumber(value: unknown, options: Intl.NumberFormatOptions = {}): string {
    const number = finiteNumber(value);
    if (number === null) return "—";
    const settings = { maximumFractionDigits: Math.max(2, options.minimumFractionDigits ?? 0), ...options };
    const language = locale();
    const key = `${language}:${JSON.stringify(settings)}`;
    let formatter = formatters.get(key);
    if (!formatter) {
        formatter = new Intl.NumberFormat(language, settings);
        if (formatters.size >= 64) formatters.clear();
        formatters.set(key, formatter);
    }
    const scale = settings.style === "percent" ? 100 : 1;
    const roundedZero = Math.abs(number * scale) < 0.5 * 10 ** -settings.maximumFractionDigits;
    return formatter.format(roundedZero ? 0 : number);
}

export function formatPercent(value: unknown, {
    fraction = false, maximumFractionDigits = 1, bounded = false,
}: { fraction?: boolean; maximumFractionDigits?: number; bounded?: boolean } = {}): string {
    const number = finiteNumber(value);
    if (number === null) return "—";
    const percent = fraction ? number * 100 : number;
    if (!Number.isFinite(percent)) return "—";
    const minimum = 10 ** -maximumFractionDigits;
    const epsilon = Number.EPSILON * Math.max(100, Math.abs(percent)) * 8;
    const display = (points: number) => formatNumber(points / 100, {
        style: "percent", maximumFractionDigits,
    });
    if (percent > 0 && percent < minimum - epsilon) return `<${display(minimum)}`;
    if (percent < 0 && percent > -minimum + epsilon) return `>${display(-minimum)}`;
    if (bounded && percent < 100 && percent > 100 - minimum + epsilon) return `>${display(100 - minimum)}`;
    return display(percent);
}

export function formatMultiplier(value: unknown): string {
    const number = finiteNumber(value);
    if (number === null || number < 0) return "—";
    const minimum = 1e-9;
    return `${number > 0 && number < minimum ? "<" : ""}${formatNumber(number > 0 && number < minimum ? minimum : number, { maximumFractionDigits: 9 })}×`;
}

export function formatBytes(value: unknown): string {
    let number = finiteNumber(value);
    if (number === null || number < 0) return "—";
    const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
    let index = 0;
    while (number >= 1024 && index < units.length - 1) {
        number /= 1024;
        index++;
    }
    // Carry display rounding into the next unit instead of showing 1,024 MiB.
    if (index < units.length - 1 && Math.round(number * 100) / 100 >= 1024) {
        number /= 1024;
        index++;
    }
    return `${formatNumber(number, { maximumFractionDigits: index ? 2 : 0 })} ${units[index]}`;
}

/** Durations retain their source unit; small positive measurements never display as zero. */
export function formatDuration(value: unknown, unit: "ms" | "s" = "ms"): string {
    const number = finiteNumber(value);
    if (number === null || number < 0) return "—";
    return `${number > 0 && number < 0.1 ? "<" : ""}${formatNumber(number > 0 && number < 0.1 ? 0.1 : number, { maximumFractionDigits: 1 })} ${unit}`;
}
