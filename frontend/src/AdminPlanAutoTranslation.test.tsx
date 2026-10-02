// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
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
    expect(mocks.request).toHaveBeenNthCalledWith(2, "ops/i18n/plan/generate", {
        plan_id: 2,
        source: "zh-CN",
        locale: "zh-TW",
    });
    fireEvent.click(screen.getByText("保存已预览译文"));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(mocks.request).toHaveBeenLastCalledWith(
        "ops/i18n/plan/save",
        expect.objectContaining({
            only_missing: true,
            source_hash: "a".repeat(64),
            content: "翻譯",
        }),
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
    expect(screen.getByRole("alert").textContent).toBe("Quota reached");
});
