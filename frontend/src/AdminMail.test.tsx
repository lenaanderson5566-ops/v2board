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
import { AdminMailPreview } from "./AdminMailPreview";
import { AdminMailComposer } from "./AdminMailComposer";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it("previews the selected language without sending and isolates HTML", async () => {
    api.request.mockResolvedValue({
        data: { subject: "Subject", html: "<p>Preview</p>", text: "Preview" },
    });
    render(<AdminMailPreview />);
    fireEvent.change(screen.getByLabelText("邮件语言"), {
        target: { value: "fa-IR" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await waitFor(() => expect(screen.getByTitle("邮件内容预览")).toBeTruthy());
    expect(api.request).toHaveBeenCalledWith(
        "admin/config/previewMail",
        expect.objectContaining({ language: "fa-IR", template: "verify" }),
    );
    expect(screen.getByTitle("邮件内容预览").getAttribute("sandbox")).toBe("");
    fireEvent.click(screen.getByLabelText("纯文本版本"));
    expect(screen.getByText("Preview")).toBeTruthy();
});
it("requires scope confirmation and complete translated versions", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
        <AdminMailComposer confirmed={false} onSave={onSave} />,
    );
    fireEvent.change(screen.getByLabelText("邮件主题"), {
        target: { value: "Default subject" },
    });
    fireEvent.change(screen.getByLabelText("邮件正文 HTML"), {
        target: { value: "Default body" },
    });
    fireEvent.click(screen.getByRole("button", { name: "加入发送队列" }));
    expect(onSave).not.toHaveBeenCalled();
    rerender(<AdminMailComposer confirmed={true} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("编辑语言"), {
        target: { value: "ja-JP" },
    });
    fireEvent.change(screen.getByLabelText("邮件主题"), {
        target: { value: "日本語" },
    });
    fireEvent.click(screen.getByRole("button", { name: "加入发送队列" }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("邮件正文 HTML"), {
        target: { value: "翻訳" },
    });
    fireEvent.click(screen.getByRole("button", { name: "加入发送队列" }));
    await waitFor(() =>
        expect(onSave).toHaveBeenCalledWith({
            subject: "Default subject",
            content: "Default body",
            translations: { "ja-JP": { subject: "日本語", content: "翻訳" } },
        }),
    );
});
