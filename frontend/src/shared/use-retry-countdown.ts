import { useEffect, useState } from "react";

export function useRetryCountdown(retryAt = 0) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        setNow(Date.now());
        if (retryAt <= Date.now()) return;
        const timer = window.setInterval(() => {
            const current = Date.now();
            setNow(current);
            if (current >= retryAt) window.clearInterval(timer);
        }, 1000);
        return () => window.clearInterval(timer);
    }, [retryAt]);
    return Math.max(0, Math.ceil((retryAt - now) / 1000));
}
