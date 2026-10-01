import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
const storage = new Map<string, string>();
vi.stubGlobal("window", { V2BOARD: { mode: "user" } });
vi.stubGlobal("document", { documentElement: { lang: "", dir: "" } });
vi.stubGlobal("navigator", { language: "zh-Hant-HK" });
vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) || null,
    setItem: (k: string, v: string) => storage.set(k, v),
});
const {
    default: i18n,
    languages,
    resolveLanguage,
    changeLanguage,
    tx,
    languageKey,
} = await import("./i18n");
const catalogs = Object.fromEntries(
    languages.map((l) => [
        l.code,
        JSON.parse(
            readFileSync(
                new URL(`./locales/${l.code}.json`, import.meta.url),
                "utf8",
            ),
        ) as Record<string, string>,
    ]),
);
const placeholders = (v: string) =>
    [...v.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
const {landingCopy}=await import('./landing-copy');
await import('./ux');
describe('landing and interactive control translations',()=>{
 for(const {code} of languages) it(`${code} provides landing and control namespaces`,()=>{
  for(const namespace of ['landing','ux']){
   const base=i18n.getResourceBundle('zh-CN',namespace);
   const translated=i18n.getResourceBundle(code,namespace);
   for(const [key,value] of Object.entries(base)){
    expect(translated[key],`${code}/${namespace}/${key}`).toBeTruthy();
    expect(placeholders(translated[key])).toEqual(placeholders(String(value)));
   }
  }
 });
 it('keeps public copy focused on assistant demonstrations',()=>{
  for(const values of Object.values(landingCopy)) for(const value of values) expect(value).not.toMatch(/vpn|翻墙|代理|节点|订阅|流量/i);
 });
});
describe("localization resources", () => {
    for (const { code } of languages)
        it(`${code} covers every message and preserves interpolation`, () => {
            for (const [key, value] of Object.entries(catalogs["zh-CN"])) {
                expect(catalogs[code][key], `${code}: ${key}`).toBeTruthy();
                expect(placeholders(catalogs[code][key])).toEqual(
                    placeholders(value),
                );
            }
        });
    it("all static user interface messages exist in the catalog", () => {
        for (const name of [
            "main.tsx",
            "user.tsx",
            "ui.tsx",
            "api.ts",
            "LanguagePicker.tsx",
            "SubscriptionImport.tsx",
        ]) {
            const path = new URL(`./${name}`, import.meta.url);
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
                if (ts.isJsxText(node))
                    expect(
                        /[\u3400-\u9fff]/.test(node.text),
                        `${name}: unlocalized JSX`,
                    ).toBe(false);
                ts.forEachChild(node, visit);
            }
            visit(source);
        }
    });
    it("matches browser locales and provides a safe fallback", () => {
        expect(resolveLanguage("zh-Hant-HK")).toBe("zh-TW");
        expect(resolveLanguage("ja")).toBe("ja-JP");
        expect(resolveLanguage("fa-AF")).toBe("fa-IR");
        expect(resolveLanguage("de-DE")).toBe("en-US");
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
        await changeLanguage("unsupported");
        expect(i18n.language).toBe("ru-RU");
    });
    for (const { code } of languages.filter(
        (l) => !["zh-CN", "en-US"].includes(l.code),
    ))
        it(`${code} translates server errors with intact placeholders`, () => {
            const base = JSON.parse(
                readFileSync(
                    new URL("../../resources/lang/en-US.json", import.meta.url),
                    "utf8",
                ),
            ) as Record<string, string>;
            const server = JSON.parse(
                readFileSync(
                    new URL(
                        `../../resources/lang/${code}.json`,
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
