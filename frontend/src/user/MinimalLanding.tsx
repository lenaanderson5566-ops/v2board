import { useEffect } from "react";
import { ArrowDown, ArrowUpRight, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { boot } from "../shared/api";
import { LanguagePicker } from "../shared/LanguagePicker";
import "./minimal-landing.css";

export default function MinimalLanding() {
    const { t } = useTranslation("landing");
    useEffect(() => {
        let entering = false;
        const onScroll = () => {
            if (entering || window.scrollY < 72) return;
            entering = true;
            window.location.assign("/app#/login");
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    return (
        <div className="minimal-landing">
            <div className="minimal-landing-screen">
                <div className="minimal-landing-art" aria-hidden="true">
                    <div className="minimal-orbit minimal-orbit-outer" />
                    <div className="minimal-orbit minimal-orbit-inner" />
                    <div className="minimal-sphere">
                        <svg
                            className="minimal-globe"
                            viewBox="0 0 400 400"
                            fill="none"
                        >
                            <circle cx="200" cy="200" r="192" />
                            <ellipse cx="200" cy="200" rx="128" ry="192" />
                            <ellipse cx="200" cy="200" rx="56" ry="192" />
                            <ellipse cx="200" cy="200" rx="192" ry="64" />
                            <ellipse cx="200" cy="200" rx="192" ry="136" />
                            <path d="M8 200h384M200 8v384M56 72l254 252L80 296l242-208" />
                            <g className="minimal-network-nodes">
                                <circle cx="56" cy="72" r="4" />
                                <circle cx="310" cy="324" r="4" />
                                <circle cx="80" cy="296" r="4" />
                                <circle cx="322" cy="88" r="4" />
                            </g>
                        </svg>
                    </div>
                    <span className="minimal-orbit-point" />
                </div>
                <header className="minimal-landing-header">
                    <a className="minimal-landing-brand" href="/">
                        <span className="minimal-brand-mark">
                            <Sparkles size={19} aria-hidden="true" />
                        </span>
                        <strong>{boot.title}</strong>
                    </a>
                    <LanguagePicker />
                </header>
                <main className="minimal-landing-main">
                    <span className="minimal-landing-eyebrow">
                        <span aria-hidden="true" />
                        {t("tag")}
                    </span>
                    <h1>{t("aiTitle")}</h1>
                    <p>{t("aiIntro")}</p>
                    <a className="minimal-landing-enter" href="/app#/login">
                        {t("signIn")}{" "}
                        <span className="minimal-enter-icon">
                            <ArrowUpRight size={18} aria-hidden="true" />
                        </span>
                    </a>
                </main>
                <footer className="minimal-landing-footer">
                    <span className="minimal-platforms">
                        Windows · macOS · iOS · Android
                    </span>
                    <a className="minimal-landing-scroll" href="/app#/login">
                        <span>{t("scrollToAuth")}</span>
                        <ArrowDown size={20} aria-hidden="true" />
                    </a>
                    <span className="minimal-footer-brand" aria-hidden="true">
                        {boot.title}
                    </span>
                </footer>
            </div>
            <div className="minimal-landing-scroll-space" aria-hidden="true" />
        </div>
    );
}
