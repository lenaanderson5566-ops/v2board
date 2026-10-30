// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Row } from "../shared/api";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../shared/api", () => ({
    admin: (path: string) => path, query: (path: string) => path, request: mocks.request,
}));
vi.mock("../shared/PlanDescription", () => ({ PlanDescription: ({ content }: { content: string }) => <p>{content}</p> }));
import { AdminPlanAutoTranslation } from "./AdminPlanAutoTranslation";

const sourceHashes = { name: "a".repeat(64), content: "b".repeat(64) };
const version = "1".repeat(64);
function translation(content = "", status = "missing", origin: string | null = null): Row {
    return { name: "", content, version, fields: { name: { status: "inherited", origin: null }, content: { status, origin } } };
}
function snapshot(translations: Row = { "en-US": translation() }): Row {
    return { source_language: "zh-CN", source_hashes: { ...sourceHashes }, default: { name: "Basic", content: "原文" }, translations };
}
function candidate(content: string, more: Row = {}): Row {
    return { data: { content, source_hashes: { ...sourceHashes }, translation_version: version, fields: ["content"], ...more } };
}
function confirm(value = true) { return vi.spyOn(window, "confirm").mockReturnValue(value); }
function generate() { fireEvent.click(screen.getByRole("button", { name: /^(生成待同步译文|重试待同步译文)$/ })); }
function save() { fireEvent.click(screen.getByRole("button", { name: /^保存所选译文/ })); }
async function expectCandidate(content: string) { await screen.findByDisplayValue(content); }

afterEach(() => {
    cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); mocks.request.mockReset();
});

it("selects missing and outdated machine descriptions, excludes the source and preserves manual translations", async () => {
    confirm();
    const current = snapshot({
        "zh-CN": translation("旧中文", "unverified"),
        "en-US": translation(), "ja-JP": translation("古い", "outdated", "machine"),
        "fa-IR": translation("دستی", "outdated", "manual"),
        "zh-TW": translation("已同步", "current", "manual"),
    });
    mocks.request.mockResolvedValueOnce(candidate("English"))
        .mockResolvedValueOnce(candidate("Japanese"))
        .mockResolvedValue({ data: true });
    const saved = vi.fn();
    render(<AdminPlanAutoTranslation plan="2" locales={Object.keys(current.translations)} snapshot={current} onSaved={saved} />);
    expect(screen.queryByLabelText("简体中文描述")).toBeNull();
    expect((screen.getByRole("checkbox", { name: "English描述" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "فارسی描述" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("checkbox", { name: "繁體中文描述" }).closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("已同步或无需更新（1种语言）"));
    expect((screen.getByRole("checkbox", { name: "繁體中文描述" }) as HTMLInputElement).disabled).toBe(true);
    generate(); await expectCandidate("Japanese");
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request).toHaveBeenNthCalledWith(1, "ops/i18n/plan/generate", {
        plan_id: 2, source: "zh-CN", locale: "en-US", fields: ["content"],
    }, expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 45000 }));
    save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.request).toHaveBeenNthCalledWith(3, "ops/i18n/plan/save", {
        plan_id: 2, locale: "en-US", fields: ["content"], content: "English",
        source_hashes: sourceHashes, translation_version: version, origins: { content: "machine" },
    }, expect.anything());
    expect(screen.queryByDisplayValue("English")).toBeNull();
});

it("does not transmit text automatically or when external translation is declined", () => {
    confirm(false);
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US"]} snapshot={snapshot()} autoStart onSaved={() => {}} />);
    expect(screen.getByText(/套餐已保存/)).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
    generate(); expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).toBeNull();
});

