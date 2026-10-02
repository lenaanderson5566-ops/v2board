import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    Plus,
    ArrowUpRight,
    ArrowRight,
    Sparkles,
    Laptop,
    Smartphone,
    Check,
    Menu,
    X,
    SlidersHorizontal,
    BookOpen,
    ChevronRight,
} from "lucide-react";
import { boot } from "./api";
import { currentDevice } from "./user-experience";
import "./landing-copy";
import "./landing.css";
import { LanguagePicker } from "./LanguagePicker";

const devices = ["Windows", "macOS", "Android", "iOS"];
export default function Landing() {
    const { t } = useTranslation("landing");
    const [menu, setMenu] = useState(false);
    const [device, setDevice] = useState(() => {
        const detected = currentDevice().device;
        return (
            devices.find((name) => name.toLowerCase() === detected) || "Windows"
        );
    });
    const menuButton = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!menu) return;
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setMenu(false);
                menuButton.current?.focus();
            }
        };
        window.addEventListener("keydown", escape);
        return () => window.removeEventListener("keydown", escape);
    }, [menu]);
    const startHref = boot.registerClosed || boot.inviteRequired ? "/app#/login" : "/app#/register";
    return (
        <div className="landing">
            <a className="product-skip" href="#landing-content">
                {t("skip")}
            </a>
            <header className="landing-header">
                <a className="studio-brand" href="/" aria-label={boot.title}>
                    <span className="product-mark">
                        <Sparkles size={21} aria-hidden="true" />
                    </span>
                    <strong>{boot.title}</strong>
                </a>
                <nav
                    className={menu ? "landing-links open" : "landing-links"}
                    aria-label={t("examples")}
                    id="landing-navigation"
                    onClick={() => setMenu(false)}
                >
                    <a href="#setup">{t("examples")}</a>
                    <a href="#approach">{t("about")}</a>
                    <a href="#questions">{t("questions")}</a>
                </nav>
                <div className="landing-controls">
                    <LanguagePicker />
                    <a className="landing-login" href="/app#/login">
                        {t("signIn")}
                        <ArrowUpRight size={15} aria-hidden="true" />
                    </a>
                    <button
                        ref={menuButton}
                        className="landing-menu icon-button"
                        aria-controls="landing-navigation"
                        aria-expanded={menu}
                        aria-label={t("examples")}
                        onClick={() => setMenu(!menu)}
                    >
                        {menu ? <X size={20} /> : <Menu size={20} />}
                    </button>
                </div>
            </header>
            <main className="landing-main" id="landing-content" tabIndex={-1}>
                <section className="landing-hero">
                    <div className="landing-hero-copy">
                        <span className="studio-kicker">
                            <Sparkles size={14} aria-hidden="true" />
                            {t("tag")}
                        </span>
                        <h1>{t("title")}</h1>
                        <p>{t("intro")}</p>
                        <div className="landing-cta">
                            <a className="button primary" href={startHref}>
                                {t("start")}
                                <ArrowRight size={17} aria-hidden="true" />
                            </a>
                            <a className="button secondary" href="#setup">
                                {t("seeDemo")}
                                <ChevronRight size={17} aria-hidden="true" />
                            </a>
                        </div>
                        <div
                            className="landing-platforms"
                            aria-label={t("step1")}
                        >
                            <Laptop size={15} aria-hidden="true" />
                            <span>Windows · macOS</span>
                            <span className="platform-divider" />
                            <Smartphone size={15} aria-hidden="true" />
                            <span>iOS · Android</span>
                        </div>
                    </div>
                    <div className="landing-product-preview">
                        <div className="preview-top">
                            <span className="preview-brand">
                                <Sparkles size={15} />
                                {boot.title}
                            </span>
                            <span>{t("preview")}</span>
                        </div>
                        <div className="preview-body">
                            <span className="preview-eyebrow" dir="ltr">01 / 03</span>
                            <h2>{t("step1")}</h2>
                            <p>{t("step1Text")}</p>
                            <div
                                className="preview-device-picker"
                                role="group"
                                aria-label={t("step1")}
                            >
                                {devices.map((name) => {
                                    const Icon = ["iOS", "Android"].includes(
                                        name,
                                    )
                                        ? Smartphone
                                        : Laptop;
                                    return (
                                        <button
                                            key={name}
                                            aria-pressed={device === name}
                                            onClick={() => setDevice(name)}
                                        >
                                            <Icon
                                                size={22}
                                                aria-hidden="true"
                                            />
                                            <span>{name}</span>
                                            {device === name && (
                                                <Check
                                                    size={13}
                                                    className="device-check"
                                                    aria-hidden="true"
                                                />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="preview-next" aria-live="polite">
                                <span className="preview-next-icon">
                                    <SlidersHorizontal size={18} />
                                </span>
                                <div>
                                    <strong>{device}</strong>
                                    <p>{t("step2Text")}</p>
                                </div>
                                <ChevronRight size={16} aria-hidden="true" />
                            </div>
                            <a
                                className="button primary preview-start"
                                href={startHref}
                            >
                                {t("start")}
                                <ArrowRight size={16} aria-hidden="true" />
                            </a>
                            <small className="preview-caption">
                                {t("previewNote")}
                            </small>
                        </div>
                    </div>
                </section>
                <section className="landing-setup" id="setup">
                    <div className="landing-section-heading">
                        <span className="studio-kicker">{t("examples")}</span>
                        <h2>{t("setupTitle")}</h2>
                    </div>
                    <ol className="setup-steps">
                        {[Laptop, SlidersHorizontal, Sparkles].map(
                            (Icon, index) => (
                                <li key={index}>
                                    <div className="setup-step-top">
                                        <span className="setup-step-icon">
                                            <Icon
                                                size={22}
                                                aria-hidden="true"
                                            />
                                        </span>
                                        <span className="setup-step-number">
                                            0{index + 1}
                                        </span>
                                    </div>
                                    <h3>{t("step" + (index + 1))}</h3>
                                    <p>{t("step" + (index + 1) + "Text")}</p>
                                </li>
                            ),
                        )}
                    </ol>
                </section>
                <section className="landing-approach" id="approach">
                    <div className="approach-copy">
                        <span className="studio-kicker">{t("about")}</span>
                        <h2>{t("approachTitle")}</h2>
                        <p>{t("approachText")}</p>
                    </div>
                    <div className="idea-stack">
                        {[
                            {
                                icon: SlidersHorizontal,
                                label: "step1",
                                detail: "step1Text",
                                href: "/app#/subscribe",
                            },
                            {
                                icon: BookOpen,
                                label: "about",
                                detail: "step3Text",
                                href: "/app#/knowledge",
                            },
                        ].map(({ icon: Icon, label, detail, href }) => (
                            <a href={href} key={label}>
                                <span className="idea-icon">
                                    <Icon size={21} aria-hidden="true" />
                                </span>
                                <div>
                                    <strong>{t(label)}</strong>
                                    <p>{t(detail)}</p>
                                </div>
                                <ArrowUpRight size={18} aria-hidden="true" />
                            </a>
                        ))}
                    </div>
                </section>
                <section className="landing-faq" id="questions">
                    <div>
                        <span className="studio-kicker">
                            {t("beforeStart")}
                        </span>
                        <h2>{t("questions")}</h2>
                    </div>
                    <div>
                        {[1, 2, 3, 4].map((index) => (
                            <details key={index}>
                                <summary>
                                    {t("q" + index)}
                                    <Plus size={18} aria-hidden="true" />
                                </summary>
                                <p>{t("a" + index)}</p>
                            </details>
                        ))}
                    </div>
                </section>
                <section className="landing-closing">
                    <Sparkles size={28} aria-hidden="true" />
                    <h2>{t("title")}</h2>
                    <p>{t("footer")}</p>
                    <a className="button primary" href={startHref}>
                        {t("start")}
                        <ArrowRight size={17} aria-hidden="true" />
                    </a>
                </section>
            </main>
            <footer className="landing-footer">
                <a className="studio-brand" href="/">
                    <Sparkles size={19} aria-hidden="true" />
                    <strong>{boot.title}</strong>
                </a>
                <p>{t("footer")}</p>
                <div>
                    <a href="/app#/knowledge">{t("about")}</a>
                    {boot.tosUrl && (
                        <a
                            href={boot.tosUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {t("terms")}
                        </a>
                    )}
                    <a href="/app#/login">
                        {t("signIn")}
                        <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                </div>
            </footer>
        </div>
    );
}
