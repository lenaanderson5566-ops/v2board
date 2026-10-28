import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
const storage = new Map<string, string>();
const pending = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => pending.get(k) || null,
    setItem: (k: string, v: string) => pending.set(k, v),
    removeItem: (k: string) => pending.delete(k),
});
vi.stubGlobal("window", { V2BOARD: { mode: "user" } });
vi.stubGlobal("document", { documentElement: { lang: "", dir: "" } });
vi.stubGlobal("navigator", { language: "zh-Hant-HK" });
vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) || null,
    setItem: (k: string, v: string) => storage.set(k, v),
});
const {
    default: i18n,
    languageReady,
    languages,
    resolvePreferredLanguage,
    changeLanguage,
    tx,
    languageKey,
    setLanguagePersistence,
    loginLanguagePreference,
    applyAccountLanguage,
} = await import("./i18n");
await languageReady;
const resources = Object.fromEntries(
    languages.map((l) => [
        l.code,
        JSON.parse(
            readFileSync(
                new URL(`../locales/${l.code}.json`, import.meta.url),
                "utf8",
            ),
        ) as Record<string, Record<string, string>>,
    ]),
);
const catalogs = Object.fromEntries(
    Object.entries(resources).map(([code, resource]) => [
        code,
        resource.translation,
    ]),
);
const placeholders = (v: string) =>
    [...v.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
await i18n.loadLanguages([
    "es-ES",
    "pt-BR",
    "fr-FR",
    "de-DE",
    "id-ID",
    "th-TH",
]);
describe("landing and interactive control translations", () => {
    for (const { code } of languages)
        it(`${code} provides every feature namespace without missing keys`, () => {
            for (const namespace of Object.keys(resources["en-US"]).filter(
                (namespace) => namespace !== "translation",
            )) {
                const base = resources["en-US"][namespace];
                const translated = resources[code][namespace];
                expect(translated, `${code}/${namespace}`).toBeTruthy();
                expect(Object.keys(translated).sort()).toEqual(
                    Object.keys(base).sort(),
                );
                for (const [key, value] of Object.entries(base)) {
                    expect(
                        translated[key],
                        `${code}/${namespace}/${key}`,
                    ).toBeTruthy();
                    expect(placeholders(translated[key])).toEqual(
                        placeholders(String(value)),
                    );
                }
            }
        });
    it("keeps public copy focused on assistant demonstrations", () => {
        for (const catalog of Object.values(resources))
            for (const value of Object.values(catalog.landing))
                expect(value).not.toMatch(/vpn|翻墙|代理|节点|订阅|流量/i);
    });
});
describe("localization resources", () => {
    it.each(["zh-CN", "zh-TW"])("%s uses formal interface copy and consistent account terminology", (code) => {
        // Check rendered catalog values; legacy lookup keys remain stable.
        const informal = /你|輕鬆|轻松|折腾|折騰|这里|這裡|怎么办|怎麼辦|换个|換個|没收到|沒收到|朋友|好友|一份心意|顺手|順手|账号|帐号|賬戶|賬號|帳號/;
        for (const [namespace, values] of Object.entries(resources[code]))
            for (const [key, value] of Object.entries(values))
                expect(value, `${code}/${namespace}/${key}`).not.toMatch(informal);
    });
    it("keeps user-facing server errors actionable without conversational interjections", () => {
        for (const code of ["zh-CN", "zh-TW", "en-US"]) {
            const messages = JSON.parse(readFileSync(new URL(`../../../resources/lang/${code}.json`, import.meta.url), "utf8"));
            for (const value of Object.values(messages))
                expect(String(value), code).not.toMatch(/Uh-oh|Oops|出了点|出了點|出现了点|出現了點|遇到了些|过一会儿|過一會兒|你的|我们正在|我們正在/);
        }
    });
    it("loads only the requested extra catalog and keeps language switching translated", async () => {
        expect(i18n.hasResourceBundle("zh-TW", "translation")).toBe(true);
        expect(i18n.hasResourceBundle("ja-JP", "translation")).toBe(false);
        await i18n.changeLanguage("ja-JP");
        expect(tx("登录")).toBe(catalogs["ja-JP"]["登录"]);
        expect(i18n.hasResourceBundle("ja-JP", "translation")).toBe(true);
        await i18n.changeLanguage("zh-TW");
    });
    for (const { code } of languages)
        it(`${code} covers every message and preserves interpolation`, () => {
            for (const [key, value] of Object.entries(catalogs["zh-CN"])) {
                expect(catalogs[code][key], `${code}: ${key}`).toBeTruthy();
                expect(placeholders(catalogs[code][key])).toEqual(
                    placeholders(value),
                );
            }
        });
    it("loads the matching namespaces for every language without index-based registration", async () => {
        for (const { code } of languages) {
            await changeLanguage(code);
            for (const [namespace, values] of Object.entries(resources[code])) {
                expect(
                    i18n.getResourceBundle(code, namespace),
                    `${code}/${namespace}`,
                ).toEqual(values);
            }
        }
    });
    it("does not retain the retired coupon-code entry messages", () => {
        for (const catalog of Object.values(catalogs)) {
            expect(catalog["使用优惠码"]).toBeUndefined();
            expect(catalog["优惠码（可选）"]).toBeUndefined();
            expect(catalog["领券中心"]).toBeUndefined();
            expect(catalog["暂无优惠券，可在下方领取"]).toBeUndefined();
        }
    });
    it("does not leave payment explanations in English in older language packs", () => {
        for (const code of ["ja-JP", "ko-KR", "vi-VN", "ru-RU", "fa-IR"])
            for (const key of [
                "实际付款",
                "订单与余额币种保持不变，付款金额按确认时的汇率锁定。",
            ])
                expect(catalogs[code][key], `${code}/${key}`).not.toBe(
                    catalogs["en-US"][key],
                );
    });
    it("all static user interface messages exist in the catalog", () => {
        const collect = (directory: URL): URL[] =>
            readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
                const path = new URL(
                    entry.name + (entry.isDirectory() ? "/" : ""),
                    directory,
                );
                return entry.isDirectory() ? collect(path) : [path];
            });
        const files = [
            ...collect(new URL("../user/", import.meta.url)),
            ...collect(new URL("./", import.meta.url)),
        ].filter(
            (path) =>
                /\.tsx?$/.test(path.pathname) &&
                !/\.test\./.test(path.pathname) &&
                // Native language names and administrator-only status labels are intentional.
                !/\/(language-options\.ts|admin-status\.tsx)$/.test(
                    path.pathname,
                ),
        );
        expect(files.length).toBeGreaterThan(90);
        for (const path of files) {
            const name = path.pathname;
            const source = ts.createSourceFile(
                name,
                readFileSync(path, "utf8"),
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TSX,
            );
            function visit(node: ts.Node) {
                if (
                    ts.isStringLiteral(node) &&
                    /[\u3400-\u9fff]/.test(node.text)
                )
                    expect(
                        catalogs["zh-CN"][node.text],
                        `${name}: ${node.text}`,
                    ).toBeTruthy();
                if (ts.isJsxText(node)) {
                    expect(
                        /[\u3400-\u9fff]/.test(node.text),
                        `${name}: unlocalized JSX`,
                    ).toBe(false);
                    // Product names, platform names, units and required provider attribution stay verbatim.
                    if (/[a-z]/i.test(node.text))
                        expect(
                            [
                                "FastAI ·",
                                "FastAI",
                                "Windows · macOS",
                                "iOS · Android",
                                "01 / AI",
                                "AI",
                                "Windows · macOS · iOS · Android",
                                "Rates By Exchange Rate API",
                                "ID ·",
                                "0 B",
                                "ID:",
                            ],
                            `${name}: hardcoded JSX: ${node.text.trim()}`,
                        ).toContain(node.text.trim());
                }
                ts.forEachChild(node, visit);
            }
            visit(source);
        }
    });
    it("keeps all selectors in stable language-code order", () => {
        const codes = languages.map(({ code }) => code);
        expect(codes.slice(1)).toEqual([...codes.slice(1)].sort());
        expect(new Set(codes).size).toBe(14);
        expect(codes[0]).toBe("en-US");
        expect(codes.slice(-2)).toEqual(["zh-CN", "zh-TW"]);
    });
    it("matches browser locales and provides a safe fallback", () => {
        expect(resolvePreferredLanguage(["zh-Hant-HK"])).toBe("zh-TW");
        expect(resolvePreferredLanguage(["ja"])).toBe("ja-JP");
        expect(resolvePreferredLanguage(["es-MX"])).toBe("es-ES");
        expect(resolvePreferredLanguage(["pt-PT"])).toBe("pt-BR");
        expect(resolvePreferredLanguage(["fa-AF"])).toBe("fa-IR");
        expect(resolvePreferredLanguage(["de-AT"])).toBe("de-DE");
        expect(resolvePreferredLanguage(["fr-CA"])).toBe("fr-FR");
        expect(resolvePreferredLanguage(["id"])).toBe("id-ID");
        expect(resolvePreferredLanguage(["th"])).toBe("th-TH");
        expect(resolvePreferredLanguage(["nl-NL"])).toBe("en-US");
    });
    it("persists language, updates document direction, and resolves plural forms", async () => {
        await changeLanguage("fa-IR");
        expect(document.documentElement.dir).toBe("rtl");
        expect(storage.get(languageKey)).toBe("fa-IR");
        await changeLanguage("en-US");
        expect(document.documentElement.lang).toBe("en-US");
        expect(document.documentElement.dir).toBe("ltr");
        expect(tx("{{count}} 台设备", { count: 1 })).toBe("1 device");
        expect(tx("{{count}} 台设备", { count: 2 })).toBe("2 devices");
        await changeLanguage("ru-RU");
        expect(tx("{{count}} 台设备", { count: 5 })).toBe("5 устройств");
        for (const code of ["es-ES", "pt-BR"]) {
            await changeLanguage(code);
            expect(document.documentElement.lang).toBe(code);
            expect(document.documentElement.dir).toBe("ltr");
            expect(tx("{{count}} 台设备", { count: 1 })).toBe("1 dispositivo");
            expect(tx("{{count}} 台设备", { count: 2 })).toBe("2 dispositivos");
        }
        await changeLanguage("ru-RU");
        await changeLanguage("unsupported");
        expect(i18n.language).toBe("ru-RU");
    });
    for (const { code } of languages.filter(
        (l) => !["zh-CN", "en-US"].includes(l.code),
    ))
        it(`${code} translates server errors with intact placeholders`, () => {
            const base = JSON.parse(
                readFileSync(
                    new URL(
                        "../../../resources/lang/en-US.json",
                        import.meta.url,
                    ),
                    "utf8",
                ),
            ) as Record<string, string>;
            const server = JSON.parse(
                readFileSync(
                    new URL(
                        `../../../resources/lang/${code}.json`,
                        import.meta.url,
                    ),
                    "utf8",
                ),
            ) as Record<string, string>;
            for (const [key, value] of Object.entries(base)) {
                expect(server[key], key).toBeTruthy();
                expect(
                    [...server[key].matchAll(/:\w+/g)].map((m) => m[0]).sort(),
                ).toEqual([...value.matchAll(/:\w+/g)].map((m) => m[0]).sort());
            }
        });
});

