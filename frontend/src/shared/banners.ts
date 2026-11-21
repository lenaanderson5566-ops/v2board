import type { Row } from "./api";

export function bannerUrl(value: unknown): string | undefined {
    if (typeof value !== "string" || /[\x00-\x20\x7f\\]/.test(value)) return;
    let decoded: string;
    try {
        decoded = decodeURIComponent(value);
    } catch {
        return;
    }
    if (/[\x00-\x20\x7f\\]/.test(decoded)) return;
    if (/^\/(?!\/)/.test(decoded)) return value;
    try {
        const url = new URL(value);
        if (
            ["https:", "http:"].includes(url.protocol) &&
            !url.username &&
            !url.password
        )
            return value;
    } catch {
        /* Invalid URL */
    }
}
export const presetBanner = "/banners/fastdog-3-launch-slim.png";
export const presetMobileBanner = "/banners/fastdog-3-launch.png";
// Existing seeded records adopt the compact artwork without changing saved settings.
export function bannerImages(banner: Row) {
    const preset = [presetBanner, presetMobileBanner].includes(
        banner.image_url,
    );
    return {
        desktop:
            banner.image_url === presetMobileBanner
                ? presetBanner
                : banner.image_url,
        mobile:
            banner.mobile_image_url ||
            (preset ? presetMobileBanner : undefined),
    };
}
