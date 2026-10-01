export type Row = Record<string, any>;
export interface Envelope<T> {
    data: T;
    total?: number;
    type?: number;
    message?: string;
    errors?: Record<string, string[]>;
}
export interface Boot {
    mode: "user" | "admin";
    title: string;
    description: string;
    adminPath: string;
    opsPath: string;
    emailVerify: boolean;
    registerClosed: boolean;
    recaptchaSiteKey: string;
    tosUrl: string;
    currencySymbol: string;
}
declare global {
    interface Window {
        V2BOARD: Boot;
        grecaptcha?: {
            render: (el: HTMLElement, opts: Row) => number;
            reset: (id: number) => void;
        };
    }
}
export const boot = window.V2BOARD;
export const storageKey = `v2board.${boot.mode}.auth`;
export const admin = (path: string) => `${boot.adminPath}/${path}`;
export const ops = (path: string) => `${boot.opsPath}/${path}`;
export async function request<T = Row>(
    path: string,
    body?: Row,
): Promise<Envelope<T>> {
    const token = localStorage.getItem(storageKey);
    const res = await fetch(`/api/v1/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(token ? { Authorization: token } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let json: Envelope<T>;
    try {
        json = await res.json();
    } catch {
        throw new Error(`服务响应异常 (${res.status})`);
    }
    if (!res.ok) {
        if ((res.status === 403 || res.status === 401) && token) {
            localStorage.removeItem(storageKey);
            window.dispatchEvent(new Event("auth-expired"));
        }
        throw new Error(
            Object.values(json.errors || {})
                .flat()
                .join("；") ||
                json.message ||
                `请求失败 (${res.status})`,
        );
    }
    return json;
}
export function query(path: string, params: Row): string {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== "" && v !== null && v !== undefined) q.set(k, String(v));
    });
    return path + "?" + q;
}
export function rows(data: unknown): Row[] {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object")
        return Object.values(data)
            .flat()
            .filter((x) => x && typeof x === "object");
    return [];
}
export const money = (n: unknown) =>
    `${boot.currencySymbol}${(Number(n || 0) / 100).toFixed(2)}`;
export const bytes = (n: unknown) => {
    let v = Number(n || 0),
        i = 0;
    const units = ["B", "KB", "MB", "GB", "TB"];
    while (v >= 1024 && i < 4) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(i ? 2 : 0)} ${units[i]}`;
};
export const date = (n: unknown) =>
    n ? new Date(Number(n) * 1000).toLocaleString("zh-CN") : "—";
export const navigate = (path: string) => {
    location.hash = "/" + path;
};