describe("account language preference", () => {
    it("preserves an explicit anonymous choice until successful authentication", async () => {
        setLanguagePersistence(async () => false);
        await changeLanguage("ja-JP");
        expect(loginLanguagePreference()).toEqual({
            language: "ja-JP",
            language_selected: true,
        });
        await applyAccountLanguage("ru-RU");
        expect(localeForTest()).toBe("ru-RU");
        expect(loginLanguagePreference().language_selected).toBe(false);
    });
    it("restores a supported account language without making another save", async () => {
        const save = vi.fn(async () => true);
        setLanguagePersistence(save);
        await applyAccountLanguage("fa-IR");
        expect(save).not.toHaveBeenCalled();
        expect(document.documentElement.dir).toBe("rtl");
        await changeLanguage("en-US");
        expect(save).toHaveBeenCalledWith("en-US");
        expect(loginLanguagePreference().language_selected).toBe(false);
    });
    it("keeps the old language when persistence fails and allows retry", async () => {
        await applyAccountLanguage("en-US");
        setLanguagePersistence(async () => {
            throw Error("save failed");
        });
        await expect(changeLanguage("ko-KR")).rejects.toThrow("save failed");
        expect(localeForTest()).toBe("en-US");
        expect(storage.get(languageKey)).toBe("en-US");
        setLanguagePersistence(async () => true);
        await changeLanguage("ko-KR");
        expect(localeForTest()).toBe("ko-KR");
        await applyAccountLanguage("unsupported");
        expect(localeForTest()).toBe("ko-KR");
    });
});
function localeForTest() {
    return i18n.resolvedLanguage;
}

it("formats scheduled reset timestamps in the selected display zone", async () => {
    const { minuteDate } = await import("./credit-copy");
    const { setDisplayTimeZone } = await import("./timezone");
    await i18n.changeLanguage("zh-CN");
    const at = Date.parse("2026-10-07T13:51:37Z") / 1000;
    try {
        setDisplayTimeZone("Asia/Shanghai");
        const output = minuteDate(at);
        expect(output).toContain("21:51");
        expect(output).not.toContain("21:51:37");
        expect(output).toContain("GMT+8");
        setDisplayTimeZone("UTC");
        expect(minuteDate(at, "Asia/Shanghai")).toContain("13:51");
        expect(minuteDate(null)).toBe("—");
    } finally {
        setDisplayTimeZone(null);
    }
});