it("requires explicit selection for legacy and manual fields, with names translated only when requested", async () => {
    confirm();
    const current = snapshot({ "en-US": translation("Old manual text", "unverified") });
    mocks.request.mockResolvedValue(candidate("Updated", { name: "基础", fields: ["name", "content"] }));
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US"]} snapshot={current} onSaved={() => {}} />);
    expect((screen.getByRole("button", { name: "生成待同步译文" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "English描述" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "翻译套餐名称（默认沿用原名）" }));
    generate(); await expectCandidate("Updated");
    expect(mocks.request).toHaveBeenCalledWith("ops/i18n/plan/generate", expect.objectContaining({ fields: ["name", "content"] }), expect.anything());
    expect(screen.getByText("Old manual text")).toBeTruthy();
    expect(screen.getByDisplayValue("基础")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("English描述候选"), { target: { value: "Human revision" } });
    mocks.request.mockResolvedValueOnce({ data: true });
    save(); await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(mocks.request.mock.calls[1][1]).toMatchObject({ name: "基础", content: "Human revision", origins: { name: "machine", content: "manual" } });
});

it("continues after an individual generation failure and retries only fields without candidates", async () => {
    confirm();
    mocks.request.mockRejectedValueOnce(new Error("Invalid digits")).mockResolvedValueOnce(candidate("Japanese"));
    const current = snapshot({ "en-US": translation(), "ja-JP": translation() });
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US", "ja-JP"]} snapshot={current} onSaved={() => {}} />);
    generate(); await expectCandidate("Japanese");
    await screen.findByText(/生成结束：成功 1，失败 1/);
    expect(screen.getByRole("alert").textContent).toContain("Invalid digits");
    mocks.request.mockResolvedValueOnce(candidate("English"));
    generate(); await expectCandidate("English");
    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(mocks.request.mock.calls[2][1].locale).toBe("en-US");
    expect(screen.getByDisplayValue("Japanese")).toBeTruthy();
});

it("keeps failed saves available while saving later selected candidates", async () => {
    confirm();
    mocks.request.mockResolvedValueOnce(candidate("English")).mockResolvedValueOnce(candidate("Japanese"));
    const saved = vi.fn();
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US", "ja-JP"]}
        snapshot={snapshot({ "en-US": translation(), "ja-JP": translation() })} onSaved={saved} />);
    generate(); await expectCandidate("Japanese");
    mocks.request.mockRejectedValueOnce(new Error("Temporary save failure")).mockResolvedValueOnce({ data: true });
    save(); await screen.findByText(/保存结束：已保存 1，失败 1/);
    expect(screen.getByDisplayValue("English")).toBeTruthy();
    expect(screen.queryByDisplayValue("Japanese")).toBeNull();
    mocks.request.mockResolvedValueOnce({ data: true }); save();
    await waitFor(() => expect(screen.queryByDisplayValue("English")).toBeNull());
    expect(mocks.request.mock.calls[4][1].locale).toBe("en-US");
});

it("saves only candidates explicitly selected for publishing", async () => {
    confirm();
    mocks.request.mockResolvedValueOnce(candidate("English")).mockResolvedValueOnce(candidate("Japanese"));
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US", "ja-JP"]}
        snapshot={snapshot({ "en-US": translation(), "ja-JP": translation() })} onSaved={() => {}} />);
    generate(); await expectCandidate("Japanese");
    fireEvent.click(screen.getByRole("checkbox", { name: "保存日本語候选" }));
    mocks.request.mockResolvedValueOnce({ data: true }); save();
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
    expect(mocks.request.mock.calls[2][1].locale).toBe("en-US");
    expect(screen.getByDisplayValue("Japanese")).toBeTruthy();
});

it("unlocks the controls after a stalled generation request times out", async () => {
    vi.useFakeTimers(); confirm();
    mocks.request.mockImplementationOnce((_path, _body, options) => new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(new Error("AbortError")))));
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US"]} snapshot={snapshot()} onSaved={() => {}} />);
    await act(async () => { generate(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(45000); });
    expect(screen.getByRole("alert").textContent).toContain("请求超时");
    expect((screen.getByRole("button", { name: "重试待同步译文" }) as HTMLButtonElement).disabled).toBe(false);
});

