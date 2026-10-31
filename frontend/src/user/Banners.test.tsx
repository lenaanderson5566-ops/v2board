// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn(), data: [] as any[] }));
vi.mock("../shared/api", () => ({
    admin: (s: string) => "admin/" + s,
    query: (s: string) => s,
    request: mocks.request,
}));
vi.mock("react-i18next", async () => {
    const { default: catalog } = await import("../locales/zh-CN.json");
    return {
        useTranslation: () => ({
            t: (key: keyof typeof catalog.banners) => catalog.banners[key],
        }),
    };
});
vi.mock("../shared/i18n", () => ({
    locale: () => "zh-CN",
    tx: (text: string) => text,
    languages: [
        { code: "zh-CN", name: "简体中文" },
        { code: "en-US", name: "English" },
    ],
}));
vi.mock("../shared/ui", () => ({
    useData: () => ({
        data: mocks.data,
        error: "",
        loading: false,
        reload: vi.fn(),
    }),
    Panel: ({ children, actions }: any) => (
        <div>
            {actions}
            {children}
        </div>
    ),
    State: () => null,
    Modal: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("../shared/ui/useData", () => ({
    useData: () => ({
        data: mocks.data,
        error: "",
        loading: false,
        reload: vi.fn(),
    }),
}));
import {
    BannerStrip,
    bannerUrl,
    bannerImages,
    presetBanner,
    presetMobileBanner,
} from "../shared/BannerStrip";
import { BannerEditor } from "../admin/AdminBanners";
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mocks.data = [];
    mocks.request.mockReset();
});
it("rejects dangerous and encoded links, supports site paths", () => {
    for (const value of [
        "javascript:alert(1)",
        "//evil.test",
        "/%2Fevil.test",
        "/foo%0abar",
        "https://user:pass@example.test",
        "https://x.test/\\evil",
    ])
        expect(bannerUrl(value)).toBeUndefined();
    expect(bannerUrl("/app#/plan")).toBe("/app#/plan");
    expect(bannerUrl("https://example.test")).toBe("https://example.test");
});
it("manually switches banners and hides failed images without blocking content", () => {
    mocks.data = [
        {
            id: 1,
            title: "One",
            image_url: "/one.png",
            target_url: "javascript:alert(1)",
        },
        { id: 2, title: "Two", image_url: "/two.png" },
    ];
    const view = render(<BannerStrip placement="dashboard" />);
    expect(view.container.querySelector("a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    expect(screen.getByAltText("Two")).toBeTruthy();
    fireEvent.error(screen.getByAltText("Two"));
    expect(screen.getByAltText("One")).toBeTruthy();
    fireEvent.error(screen.getByAltText("One"));
    expect(view.container.innerHTML).toBe("");
});
it("keeps unsaved text during upload and saves positions, languages and minute timestamps", async () => {
    mocks.request
        .mockResolvedValueOnce({ data: { url: "/uploaded.png" } })
        .mockResolvedValueOnce({ data: true });
    const done = vi.fn();
    render(
        <BannerEditor
            initial={{
                title: "Draft",
                image_url: "/before.png",
                placements: ["dashboard"],
                languages: [],
                sort: 0,
                show: true,
            }}
            close={vi.fn()}
            complete={done}
        />,
    );
    fireEvent.change(screen.getByLabelText("标题 / 图片替代文本"), {
        target: { value: "My launch" },
    });
    const input = document.querySelector("input[type=file]")!;
    fireEvent.change(input, {
        target: {
            files: [new File(["png"], "test.png", { type: "image/png" })],
        },
    });
    await waitFor(() =>
        expect(screen.getByAltText("主图片预览").getAttribute("src")).toBe(
            "/uploaded.png",
        ),
    );
    expect(
        (screen.getByLabelText("标题 / 图片替代文本") as HTMLInputElement)
            .value,
    ).toBe("My launch");
    fireEvent.click(screen.getByLabelText("落地页"));
    fireEvent.click(screen.getByLabelText("English"));
    fireEvent.change(screen.getByLabelText("上线时间"), {
        target: { value: "2026-10-05T12:34" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(mocks.request.mock.calls[0][1]).toBeInstanceOf(FormData);
    const body = mocks.request.mock.calls[1][1];
    expect(body.title).toBe("My launch");
    expect(body.image_url).toBe("/uploaded.png");
    expect(body.placements).toEqual(["dashboard", "landing"]);
    expect(body.languages).toEqual(["en-US"]);
    const { parseDateTimeInput } = await import("../shared/timezone");
    expect(body.starts_at).toBe(
        parseDateTimeInput("2026-10-05T12:34"),
    );
});
it("allows saving a draft after upload fails", async () => {
    mocks.request
        .mockRejectedValueOnce(new Error("上传失败"))
        .mockResolvedValueOnce({ data: true });
    const done = vi.fn();
    render(
        <BannerEditor
            initial={{
                title: "Draft",
                image_url: "/before.png",
                placements: ["dashboard"],
                languages: [],
                sort: 0,
                show: true,
            }}
            close={vi.fn()}
            complete={done}
        />,
    );
    fireEvent.change(document.querySelector("input[type=file]")!, {
        target: {
            files: [new File(["png"], "test.png", { type: "image/png" })],
        },
    });
    await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain("上传失败"),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
});

it("updates existing preset artwork while preserving custom mobile images", () => {
    expect(bannerImages({ image_url: presetMobileBanner })).toEqual({
        desktop: presetBanner,
        mobile: presetMobileBanner,
    });
    expect(
        bannerImages({
            image_url: presetMobileBanner,
            mobile_image_url: "/custom.png",
        }).mobile,
    ).toBe("/custom.png");
    expect(bannerImages({ image_url: "/other.png" }).desktop).toBe(
        "/other.png",
    );
});

it("confirms dismissal of unsaved banner edits", () => {
    const close = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<BannerEditor initial={{title:"Original",image_url:"/before.png",placements:["dashboard"],languages:[],sort:0,show:true}} close={close} complete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("标题 / 图片替代文本"), {target:{value:"Changed"}});
    fireEvent.click(screen.getByRole("button", {name:"取消"}));
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByLabelText("标题 / 图片替代文本") as HTMLInputElement).value).toBe("Changed");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", {name:"取消"}));
    expect(close).toHaveBeenCalledTimes(1);
});
it("locks the banner draft during save and retains it after failure", async () => {
    let reject!: (error: Error) => void;
    mocks.request.mockImplementationOnce(() => new Promise((_, fail) => {reject=fail;}));
    const close = vi.fn();
    render(<BannerEditor initial={{title:"Original",image_url:"/before.png",placements:["dashboard"],languages:[],sort:0,show:true}} close={close} complete={vi.fn()} />);
    const title = screen.getByLabelText("标题 / 图片替代文本") as HTMLInputElement;
    fireEvent.change(title, {target:{value:"Changed"}});
    const form = title.closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(title.disabled).toBe(true);
    expect((screen.getByRole("button",{name:"取消"}) as HTMLButtonElement).disabled).toBe(true);
    reject(new Error("Save failed"));
    await screen.findByText("Save failed");
    expect(title.value).toBe("Changed"); expect(title.disabled).toBe(false);
    expect(close).not.toHaveBeenCalled();
});

it("preserves exact banner instants during a DST repeated hour while editing its title", async () => {
    const { configureTimeZone } = await import("../shared/timezone");
    configureTimeZone("America/New_York", true);
    mocks.request.mockResolvedValue({ data: true });
    const starts_at = Date.parse("2026-11-01T05:30:37Z") / 1000;
    const ends_at = Date.parse("2026-11-01T06:30:37Z") / 1000;
    try {
        render(<BannerEditor initial={{ title: "Original", image_url: "/before.png", placements: ["dashboard"], languages: [], sort: 0, show: true, starts_at, ends_at }} close={vi.fn()} complete={vi.fn()} />);
        expect((screen.getByLabelText("上线时间") as HTMLInputElement).step).toBe("1");
        expect(screen.getByText(/系统业务时区 America\/New_York/)).toBeTruthy();
        fireEvent.change(screen.getByLabelText("标题 / 图片替代文本"), { target: { value: "Changed" } });
        fireEvent.change(screen.getByLabelText("下线时间"), { target: { value: "2026-11-01T01:30:37.000" } });
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("admin/banner/save", expect.objectContaining({ title: "Changed", starts_at, ends_at })));
        fireEvent.change(screen.getByLabelText("下线时间"), { target: { value: "2026-11-01T01:31:37" } });
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        expect((await screen.findByRole("alert")).textContent).toContain("夏令时重复");
        expect(mocks.request).toHaveBeenCalledTimes(1);
    } finally { configureTimeZone("Asia/Shanghai", true); }
});
