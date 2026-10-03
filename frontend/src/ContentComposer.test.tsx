// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", () => ({
    admin: (s: string) => "admin/" + s,
    request: api.request,
}));
vi.mock("./AdminMailPreview", () => ({
    AdminMailPreview: () => null,
    mailLanguages: {
        "zh-CN": "简体中文",
        "zh-TW": "繁體中文",
        "en-US": "English",
        "ja-JP": "日本語",
    },
}));
vi.mock("./ui", () => ({
    Html: ({ value }: { value: string }) => <div>{value}</div>,
}));
import { ContentComposer } from "./ContentComposer";
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    api.request.mockReset();
});
it("defaults to simplified Chinese and English, blocks incomplete versions", async () => {
    const save = vi.fn();
    render(
        <ContentComposer
            kind="notice"
            initial={{ title: "维护通知", content: "说明" }}
            onSave={save}
        />,
    );
    expect(
        (screen.getByLabelText("简体中文") as HTMLInputElement).checked,
    ).toBe(true);
    expect((screen.getByLabelText("English") as HTMLInputElement).checked).toBe(
        true,
    );
    expect(
        (screen.getByLabelText("繁體中文") as HTMLInputElement).checked,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "保存公告" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("English");
});
it("continues after a translation error and retries only missing versions", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.request
        .mockRejectedValueOnce(new Error("rate limited"))
        .mockResolvedValueOnce({ data: { subject: "維護", content: "說明" } })
        .mockResolvedValueOnce({
            data: { subject: "Maintenance", content: "Details" },
        });
    const save = vi.fn().mockResolvedValue(undefined);
    render(
        <ContentComposer
            kind="notice"
            initial={{ title: "维护", content: "说明" }}
            onSave={save}
        />,
    );
    fireEvent.click(screen.getByLabelText("繁體中文"));
    fireEvent.click(
        screen.getByRole("button", { name: "生成缺失译文 / 重试" }),
    );
    await waitFor(() =>
        expect(screen.getByRole("status").textContent).toContain("生成结束"),
    );
    expect(api.request).toHaveBeenCalledTimes(2);
    fireEvent.click(
        screen.getByRole("button", { name: "生成缺失译文 / 重试" }),
    );
    await waitFor(() => expect(api.request).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "保存公告" }));
    await waitFor(() =>
        expect(save).toHaveBeenCalledWith(
            expect.objectContaining({
                translations: {
                    "zh-CN": { subject: "维护", content: "说明" },
                    "zh-TW": { subject: "維護", content: "說明" },
                    "en-US": { subject: "Maintenance", content: "Details" },
                },
            }),
        ),
    );
});
it("preserves saved translations and sends nothing during generation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const save = vi.fn();
    render(
        <ContentComposer
            kind="mail"
            initial={{
                subject: "原文",
                content: "正文",
                translations: {
                    "en-US": { subject: "Reviewed", content: "Approved" },
                },
            }}
            onSave={save}
        />,
    );
    fireEvent.click(
        screen.getByRole("button", { name: "生成缺失译文 / 重试" }),
    );
    await waitFor(() =>
        expect(screen.getByRole("status").textContent).toContain("无需生成"),
    );
    expect(api.request).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
});
it("releases controls after a stalled request times out", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.useFakeTimers();
    try {
        api.request.mockImplementation(
            (_path, _body, options) =>
                new Promise((_resolve, reject) =>
                    options.signal.addEventListener("abort", () =>
                        reject(new Error("aborted")),
                    ),
                ),
        );
        render(
            <ContentComposer
                kind="notice"
                initial={{ title: "维护", content: "说明" }}
                onSave={vi.fn()}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "生成缺失译文 / 重试" }),
        );
        const { act } = await import("@testing-library/react");
        await act(async () => {
            await vi.advanceTimersByTimeAsync(45001);
        });
        expect(screen.getByRole("alert").textContent).toContain("请求超时");
        expect(
            (
                screen.getByRole("button", {
                    name: "保存公告",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(false);
    } finally {
        vi.useRealTimers();
    }
});
