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
                <header className="minimal-landing-header">
                    <a className="minimal-landing-brand" href="/">
                        <Sparkles size={20} aria-hidden="true" />
                        <strong>{boot.title}</strong>
                    </a>
                    <LanguagePicker />
                </header>
                <main className="minimal-landing-main">
                    <span className="minimal-landing-eyebrow">{t("tag")}</span>
                    <h1>{t("aiTitle")}</h1>
                    <p>{t("aiIntro")}</p>
                    <a className="minimal-landing-enter" href="/app#/login">
                        {t("signIn")}{" "}
                        <ArrowUpRight size={18} aria-hidden="true" />
                    </a>
                </main>
                <a className="minimal-landing-scroll" href="/app#/login">
                    <span>{t("scrollToAuth")}</span>
                    <ArrowDown size={20} aria-hidden="true" />
                </a>
            </div>
            <div className="minimal-landing-scroll-space" aria-hidden="true" />
        </div>
    );
}
