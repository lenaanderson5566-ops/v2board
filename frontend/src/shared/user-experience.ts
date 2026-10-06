export type Device =
    "ios" | "android" | "windows" | "macos" | "linux" | "unknown";
export function deviceContext(
    ua: string,
    platform = "",
    touchPoints = 0,
): { device: Device; embedded: string | null } {
    const embedded = /MicroMessenger/i.test(ua)
        ? "WeChat"
        : /\bQQ\//i.test(ua)
          ? "QQ"
          : /Weibo/i.test(ua)
            ? "Weibo"
            : null;
    const identity = `${ua} ${platform}`;
    const device: Device =
        /iPhone|iPad|iPod/i.test(ua) ||
        (/Mac/i.test(identity) && touchPoints > 1)
            ? "ios"
            : /Android/i.test(ua)
              ? "android"
              : /Windows|Win32|Win64/i.test(identity)
                ? "windows"
                : /Mac/i.test(identity)
                  ? "macos"
                  : /Linux/i.test(identity)
                    ? "linux"
                    : "unknown";
    return { device, embedded };
}
export function currentDevice() {
    return deviceContext(
        navigator.userAgent,
        navigator.platform,
        navigator.maxTouchPoints,
    );
}
export function activePlan(
    plan: unknown,
    expiredAt: unknown,
    now = Date.now(),
): boolean {
    return !!plan && (expiredAt === null || Number(expiredAt) * 1000 > now);
}
export function passwordScore(value: string): number {
    if (!value) return 0;
    if (/^(.)\1+$/.test(value) || /123456|qwerty|password/i.test(value))
        return 1;
    const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((pattern) =>
        pattern.test(value),
    ).length;
    return value.length < 8
        ? 1
        : Math.min(
              5,
              2 +
                  Number(value.length >= 12) +
                  Number(value.length >= 16) +
                  Number(variety >= 3),
          );
}
