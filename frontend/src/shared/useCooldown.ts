import { useEffect, useState } from "react";

/** Disable repeat sends until the deadline, including while the tab is hidden. */
export function useCooldown(seconds = 60) {
    const [until, setUntil] = useState(0);
    useEffect(() => {
        if (!until) return;
        const timer = setTimeout(
            () => setUntil(0),
            Math.max(0, until - Date.now()),
        );
        return () => clearTimeout(timer);
    }, [until]);
    return {
        active: until > Date.now(),
        start: () => setUntil(Date.now() + seconds * 1000),
        reset: () => setUntil(0),
    };
}
