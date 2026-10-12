import { useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { State, useData } from "../shared/ui";

const clients: [string, string][] = [
    ["meta", "Mihomo / CMFA"],
    ["sing", "sing-box / Hiddify / SFA / SFI / SFM / SFT"],
    ["verge", "Clash Verge"],
    ["flclash", "FlClash"],
    ["nyanpasu", "Clash Nyanpasu"],
    ["clashforandroid", "Clash for Android"],
    ["clashforwindows", "Clash for Windows"],
    ["clashx", "ClashX"],
    ["shadowrocket", "Shadowrocket"],
    ["surge", "Surge"],
    ["stash", "Stash"],
    ["quantumult%20x", "Quantumult X"],
    ["loon", "Loon"],
    ["surfboard", "Surfboard"],
    ["sagernet", "SagerNet"],
    ["passwall", "Passwall"],
    ["ssrplus", "SSRPlus"],
    ["shadowsocks", "Shadowsocks"],
    ["v2rayn", "v2rayN"],
    ["v2rayng", "v2rayNG"],
    ["v2raytun", "v2RayTun"],
];

export function AdminClientWhitelist() {
    const d = useData<Row>(admin("config/fetch"));
    const [changes, setChanges] = useState<Row>({});
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const enabled =
        changes.subscription_ua_whitelist_enabled ??
        d.data?.app?.subscription_ua_whitelist_enabled ??
        0;
    const selected: string[] =
        changes.subscription_ua_whitelist ??
        d.data?.app?.subscription_ua_whitelist ??
        [];
    return (
        <section className="release-card">
            <h3>订阅访问保护</h3>
            <p className="muted">
                未知 UA 和 General 通用兜底已停止开放。Linux 没有独立
                UA，按实际运行的客户端识别；已识别的 v2rayN
                等客户端仍可获取自己的 URI 配置。格式参数只能选择兼容格式。
            </p>
            <p className="muted">
                开启后，仅允许所选客户端的 UA 拉取订阅；空
                UA、浏览器和未知客户端会返回 403。订阅链接的 flag
                只选择格式，不能作为白名单凭证。客户端禁用与最低版本限制仍然生效。
            </p>
            <p className="muted">
                UA
                可被伪造，此功能用于限制兼容客户端，不替代身份认证。专用客户端使用独立认证入口，不受本白名单影响。共用内核
                UA 的应用按内核归类。
            </p>
            <State {...d} retry={d.reload}>
                <div className="release-grid">
                    {(
                        [
                            [
                                "subscription_ip_minute_limit",
                                "每 IP 每分钟上限",
                                120,
                                10000,
                            ],
                            [
                                "subscription_user_minute_limit",
                                "每账号每分钟上限",
                                30,
                                1000,
                            ],
                            [
                                "subscription_user_day_limit",
                                "每账号 24 小时窗口上限",
                                240,
                                100000,
                            ],
                        ] as const
                    ).map(([key, label, fallback, max]) => (
                        <label key={key}>
                            {label}
                            <input
                                type="number"
                                min={1}
                                max={max}
                                disabled={busy}
                                value={
                                    changes[key] ??
                                    d.data?.app?.[key] ??
                                    fallback
                                }
                                onChange={(e) =>
                                    setChanges({
                                        ...changes,
                                        [key]:
                                            e.target.value === ""
                                                ? ""
                                                : Number(e.target.value),
                                    })
                                }
                            />
                        </label>
                    ))}
                </div>
                <p className="muted">
                    固定窗口从首次请求起计时，账号额度跨 IP、UA
                    和配置接口累计。超限返回 429 和重试等待时间；IP/UA
                    黑名单优先拒绝。
                </p>
                <label>
                    <input
                        type="checkbox"
                        checked={Boolean(enabled)}
                        disabled={busy}
                        onChange={(e) =>
                            setChanges({
                                ...changes,
                                subscription_ua_whitelist_enabled: Number(
                                    e.target.checked,
                                ),
                            })
                        }
                    />
                    开启 UA 白名单
                </label>
                <div className="release-grid">
                    {clients.map(([id, label]) => (
                        <label key={id}>
                            <input
                                type="checkbox"
                                checked={selected.includes(id)}
                                disabled={busy}
                                onChange={(e) =>
                                    setChanges({
                                        ...changes,
                                        subscription_ua_whitelist: e.target
                                            .checked
                                            ? [...selected, id]
                                            : selected.filter((v) => v !== id),
                                    })
                                }
                            />
                            {label}
                        </label>
                    ))}
                </div>
                <button
                    disabled={
                        busy ||
                        !Object.keys(changes).length ||
                        (Boolean(enabled) && !selected.length)
                    }
                    onClick={async () => {
                        setBusy(true);
                        setMessage("");
                        try {
                            await request(admin("config/save"), {
                                ...changes,
                                subscription_ua_whitelist_enabled:
                                    Number(enabled),
                                subscription_ua_whitelist: selected,
                            });
                            d.reload();
                            setChanges({});
                            setMessage("访问策略已保存");
                        } catch (e) {
                            setMessage((e as Error).message);
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    保存访问策略
                </button>
                {Boolean(enabled) && !selected.length && (
                    <p role="status">请选择至少一个客户端。</p>
                )}
                {message && <p role="status">{message}</p>}
            </State>
        </section>
    );
}
