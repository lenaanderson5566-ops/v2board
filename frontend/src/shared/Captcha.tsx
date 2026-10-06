import { useEffect, useRef } from "react";
import { boot } from "./api";
export function Captcha({ onChange }: { onChange: (value: string) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!boot.recaptchaSiteKey) return;
        let live = true;
        let id: number | undefined;
        const render = () => {
            if (live && ref.current && window.grecaptcha) {
                id = window.grecaptcha.render(ref.current, {
                    sitekey: boot.recaptchaSiteKey,
                    callback: onChange,
                    "expired-callback": () => onChange(""),
                });
            }
        };
        let script =
            document.querySelector<HTMLScriptElement>("#recaptcha-loader");
        if (window.grecaptcha) render();
        else {
            if (!script) {
                script = document.createElement("script");
                script.id = "recaptcha-loader";
                script.src =
                    "https://www.google.com/recaptcha/api.js?render=explicit";
                document.head.appendChild(script);
            }
            script.addEventListener("load", render);
        }
        return () => {
            live = false;
            if (script) script.removeEventListener("load", render);
            if (id !== undefined) window.grecaptcha?.reset(id);
        };
    }, []);
    return boot.recaptchaSiteKey ? <div ref={ref} /> : null;
}