it("pauses the generation batch and respects Retry-After without automatically retrying", async () => {
    vi.useFakeTimers(); confirm();
    mocks.request.mockRejectedValueOnce(Object.assign(new Error("Slow down"), { status: 429, retryAfter: 10 }));
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US", "ja-JP"]}
        snapshot={snapshot({ "en-US": translation(), "ja-JP": translation() })} onSaved={() => {}} />);
    await act(async () => { generate(); });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/10 秒后手动重试/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "重试待同步译文" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect((screen.getByRole("button", { name: "重试待同步译文" }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
});

it("stops saving after a version conflict and preserves candidates for comparison", async () => {
    confirm();
    mocks.request.mockResolvedValueOnce(candidate("English")).mockResolvedValueOnce(candidate("Japanese"));
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US", "ja-JP"]}
        snapshot={snapshot({ "en-US": translation(), "ja-JP": translation() })} onSaved={() => {}} />);
    generate(); await expectCandidate("Japanese");
    mocks.request.mockRejectedValueOnce(Object.assign(new Error("Source changed"), { status: 409 }));
    save(); await screen.findByText(/原文或译文已变更，已停止保存/);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(screen.getByDisplayValue("English")).toBeTruthy();
    expect(screen.getByDisplayValue("Japanese")).toBeTruthy();
    expect((screen.getByRole("button", { name: "保存所选译文（0）" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("English描述候选") as HTMLTextAreaElement).disabled).toBe(true);
});

it.each(["source", "target"])("invalidates candidates when the %s version changes without losing the text", async (change) => {
    confirm(); mocks.request.mockResolvedValue(candidate("English"));
    const current = snapshot();
    const props = { plan: "2", locales: ["en-US"], onSaved: () => {} };
    const view = render(<AdminPlanAutoTranslation {...props} snapshot={current} />);
    generate(); await expectCandidate("English");
    const updated = snapshot(change === "target" ? { "en-US": { ...translation(), version: "2".repeat(64) } } : undefined);
    if (change === "source") updated.source_hashes = { ...sourceHashes, content: "c".repeat(64) };
    view.rerender(<AdminPlanAutoTranslation {...props} snapshot={updated} />);
    await waitFor(() => expect((screen.getByRole("button", { name: "保存所选译文（0）" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByDisplayValue("English")).toBeTruthy();
    expect(mocks.request).toHaveBeenCalledTimes(1);
});

it("rejects incomplete generated version metadata instead of saving without guards", async () => {
    confirm(); mocks.request.mockResolvedValueOnce({ data: { content: "Legacy response", source_hash: sourceHashes.content } });
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US"]} snapshot={snapshot()} onSaved={() => {}} />);
    generate(); await screen.findByText(/套餐原文或译文已变更/);
    expect(screen.queryByDisplayValue("Legacy response")).toBeNull();
    expect(screen.queryByRole("button", { name: /^保存所选译文/ })).toBeNull();
});

it("reports busy and dirty state, honors the editor lock and confirms discarding candidates", async () => {
    const permission = confirm(); mocks.request.mockResolvedValue(candidate("English"));
    const dirty = vi.fn(), busy = vi.fn();
    const props = { plan: "2", locales: ["en-US"], snapshot: snapshot(), onSaved: () => {}, onDirtyChange: dirty, onBusyChange: busy };
    const view = render(<AdminPlanAutoTranslation {...props} disabled />);
    expect((screen.getByRole("button", { name: "生成待同步译文" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<AdminPlanAutoTranslation {...props} />);
    generate(); await expectCandidate("English");
    expect(busy).toHaveBeenCalledWith(true);
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("region", { name: "套餐翻译同步" }).getAttribute("data-unsaved")).toBe("true");
    permission.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "放弃全部候选" }));
    expect(screen.getByDisplayValue("English")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "放弃全部候选" }));
    await waitFor(() => expect(screen.queryByDisplayValue("English")).toBeNull());
    expect(dirty).toHaveBeenLastCalledWith(false);
});

it("loads status without transmitting content to the translator and recovers from read failure", async () => {
    mocks.request.mockRejectedValueOnce(new Error("Read failed"));
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US"]} onSaved={() => {}} />);
    await screen.findByText("Read failed");
    mocks.request.mockResolvedValueOnce({ data: snapshot() });
    fireEvent.click(screen.getByRole("button", { name: "重新检查状态" }));
    await screen.findByRole("checkbox", { name: "English描述" });
    expect(mocks.request.mock.calls.every(([path]) => path === "ops/i18n/plan/fetch")).toBe(true);
});

it("stops a long generation batch on request while keeping completed candidates", async () => {
    confirm();
    mocks.request.mockResolvedValueOnce(candidate("English"))
        .mockImplementationOnce((_path, _body, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("AbortError")))));
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US", "ja-JP", "zh-TW"]}
        snapshot={snapshot({ "en-US": translation(), "ja-JP": translation(), "zh-TW": translation() })} onSaved={() => {}} />);
    generate(); await expectCandidate("English");
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    await screen.findByText(/生成已停止/);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(screen.getByDisplayValue("English")).toBeTruthy();
});

it("does not request repeated translations for empty source fields", () => {
    const current = snapshot(); current.default = { name: "", content: "  " };
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US"]} snapshot={current} onSaved={() => {}} />);
    expect(screen.queryByRole("group", { name: "待同步语言" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "English描述" }).closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("已同步或无需更新（1种语言）"));
    expect((screen.getByRole("checkbox", { name: "English描述" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "生成待同步译文" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.request).not.toHaveBeenCalled();
});

it("lets an administrator explicitly select protected descriptions in a batch without sending them yet", () => {
    const current = snapshot({ "en-US": translation("Legacy", "unverified", "unknown"), "ja-JP": translation("Manual", "outdated", "manual") });
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US", "ja-JP"]} snapshot={current} onSaved={() => {}} />);
    expect((screen.getByRole("checkbox", { name: "English描述" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "选择需复核项" }));
    expect((screen.getByRole("checkbox", { name: "English描述" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "日本語描述" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "English名称" }) as HTMLInputElement).checked).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
});

it("keeps a candidate when the server does not confirm it was saved", async () => {
    confirm(); mocks.request.mockResolvedValueOnce(candidate("English"));
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US"]} snapshot={snapshot()} onSaved={() => {}} />);
    generate(); await expectCandidate("English");
    mocks.request.mockResolvedValueOnce({ data: false }); save();
    await screen.findByText(/保存结束：已保存 0，失败 1/);
    expect(screen.getByDisplayValue("English")).toBeTruthy();
});

it("only invalidates the fields being translated when another source field changes", async () => {
    confirm(); mocks.request.mockResolvedValueOnce(candidate("English"));
    const props = { plan: "2", locales: ["en-US"], onSaved: () => {} };
    const view = render(<AdminPlanAutoTranslation {...props} snapshot={snapshot()} />);
    generate(); await expectCandidate("English");
    const updated = snapshot(); updated.source_hashes.name = "c".repeat(64);
    view.rerender(<AdminPlanAutoTranslation {...props} snapshot={updated} />);
    expect((screen.getByRole("button", { name: "保存所选译文（1）" }) as HTMLButtonElement).disabled).toBe(false);
    mocks.request.mockResolvedValueOnce({ data: true }); save();
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(mocks.request.mock.calls[1][1].fields).toEqual(["content"]);
});

it("adds a requested name without losing edits to the existing description candidate", async () => {
    confirm(); mocks.request.mockResolvedValueOnce(candidate("English"));
    render(<AdminPlanAutoTranslation plan="2" locales={["en-US"]} snapshot={snapshot()} onSaved={() => {}} />);
    generate(); await expectCandidate("English");
    fireEvent.change(screen.getByLabelText("English描述候选"), { target: { value: "Human draft" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "翻译套餐名称（默认沿用原名）" }));
    mocks.request.mockResolvedValueOnce({ data: { name: "Basic translated", fields: ["name"], source_hashes: sourceHashes, translation_version: version } });
    generate(); await expectCandidate("Basic translated");
    expect(screen.getByDisplayValue("Human draft")).toBeTruthy();
    mocks.request.mockResolvedValueOnce({ data: true }); save();
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
    expect(mocks.request.mock.calls[2][1]).toMatchObject({ name: "Basic translated", content: "Human draft", origins: { content: "manual", name: "machine" } });
});
