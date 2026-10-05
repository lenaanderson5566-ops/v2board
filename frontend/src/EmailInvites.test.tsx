// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    history: [] as any[],
    paths: [] as string[],
}));
vi.mock("./api", () => ({
    boot: { title: "Studio" },
    bytes: (value: number) => `${value} B`,
    request: mocks.request,
    query: (path: string, params: any) =>
        path + "?" + new URLSearchParams(params),
}));
vi.mock("./i18n", () => ({
    tx: (key: string, args: any = {}) =>
        key.replace(/{{(\w+)}}/g, (_, name) => String(args[name])),
}));
vi.mock("./ui", () => ({
    useData: (path: string) => {
        mocks.paths.push(path);
        return {
            data: mocks.history,
            loading: false,
            error: "",
            reload: vi.fn(),
        };
    },
    State: ({ children }: { children: ReactNode }) => children,
    Modal: ({ children, title, close }: any) => (
        <div role="dialog" aria-label={title}>
            <button onClick={close}>关闭</button>
            {children}
        </div>
    ),
}));
import { EmailInvites } from "./EmailInvites";
afterEach(cleanup);
beforeEach(() => {
    mocks.request.mockReset();
    mocks.paths = [];
    mocks.history = [];
});
it("sends a private email invitation and reports queued status without public codes or links", async () => {
    mocks.request.mockResolvedValue({ data: { status: "queued" } });
    render(<EmailInvites />);
    expect(mocks.paths.every((path) => path === "")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "发送邮件邀请" }));
    expect(
        (screen.getByRole("button", { name: "发送邀请" }) as HTMLButtonElement)
            .disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("朋友的邮箱地址"), {
        target: { value: "friend@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送邀请" }));
    await screen.findByRole("status");
    expect(mocks.request).toHaveBeenCalledWith("user/invite/email/send", {
        email: "friend@example.com",
    });
    expect(
        (screen.getByLabelText("朋友的邮箱地址") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.queryByText(/复制|邀请码/)).toBeNull();
});
it("retains the address and allows retry when the request fails", async () => {
    mocks.request.mockRejectedValue(Error("daily limit"));
    render(<EmailInvites />);
    fireEvent.click(screen.getByRole("button", { name: "发送邮件邀请" }));
    fireEvent.change(screen.getByLabelText("朋友的邮箱地址"), {
        target: { value: "friend@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送邀请" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("status")).toBeNull();
    expect(
        (screen.getByLabelText("朋友的邮箱地址") as HTMLInputElement).value,
    ).toBe("friend@example.com");
    await waitFor(() =>
        expect(
            (
                screen.getByRole("button", {
                    name: "发送邀请",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(false),
    );
});
it("tracks recipients and statuses with a selectable history period", () => {
    mocks.history = [
        { id: 1, email: "friend@example.com", status: "accepted" },
        { id: 2, email: "waiting@example.com", status: "queued" },
        { id: 3, email: "failed@example.com", status: "failed" },
    ];
    render(<EmailInvites />);
    fireEvent.click(screen.getByRole("button", { name: "跟踪邀请" }));
    expect(screen.getByText("已接受")).toBeTruthy();
    expect(screen.getByText("等待发送")).toBeTruthy();
    expect(screen.getByText("发送失败")).toBeTruthy();
    expect(mocks.paths.at(-1)).toBe("user/invite/email/fetch?days=90");
    fireEvent.change(screen.getByLabelText("邀请记录时间范围"), {
        target: { value: "7" },
    });
    expect(mocks.paths.at(-1)).toBe("user/invite/email/fetch?days=7");
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByLabelText("朋友的邮箱地址")).toBeTruthy();
});

it("shows only configured invitee rewards", () => {
    const view = render(<EmailInvites rewards={{registrationBytes: 1024, firstUseBytes: 0}} />);
    expect(screen.getByText("好友通过邀请注册后获赠 1024 B 额度。")).toBeTruthy();
    expect(screen.queryByText(/好友首次实际使用/)).toBeNull();
    view.rerender(<EmailInvites rewards={{registrationBytes: 0, firstUseBytes: 2048}} />);
    expect(screen.queryByText(/好友通过邀请注册后获赠/)).toBeNull();
    expect(screen.getByText("好友首次实际使用流量后，双方各获赠 2048 B 额度。")).toBeTruthy();
});
