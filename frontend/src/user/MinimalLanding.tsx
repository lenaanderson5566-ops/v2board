import { useEffect } from "react";
import { ArrowDown, ArrowUpRight, Sparkles, PenLine, Code2, BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { boot } from "../shared/api";
import { LanguagePicker } from "../shared/LanguagePicker";
import openaiIcon from "../assets/openai.svg";
import claudeIcon from "../assets/claude.svg";
import geminiIcon from "../assets/googlegemini.svg";
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
                        <span className="minimal-brand-mark">
                            <Sparkles size={19} aria-hidden="true" />
                        </span>
                        <strong>{boot.title}</strong>
                    </a>
                    <LanguagePicker />
                </header>
                <main className="minimal-landing-main">
                    <div className="minimal-landing-copy">
                    <span className="minimal-landing-eyebrow">
                        <span aria-hidden="true" />
                        {t("aiLabel")}
                    </span>
                    <h1>{t("aiTitle")}</h1>
                    <p>{t("aiIntro")}</p>
                    <a className="minimal-landing-enter" href="/app#/login">
                        {t("signIn")}{" "}
                        <span className="minimal-enter-icon">
                            <ArrowUpRight size={18} aria-hidden="true" />
                        </span>
                    </a>
                    <div className="minimal-scenarios">
                        <span><PenLine size={15} aria-hidden="true" />{t("scenario1")}</span>
                        <span><BookOpen size={15} aria-hidden="true" />{t("scenario2")}</span>
                        <span><Code2 size={15} aria-hidden="true" />{t("scenario3")}</span>
                    </div>
                    </div>
                    <section className="minimal-ai-panel" aria-label={t("aiLabel")}>
                        <div className="minimal-panel-heading"><Sparkles size={16} aria-hidden="true" /><span>{t("aiLabel")}</span><span className="minimal-panel-index" aria-hidden="true">01 / AI</span></div>
                        <div className="minimal-ai-core" aria-hidden="true">
                            <div className="minimal-core-ring" />
                            <div className="minimal-core-ring minimal-core-ring-inner" />
                            <div className="minimal-core-mark"><Sparkles size={24} /><strong>AI</strong></div>
                        </div>
                        <div className="minimal-ai-services">
                            {[["OpenAI", openaiIcon], ["Claude", claudeIcon], ["Gemini", geminiIcon]].map(([name, icon]) => (
                                <div className="minimal-ai-service" key={name}><img src={icon} alt="" /><span>{name}</span></div>
                            ))}
                        </div>
                        <p className="minimal-ai-note">{t("aiNote")}</p>
                    </section>
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
