// Legacy names are retained only to read preferences and finish revocation.
// JavaScript-readable authentication credentials are never read or migrated.
function legacyPreferenceKey(key: string): string | null {
    return key.startsWith("fastai.") ? "v2board." + key.slice(7) : null;
}
export function preferenceStorageEvent(eventKey: string | null, key: string): boolean {
    return eventKey === null || eventKey === key || eventKey === legacyPreferenceKey(key);
}
function mirrorForOlderTabs(key: string): boolean {
    return key.endsWith(".sessionRevision") || key.endsWith(".auth.pendingLogout") || key.startsWith("fastai.analytics.consent.");
}

/** Cookie authentication never depends on preferences stored in Web Storage. */
function optionalStorage(kind: "localStorage" | "sessionStorage") {
    const memory = new Map<string, string | null>();
    const persistentRead = (key: string): string | null => {
        try { return globalThis[kind].getItem(key); }
        catch { return null; }
    };
    const read = (key: string): string | null => {
        if (memory.has(key)) return memory.get(key) ?? null;
        return persistentRead(key);
    };
    const write = (key: string, value: string, temporary: boolean): boolean => {
        try { globalThis[kind].setItem(key, value); memory.delete(key); return true; }
        catch { if (temporary) memory.set(key, value); return false; }
    };
    const candidates = (key: string): (string | null)[] => {
        if (key.endsWith(".auth")) return [];
        const legacy = legacyPreferenceKey(key);
        return legacy ? [read(key), read(legacy)] : [read(key)];
    };
    const store = (key: string, value: string, temporary: boolean, withdrawal = false): boolean => {
        if (key.endsWith(".auth")) return false;
        const persisted = write(key, value, temporary);
        const legacy = legacyPreferenceKey(key);
        // Revocations, account changes and consent withdrawals must reach old tabs.
        if (legacy && mirrorForOlderTabs(key) && (persisted || withdrawal || !key.startsWith("fastai.analytics.consent."))) write(legacy, value, temporary || withdrawal);
        if (!persisted && withdrawal) memory.set(key, value);
        return persisted;
    };
    return {
        /** A previous write exists only in this page's fallback memory. */
        isTemporary(key: string): boolean { return memory.has(key) || memory.has(legacyPreferenceKey(key) || key); },
        getItem(key: string): string | null {
            return candidates(key).find(value => key.endsWith(".auth.pendingLogout") ? !!value : value !== null) ?? null;
        },
        getCandidates: candidates,
        /** Observe both generations, even when a newer key already exists. */
        revision(key: string): string | null {
            if (key.endsWith(".auth")) return null;
            const legacy = legacyPreferenceKey(key);
            // A failed local write must not mask later changes from another tab.
            const values = legacy ? [persistentRead(key),persistentRead(legacy)] : [persistentRead(key)];
            return values.some(value => value !== null) ? JSON.stringify(values) : null;
        },
        setItem(key: string, value: string): boolean { return store(key, value, true); },
        setPersistentItem(key: string, value: string): boolean { return store(key, value, false); },
        /** Withdrawal applies now; a failed durable write still returns false. */
        setConsent(key: string, value: string, denied: boolean): boolean { return store(key, value, false, denied); },
        removeItem(key: string): void {
            for (const candidate of [key, legacyPreferenceKey(key)].filter((value): value is string => value !== null)) {
                try { globalThis[kind].removeItem(candidate); memory.delete(candidate); }
                catch { memory.set(candidate, null); }
            }
        },
    };
}
export const localPreferences = optionalStorage("localStorage");
export const sessionPreferences = optionalStorage("sessionStorage");
