// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { AdminBrowserPreview } from "./AdminBrowserPreview";
import { deviceContext } from "../shared/user-experience";
import { browserPolicy } from "../shared/browser-access";
vi.mock("../shared/api", () => ({ boot: { title: "Preview" } }));
vi.mock("../shared/i18n", () => ({ tx: (key: string) => key }));
vi.mock("../shared/experience-copy", () => ({ e: (key: string) => key }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
afterEach(cleanup);
it("previews draft policies without clipboard or navigation side effects", () => {
    const copy = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
        value: { writeText: copy },
        configurable: true,
    });
    const view = render(
        <AdminBrowserPreview values={{ browser_policy_wechat: "prompt" }} />,
    );
    fireEvent.click(screen.getByText("复制页面地址"));
    expect(copy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("继续在当前浏览器访问"));
    expect(screen.getByText(/用户可以进入网站/)).toBeTruthy();
    view.rerender(
        <AdminBrowserPreview values={{ browser_policy_wechat: "guide" }} />,
    );
    expect(screen.queryByText("继续在当前浏览器访问")).toBeNull();
    expect(screen.getByText("在浏览器中继续访问")).toBeTruthy();
});
it.each([
    ["XiaoHongShu", "xiaohongshu"],
    ["Aweme", "douyin"],
    ["BiliApp", "bilibili"],
    ["AlipayClient", "alipay"],
    ["DingTalk", "dingtalk"],
    ["MicroMessenger wxwork", "wecom"],
])("recognizes %s and honors configured policy", (ua, key) => {
    expect(deviceContext(ua).embedded).toBe(key);
    expect(browserPolicy(key)).toBe(key === "wecom" ? "guide" : "allow");
    expect(browserPolicy(key, { [key]: "allow" })).toBe("allow");
    expect(browserPolicy(key, { [key]: "prompt" })).toBe("prompt");
    expect(browserPolicy(key, { [key]: "guide" })).toBe("guide");
});
it("does not treat standalone QQBrowser as QQ in-app", () =>
    expect(deviceContext("Mozilla QQBrowser/12.0").embedded).toBeNull());
it("separates the public entry explanation from workspace access and preserves explicit WeCom choices", () => {
    const view=render(<AdminBrowserPreview values={{}} />);
    expect(screen.getByRole("heading", {name:"入口公开说明"})).toBeTruthy();
    expect(screen.getByRole("heading", {name:"工作区访问策略"})).toBeTruthy();
    expect(screen.getByText(/已保存的允许或提示设置继续优先/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name:/企业微信.*仅显示引导/}));
    expect(screen.queryByRole("button", {name:"继续在当前浏览器访问"})).toBeNull();
    view.rerender(<AdminBrowserPreview values={{browser_policy_wecom:"allow"}} />);
    expect(screen.getByRole("button", {name:/企业微信.*允许访问/})).toBeTruthy();
    expect(screen.getByText(/用户可以进入网站/)).toBeTruthy();
    view.rerender(<AdminBrowserPreview values={{browser_policy_wecom:"prompt"}} />);
    expect(screen.getByRole("button", {name:"继续在当前浏览器访问"})).toBeTruthy();
});

