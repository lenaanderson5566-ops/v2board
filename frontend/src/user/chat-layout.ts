// Crisp class names change between releases. Locate only the small fixed launcher,
// leaving the full-screen conversation panel untouched.
export function installChatLayout() {
    let frame = 0;
    let disposed = false;
    const watched = new Set<Element>();
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(update); };
    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
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
        const bars = [...document.querySelectorAll<HTMLElement>(".purchase-footer, .checkout-confirm")];
        const targets = new Set<Element>([...(nav ? [nav] : []), ...bars]);
        watched.forEach((element) => {
            if (!targets.has(element)) { resizeObserver?.unobserve(element); watched.delete(element); }
        });
        targets.forEach((element) => {
            if (!watched.has(element)) { resizeObserver?.observe(element); watched.add(element); }
        });
        let clearance = height;
        if (mobile) bars.forEach((bar) => {
            const style = getComputedStyle(bar);
            const box = bar.getBoundingClientRect();
            const inset = Number.parseFloat(style.bottom);
            const floating = style.position === "fixed" || (style.position === "sticky"
                && Number.isFinite(inset) && box.bottom >= window.innerHeight - inset - 1);
            if (floating && style.visibility !== "hidden" && style.display !== "none"
                && box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight
                && box.right > 0 && box.left < window.innerWidth)
                clearance = Math.max(clearance, window.innerHeight - Math.max(0, box.top));
        });
        const offset = `${clearance + 16}px`;
        if (document.documentElement.style.getPropertyValue("--chat-navigation-offset") !== offset)
            document.documentElement.style.setProperty("--chat-navigation-offset", offset);
        document.querySelectorAll<HTMLElement>(".crisp-client *").forEach((element) => {
            const box = element.getBoundingClientRect();
            const launcher = mobile && clearance > 0 && getComputedStyle(element).position === "fixed"
                && box.width > 20 && box.width <= 160 && box.height > 20 && box.height <= 160
                && (original.has(element) || box.bottom > window.innerHeight / 2);
            if (launcher) {
                if (!original.has(element)) original.set(element, {
                    value: element.style.getPropertyValue("bottom"), priority: element.style.getPropertyPriority("bottom"),
                });
                element.setAttribute("data-chat-launcher", "");
                const launcherOffset = `${Math.max(16, Math.min(clearance + 16, window.innerHeight - box.height - 16))}px`;
                if (element.style.getPropertyValue("bottom") !== launcherOffset || element.style.getPropertyPriority("bottom") !== "important")
                    element.style.setProperty("bottom", launcherOffset, "important");
            } else restore(element);
        });
        [...original.keys()].filter((element) => !element.isConnected).forEach(restore);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "data-maximized", "data-hidden", "data-id"] });
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    schedule();
    return () => {
        disposed = true;
        observer.disconnect(); resizeObserver?.disconnect(); cancelAnimationFrame(frame);
        window.removeEventListener("resize", schedule);
        document.removeEventListener("scroll", schedule, true);
        [...original.keys()].forEach(restore);
        document.documentElement.style.removeProperty("--chat-navigation-offset");
    };
}
