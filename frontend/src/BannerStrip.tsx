import { useState } from "react";
import { useData } from "./ui";
import { Row, query } from "./api";
import { locale } from "./i18n";
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
const labels: Record<string, string[]> = {
    "zh-CN": ["上一张", "下一张", "选择 Banner"],
    "zh-TW": ["上一張", "下一張", "選擇 Banner"],
    "en-US": ["Previous banner", "Next banner", "Select banner"],
    "ja-JP": ["前へ", "次へ", "バナーを選択"],
    "ko-KR": ["이전", "다음", "배너 선택"],
    "vi-VN": ["Trước", "Tiếp", "Chọn banner"],
    "ru-RU": ["Назад", "Далее", "Выбрать баннер"],
    "fa-IR": ["قبلی", "بعدی", "انتخاب بنر"],
};
export function BannerStrip({
    placement,
}: {
    placement: "landing" | "dashboard";
}) {
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
    const copy = labels[locale()] || labels["en-US"];
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
                        aria-label={copy[0]}
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
                                aria-label={`${copy[2]} ${i + 1}`}
                                aria-pressed={active === i}
                                onClick={() => setIndex(i)}
                                className="banner-dot"
                            />
                        ))}
                    </div>
                    <button
                        type="button"
                        aria-label={copy[1]}
                        onClick={() => setIndex((active + 1) % items.length)}
                    >
                        ›
                    </button>
                </div>
            )}
        </section>
    );
}