const catalogs = import.meta.glob<{
    experience: Record<string, string>;
    translation: Record<string, string>;
}>("../locales/*.json", { eager: true, import: "default" });
it.each(Object.entries(catalogs))(
    "previews every supported catalog independently: %s",
    async (path, catalog) => {
        const code = path.split("/").pop()!.replace(".json", "");
        document.documentElement.lang = "zh-CN";
        document.documentElement.dir = "ltr";
        localStorage.setItem("v2board.language", "ja-JP");
        render(
            <AdminBrowserPreview
                values={{ browser_policy_wechat: "prompt" }}
            />,
        );
        fireEvent.change(screen.getByLabelText("预览语言"), {
            target: { value: code },
        });
        await screen.findByRole("heading", {
            name: catalog.experience.browserEntryTitle,
        });
        expect(
            screen.getByText(catalog.experience.browserContinue),
        ).toBeTruthy();
        expect(screen.getByText(catalog.experience.browserIos)).toBeTruthy();
        const card = screen.getByRole("region", { name: catalog.experience.browserEntryTitle }).parentElement!;
        expect(card.lang).toBe(code);
        expect(card.dir).toBe(code === "fa-IR" ? "rtl" : "ltr");
        expect(document.documentElement.lang).toBe("zh-CN");
        expect(document.documentElement.dir).toBe("ltr");
        expect(localStorage.getItem("v2board.language")).toBe("ja-JP");
        fireEvent.click(screen.getByText(catalog.experience.copyAddress));
        await screen.findByText(catalog.experience.browserPreviewCopied);
        expect(screen.queryByText(catalog.translation["已复制"])).toBeNull();
        expect(screen.queryByText(catalog.experience.browserCopied)).toBeNull();
        expect(screen.getByText(catalog.experience.copyAddress)).toBeTruthy();
        fireEvent.click(screen.getByText(catalog.experience.browserManual));
        expect((screen.getByRole("textbox") as HTMLInputElement).dir).toBe(
            "ltr",
        );
        const english = catalogs["../locales/en-US.json"].experience;
        for (const [key, value] of Object.entries(english).filter(
            ([key]) => key.startsWith("browser") || key === "copyAddress",
        )) {
            expect(catalog.experience[key]).toBeTruthy();
            expect(catalog.experience[key].match(/{{.*?}}/g) || []).toEqual(
                value.match(/{{.*?}}/g) || [],
            );
            if (code !== "en-US")
                expect(catalog.experience[key]).not.toBe(value);
        }
    },
);
it("keeps only the latest preview language after rapid changes", async () => {
    render(<AdminBrowserPreview values={{ browser_policy_wechat: "guide" }} />);
    fireEvent.change(screen.getByLabelText("预览语言"), {
        target: { value: "de-DE" },
    });
    fireEvent.change(screen.getByLabelText("预览语言"), {
        target: { value: "fa-IR" },
    });
    await waitFor(() => expect(screen.getByRole("region", { name: catalogs["../locales/fa-IR.json"].experience.browserEntryTitle }).parentElement!.lang).toBe("fa-IR"));
    expect(
        screen.queryByText(
            catalogs["../locales/de-DE.json"].experience.browserEntryTitle,
        ),
    ).toBeNull();
});
it("shows the draft strategy for every platform and switches preview without modifying settings", async () => {
    const values = { browser_policy_wechat: "guide", browser_policy_weibo: "prompt", browser_policy_qq: "allow" };
    const view = render(<AdminBrowserPreview values={values} />);
    const overview = screen.getByRole("group", { name: "选择平台预览" });
    expect(overview.querySelectorAll("button")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: /微博.*提示后允许访问/ }));
    expect((screen.getByLabelText("预览平台") as HTMLSelectElement).value).toBe("weibo");
    expect(screen.getByRole("button", { name: "继续在当前浏览器访问" })).toBeTruthy();
    view.rerender(<AdminBrowserPreview values={{ ...values, browser_policy_weibo: "guide" }} />);
    expect(screen.queryByRole("button", { name: "继续在当前浏览器访问" })).toBeNull();
    expect(values).toEqual({ browser_policy_wechat: "guide", browser_policy_weibo: "prompt", browser_policy_qq: "allow" });
});
it("keeps a normal browser accessible under restrictive application policies", () => {
    render(<AdminBrowserPreview values={{ browser_policy_wechat: "guide", browser_policy_other: "guide" }} />);
    fireEvent.change(screen.getByLabelText("预览平台"), { target: { value: "system" } });
    expect(screen.getByText("系统浏览器对照：不显示内置浏览器引导。")).toBeTruthy();
    expect(screen.queryByRole("region", { name: catalogs["../locales/zh-CN.json"].experience.browserEntryTitle })).toBeNull();
    fireEvent.change(screen.getByLabelText("预览平台"), { target: { value: "other" } });
    expect(screen.getByRole("region", { name: catalogs["../locales/zh-CN.json"].experience.browserEntryTitle })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "继续在当前浏览器访问" })).toBeNull();
});
it("resets preview interactions and supports unknown devices without claiming a menu position", async () => {
    render(<AdminBrowserPreview values={{ browser_policy_wechat: "prompt" }} />);
    fireEvent.change(screen.getByLabelText("预览设备"), { target: { value: "unknown" } });
    expect((screen.getByLabelText("预览设备") as HTMLSelectElement).value).toBe("unknown");
    fireEvent.click(screen.getByText("继续在当前浏览器访问"));
    expect(screen.queryByRole("region", { name: catalogs["../locales/zh-CN.json"].experience.browserEntryTitle })).toBeNull();
    fireEvent.click(screen.getByText("重新预览"));
    expect(screen.getByRole("region", { name: catalogs["../locales/zh-CN.json"].experience.browserEntryTitle })).toBeTruthy();
    fireEvent.click(screen.getByText(catalogs["../locales/zh-CN.json"].experience.browserManual));
    expect(screen.getByRole("textbox")).toBeTruthy();
    fireEvent.click(screen.getByText("重新预览"));
    expect(screen.queryByRole("textbox")).toBeNull();
});
it("does not add a second main landmark or page heading inside the administrator workspace", () => {
    render(<main><h1>后台工作区</h1><AdminBrowserPreview values={{ browser_policy_wechat: "guide" }} /></main>);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: catalogs["../locales/zh-CN.json"].experience.browserEntryTitle })).toBeTruthy();
});
