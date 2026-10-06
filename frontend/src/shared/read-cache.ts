/** Short-lived, memory-only reads. A cleared cache never accepts an older response. */
export function createReadCache(ttl = 15000) {
    const values = new Map<string, { expires: number; value: unknown }>(),
        pending = new Map<string, Promise<unknown>>();
    let generation = 0;
    return {
        clear() {
            generation++;
            values.clear();
            pending.clear();
        },
        async read<T>(
            key: string,
            load: () => Promise<T>,
            fresh = false,
        ): Promise<T> {
            const running = pending.get(key);
            if (running) return running as Promise<T>;
            if (!fresh) {
                const cached = values.get(key);
                if (cached && cached.expires > Date.now())
                    return cached.value as T;
            }
            const current = generation;
            const promise = load();
            pending.set(key, promise);
            try {
                const value = await promise;
                if (current === generation && pending.get(key) === promise)
                    values.set(key, { value, expires: Date.now() + ttl });
                return value;
            } finally {
                if (pending.get(key) === promise) pending.delete(key);
            }
        },
    };
}
