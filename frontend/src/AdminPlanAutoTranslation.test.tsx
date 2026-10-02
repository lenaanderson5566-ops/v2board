// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", () => ({
    admin: (p: string) => p,
    query: (p: string) => p,
    request: mocks.request,
}));
vi.mock("./PlanDescription", () => ({
    PlanDescription: ({ content }: { content: string }) => <p>{content}</p>,
}));
import { AdminPlanAutoTranslation } from "./AdminPlanAutoTranslation";
afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
    mocks.request.mockReset();
});
it("preserves existing locales and saves reviewed drafts with source guards", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.request
        .mockResolvedValueOnce({
            data: { translations: { "en-US": { content: "Existing" } } },
        })
        .mockResolvedValueOnce({
            data: {
                name: "Basic",
                content: "翻譯",
                source_hash: "a".repeat(64),
            },
        })
        .mockResolvedValueOnce({ data: true });
    const saved = vi.fn();
    render(
        <AdminPlanAutoTranslation
            plan="2"
            locales={["en-US", "zh-TW"]}
            onSaved={saved}
        />,
    );
    fireEvent.click(screen.getByText("生成缺失译文"));
    await screen.findByText("保存已预览译文");
    expect(mocks.request).toHaveBeenNthCalledWith(
        2,
        "ops/i18n/plan/generate",
        {
            plan_id: 2,
            source: "zh-CN",
            locale: "zh-TW",
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    fireEvent.click(screen.getByText("保存已预览译文"));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(mocks.request).toHaveBeenLastCalledWith(
        "ops/i18n/plan/save",
        expect.objectContaining({
            only_missing: true,
            source_hash: "a".repeat(64),
            content: "翻譯",
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
});
it("does not send descriptions when external translation is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
        <AdminPlanAutoTranslation
            plan="2"
            locales={["en-US"]}
            onSaved={() => {}}
        />,
    );
    fireEvent.click(screen.getByText("生成缺失译文"));
    expect(mocks.request).not.toHaveBeenCalled();
});
it("keeps completed previews available when a later language fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.request
        .mockResolvedValueOnce({ data: { translations: {} } })
        .mockResolvedValueOnce({
            data: {
                name: "Basic",
                content: "English",
                source_hash: "a".repeat(64),
            },
        })
        .mockRejectedValueOnce(new Error("Quota reached"));
    render(
        <AdminPlanAutoTranslation
            plan="2"
            locales={["en-US", "ja-JP"]}
            onSaved={() => {}}
        />,
    );
    fireEvent.click(screen.getByText("生成缺失译文"));
    await screen.findByRole("alert");
    expect(screen.getByText("保存已预览译文")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Quota reached");
});

it("continues after first-language failure and retries only missing drafts", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.request
        .mockResolvedValueOnce({ data: { translations: {} } })
        .mockRejectedValueOnce(new Error("Invalid digits"))
        .mockResolvedValueOnce({
            data: {
                name: "Basic",
                content: "Japanese",
                source_hash: "a".repeat(64),
            },
        });
    render(
        <AdminPlanAutoTranslation
            plan="2"
            locales={["fa-IR", "ja-JP"]}
            onSaved={() => {}}
        />,
    );
    fireEvent.click(screen.getByText("生成缺失译文"));
    await screen.findByText("生成结束：成功 1，失败 1。成功译文可预览并保存。");
    expect(screen.getByText("保存已预览译文")).toBeTruthy();
    mocks.request
        .mockResolvedValueOnce({ data: { translations: {} } })
        .mockResolvedValueOnce({
            data: {
                name: "Basic",
                content: "Persian",
                source_hash: "a".repeat(64),
            },
        });
    fireEvent.click(screen.getByText("重试缺失译文"));
    await screen.findByText("生成结束：成功 1，失败 0。成功译文可预览并保存。");
    expect(mocks.request).toHaveBeenCalledTimes(5);
    expect(screen.getByDisplayValue("Japanese")).toBeTruthy();
});
it("continues saving later drafts after an individual save fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.request
        .mockResolvedValueOnce({ data: { translations: {} } })
        .mockResolvedValueOnce({
            data: {
                name: "Basic",
                content: "English",
                source_hash: "a".repeat(64),
            },
        })
        .mockResolvedValueOnce({
            data: {
                name: "Basic",
                content: "Japanese",
                source_hash: "a".repeat(64),
            },
        });
    render(
        <AdminPlanAutoTranslation
            plan="2"
            locales={["en-US", "ja-JP"]}
            onSaved={() => {}}
        />,
    );
    fireEvent.click(screen.getByText("生成缺失译文"));
    await screen.findByText("生成结束：成功 2，失败 0。成功译文可预览并保存。");
    mocks.request
        .mockRejectedValueOnce(new Error("Temporary failure"))
        .mockResolvedValueOnce({ data: true });
    fireEvent.click(screen.getByText("保存已预览译文"));
    await screen.findByText(
        "保存结束：已保存 1，失败 1。未保存译文保留，可重试。",
    );
    expect(screen.getByDisplayValue("English")).toBeTruthy();
    expect(screen.queryByText("Japanese")).toBeNull();
});

it("unlocks the controls after a stalled translation request times out",async()=>{
    vi.useFakeTimers();
    vi.spyOn(window,"confirm").mockReturnValue(true);
    mocks.request.mockResolvedValueOnce({data:{translations:{}}})
        .mockImplementationOnce((_path,_body,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new Error("AbortError")))));
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US"]} onSaved={()=>{}}/>);
    await act(async()=>{fireEvent.click(screen.getByText("生成缺失译文"));});
    await act(async()=>{await vi.advanceTimersByTimeAsync(45000);});
    expect(screen.getByRole("status").textContent).toContain("生成结束");
    expect(screen.getByRole("alert").textContent).toContain("请求超时");
    expect((screen.getByText("重试缺失译文") as HTMLButtonElement).disabled).toBe(false);
});
