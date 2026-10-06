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
vi.mock("../shared/i18n", () => ({
    locale: () => "zh-CN",
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
    expect(body.starts_at).toBe(
        Math.floor(new Date("2026-10-05T12:34").getTime() / 1000),
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
