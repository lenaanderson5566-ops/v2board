import { useState } from "react";
import { useData } from "./ui";
import { Row, query } from "./api";
import { useTranslation } from "react-i18next";
import "./banners.css";
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
export function BannerStrip({
    placement,
}: {
    placement: "landing" | "dashboard";
}) {
    const { t } = useTranslation("banners");
    const data = useData<Row[]>(query("guest/banner/fetch", { placement }));
    const [index, setIndex] = useState(0),
        [failed, setFailed] = useState<string[]>([]);
    const items = (data.data || []).filter(
        (b) => bannerUrl(b.image_url) && !failed.includes(b.image_url),
    );
    if (!items.length || data.error) return null;
    const active = index % items.length,
        banner = items[active],
        target = bannerUrl(banner.target_url);
    const images = bannerImages(banner);
    const image = (
        <picture key={images.desktop}>
            {bannerUrl(images.mobile) && (
                <source media="(max-width: 600px)" srcSet={images.mobile} />
            )}
            <img
                src={images.desktop}
                alt={banner.title}
                onError={() => setFailed((v) => [...v, banner.image_url])}
            />
        </picture>
    );
    return (
        <section
            className={`banner-strip banner-${placement}`}
            aria-label={banner.title}
        >
            {target ? <a href={target}>{image}</a> : image}
            {items.length > 1 && (
                <div className="banner-controls">
                    <button
                        type="button"
                        aria-label={t("previous")}
                        onClick={() =>
                            setIndex((active + items.length - 1) % items.length)
                        }
                    >
                        ‹
                    </button>
                    <div>
                        {items.map((b, i) => (
                            <button
                                key={b.id}
                                type="button"
                                aria-label={`${t("select")} ${i + 1}`}
                                aria-pressed={active === i}
                                onClick={() => setIndex(i)}
                                className="banner-dot"
                            />
                        ))}
                    </div>
                    <button
                        type="button"
                        aria-label={t("next")}
                        onClick={() => setIndex((active + 1) % items.length)}
                    >
                        ›
                    </button>
                </div>
            )}
        </section>
    );
}
