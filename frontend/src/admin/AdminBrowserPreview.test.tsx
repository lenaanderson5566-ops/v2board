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
    expect(screen.getByText("建议在系统浏览器打开")).toBeTruthy();
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
    expect(browserPolicy(key)).toBe("allow");
    expect(browserPolicy(key, { [key]: "guide" })).toBe("guide");
});
it("does not treat standalone QQBrowser as QQ in-app", () =>
    expect(deviceContext("Mozilla QQBrowser/12.0").embedded).toBeNull());

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
            name: catalog.experience.browserTitle,
        });
        expect(
            screen.getByText(catalog.experience.browserContinue),
        ).toBeTruthy();
        expect(screen.getByText(catalog.experience.browserIos)).toBeTruthy();
        const card = screen.getByRole("main");
        expect(card.lang).toBe(code);
        expect(card.dir).toBe(code === "fa-IR" ? "rtl" : "ltr");
        expect(document.documentElement.lang).toBe("zh-CN");
        expect(document.documentElement.dir).toBe("ltr");
        expect(localStorage.getItem("v2board.language")).toBe("ja-JP");
        fireEvent.click(screen.getByText(catalog.experience.copyAddress));
        await screen.findByText(catalog.translation["已复制"]);
        expect(screen.getByText(catalog.experience.browserCopied)).toBeTruthy();
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
    await waitFor(() => expect(screen.getByRole("main").lang).toBe("fa-IR"));
    expect(
        screen.queryByText(
            catalogs["../locales/de-DE.json"].experience.browserTitle,
        ),
    ).toBeNull();
});
