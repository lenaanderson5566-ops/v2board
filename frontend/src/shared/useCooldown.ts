import { useEffect, useState } from "react";

/** Disable repeat sends until the deadline, including while the tab is hidden. */
export function useCooldown(seconds = 60) {
    const [until, setUntil] = useState(0);
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!until) return;
        const timer = setTimeout(
            () => setUntil(0),
            Math.max(0, until - Date.now()),
        );
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => {
            clearTimeout(timer);
            clearInterval(tick);
        };
    }, [until]);
    return {
        active: until > Date.now(),
        remaining: Math.max(0, Math.ceil((until - now) / 1000)),
        start: () => {
            setNow(Date.now());
            setUntil(Date.now() + seconds * 1000);
        },
        reset: () => setUntil(0),
    };
}
