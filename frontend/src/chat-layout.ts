// Crisp class names change between releases. Locate only the small fixed launcher,
// leaving the full-screen conversation panel untouched.
export function installChatLayout() {
    let frame = 0;
    const update = () => {
        frame = 0;
        const nav = document.querySelector<HTMLElement>(".bottom-nav");
        const mobile = window.matchMedia("(max-width: 800px)").matches;
        const height = mobile && nav ? nav.getBoundingClientRect().height : 0;
        const offset = `${height + 16}px`;
        if (document.documentElement.style.getPropertyValue("--chat-navigation-offset") !== offset)
            document.documentElement.style.setProperty("--chat-navigation-offset", offset);
        document.querySelectorAll<HTMLElement>(".crisp-client *").forEach((element) => {
            const box = element.getBoundingClientRect();
            const launcher = mobile && height > 0 && getComputedStyle(element).position === "fixed"
                && box.width > 20 && box.width <= 160 && box.height > 20 && box.height <= 160
                && box.bottom > window.innerHeight / 2;
            if (launcher && !element.hasAttribute("data-chat-launcher")) element.setAttribute("data-chat-launcher", "");
            else if (!launcher && element.hasAttribute("data-chat-launcher")) element.removeAttribute("data-chat-launcher");
        });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
        observer.disconnect(); cancelAnimationFrame(frame);
        window.removeEventListener("resize", schedule);
        document.querySelectorAll("[data-chat-launcher]").forEach((el) => el.removeAttribute("data-chat-launcher"));
        document.documentElement.style.removeProperty("--chat-navigation-offset");
    };
}
