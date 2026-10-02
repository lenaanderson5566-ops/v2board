import { useEffect, useRef, useState } from "react";
import { Settings, ReceiptText, Activity, Users, LogOut } from "lucide-react";
import { type Row } from "./api";
import { useData } from "./ui";
import { tx } from "./i18n";
import { e } from "./experience-copy";
import { activePlan } from "./user-experience";
export function AccountMenu({
    user,
    logout,
}: {
    user: Row;
    logout: () => void;
}) {
    const sub = useData("user/getSubscribe");
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null),
        trigger = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpen(false);
                trigger.current?.focus();
            }
        };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("keydown", escape);
        };
    }, [open]);
    const [clock, setClock] = useState(0);
    useEffect(() => {
        const expiry = Number(sub.data?.expired_at) * 1000;
        const remaining = expiry - Date.now();
        if (!sub.data?.plan || !Number.isFinite(remaining) || remaining <= 0)
            return;
        const timer = setTimeout(
            () => setClock((v) => v + 1),
            Math.min(remaining + 1, 2147483647),
        );
        return () => clearTimeout(timer);
    }, [sub.data, clock]);
    const valid = activePlan(sub.data?.plan, sub.data?.expired_at);
    const plan = sub.data?.plan?.name || "";
    return (
        <div className="account-control" ref={root}>
            <button
                ref={trigger}
                className="account-trigger"
                aria-label={e("account")}
                aria-expanded={open}
                aria-controls="account-popover"
                onClick={() => setOpen(!open)}
            >
                <span className="letter-avatar">
                    {String(user.email || "?")
                        .trim()
                        .slice(0, 1)
                        .toUpperCase()}
                    {valid && (
                        <span className="avatar-plan" title={plan}>
                            {plan}
                        </span>
                    )}
                </span>
            </button>
            {open && (
                <div id="account-popover" className="account-popover">
                    <strong dir="ltr">{user.email}</strong>
                    <small>
                        {valid ? e("activePlan", { plan }) : e("noPlan")}
                    </small>
                    {[
                        { key: "profile", label: "账户设置", icon: Settings },
                        { key: "order", label: "订单记录", icon: ReceiptText },
                        { key: "traffic", label: "流量记录", icon: Activity },
                        { key: "invite", label: "邀请好友", icon: Users },
                    ].map(({ key, label, icon: Icon }) => (
                        <a
                            key={key}
                            href={"#/" + key}
                            onClick={() => setOpen(false)}
                        >
                            <Icon size={17} />
                            {tx(label)}
                        </a>
                    ))}
                    <button onClick={logout}>
                        <LogOut size={17} />
                        {tx("退出登录")}
                    </button>
                </div>
            )}
        </div>
    );
}
