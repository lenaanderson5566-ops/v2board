import { useState } from "react";
import { useTranslation } from "react-i18next";
import { query, type Row } from "../shared/api";
import { bannerImages, bannerUrl } from "../shared/banners";
import { useData } from "../shared/ui/useData";
import "./banner-strip.css";

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
