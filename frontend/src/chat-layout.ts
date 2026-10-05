// Crisp class names change between releases. Locate only the small fixed launcher,
// leaving the full-screen conversation panel untouched.
export function installChatLayout() {
    let frame = 0;
    const original = new Map<HTMLElement, { value: string; priority: string }>();
    const restore = (element: HTMLElement) => {
        const saved = original.get(element);
        if (!saved) return;
        if (saved.value) element.style.setProperty("bottom", saved.value, saved.priority);
        else element.style.removeProperty("bottom");
        element.removeAttribute("data-chat-launcher");
        original.delete(element);
    };
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
            if (launcher) {
                if (!original.has(element)) original.set(element, {
                    value: element.style.getPropertyValue("bottom"), priority: element.style.getPropertyPriority("bottom"),
                });
                element.setAttribute("data-chat-launcher", "");
                if (element.style.getPropertyValue("bottom") !== offset || element.style.getPropertyPriority("bottom") !== "important")
                    element.style.setProperty("bottom", offset, "important");
            } else restore(element);
        });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "data-maximized", "data-hidden", "data-id"] });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
        observer.disconnect(); cancelAnimationFrame(frame);
        window.removeEventListener("resize", schedule);
        [...original.keys()].forEach(restore);
        document.documentElement.style.removeProperty("--chat-navigation-offset");
    };
}
