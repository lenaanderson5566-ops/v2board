// @vitest-environment jsdom
vi.mock("../shared/account-copy", () => ({ ac: (key: string) => key }));
vi.mock("./help-copy", () => ({ h: (key: string) => key }));
vi.mock("react-i18next", () => ({
    useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));
vi.mock("../shared/credit-copy", () => ({
    c: (key: string) => key,
    minuteDate: (v: unknown) => String(v),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({ policy: "allowed", tickets: [] as any[], request: vi.fn(), saveError: vi.fn() }));
vi.mock("../shared/i18n", () => ({
    default: { addResourceBundle: () => undefined },
    tx: (key: string) => key,
    locale: () => "zh-CN",
    languages: [],
}));
vi.mock("../shared/billing-copy", () => ({ b: (key: string) => key }));
vi.mock("../shared/experience-copy", () => ({ e: (key: string) => key }));
vi.mock("../shared/api", () => ({
    boot: { mode: "user", adminPath: "admin" },
    request: mocks.request,
    rows: (data: any) => (Array.isArray(data) ? data : []),
    query: (path: string, params: any) =>
        path + "?" + new URLSearchParams(params),
    date: () => "date",
}));
vi.mock("../shared/ui", () => ({
    useData: (path: string) => ({
        data: path === "user/info" ? { ticket_creation: mocks.policy } : path.includes("id=")
            ? { subject: "现有工单", status: 1, message: [] }
            : mocks.tickets,
        loading: false,
        error: "",
        reload: vi.fn(),
    }),
    Panel: ({
        children,
        actions,
        title,
    }: {
        children: ReactNode;
        actions?: ReactNode;
        title: string;
    }) => (
        <section>
            <h2>{title}</h2>
            {actions}
            {children}
        </section>
    ),
    State: ({ children }: { children: ReactNode }) => children,
    Table: () => null,
    Modal: ({ children, title }: { children: ReactNode; title: string }) => (
        <div role="dialog" aria-label={title}>
            {children}
        </div>
    ),
    Reload: () => null,
    Editor: ({ initial, onSave }: any) => (
        <button
            onClick={() =>
                Promise.resolve(onSave({ ...initial, subject: "未到账", message: "详情" })).catch(mocks.saveError)
            }
        >
            提交测试工单
        </button>
    ),
}));
import { HelpGuides, ContactSupport } from "./HelpGuides";
import { Tickets } from "./user";
afterEach(cleanup);
beforeEach(() => {
    mocks.policy = "allowed";
    mocks.tickets = [];
    mocks.request.mockReset();
    mocks.saveError.mockReset();
});
describe("help and ticket interactions", () => {
    it("offers expandable self-service topics before the contact entry", () => {
        const { container } = render(
            <>
                <HelpGuides />
                <ContactSupport />
            </>,
        );
        expect(container.querySelectorAll("details")).toHaveLength(8);
        expect(
            screen
                .getByRole("link", { name: "联系客服 / 查看已有工单" })
                .getAttribute("href"),
        ).toBe("#/ticket");
    });
    it("opens the existing ticket instead of another creation form", () => {
        mocks.tickets = [{ id: 12, status: 0, subject: "Existing" }];
        render(<Tickets />);
        expect(screen.queryByRole("button", { name: "创建工单" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "继续已有工单" }));
        expect(screen.getByRole("dialog", { name: "现有工单" })).toBeTruthy();
    });
    it("adds the order number from an order help link to the submitted ticket", async () => {
        mocks.request.mockResolvedValue({ data: [] });
        render(<Tickets orderTradeNo="ORDER123" />);
        fireEvent.click(screen.getByRole("button", { name: "创建工单" }));
        fireEvent.click(screen.getByRole("button", { name: "提交测试工单" }));
        await waitFor(() =>
            expect(mocks.request).toHaveBeenCalledWith("user/ticket/save", {
                subject: "[支付问题] 未到账",
                level: 0,
                message: "关联订单: ORDER123\n\n详情",
            }),
        );
    });
    it("rechecks for a newly opened ticket before submitting another", async () => {
        mocks.request.mockResolvedValue({ data: [{ id: 12, status: 0 }] });
        render(<Tickets />);
        fireEvent.click(screen.getByRole("button", { name: "创建工单" }));
        fireEvent.click(screen.getByRole("button", { name: "提交测试工单" }));
        await waitFor(() => expect(mocks.saveError).toHaveBeenCalledWith(expect.objectContaining({message:"已有未关闭的工单请继续回复，避免重复提交。"})));
        expect(mocks.request).toHaveBeenCalledTimes(1);
    });
    it("keeps admin ticket management separate from self-service prompts", () => {
        render(<Tickets isAdmin />);
        expect(
            screen.queryByRole("link", { name: "先查看帮助中心" }),
        ).toBeNull();
        expect(screen.queryByRole("button", { name: "创建工单" })).toBeNull();
    });
});

it.each(["closed", "purchase_required"])("disables new tickets for policy %s", (policy) => {
    mocks.policy = policy;
    render(<Tickets />);
    expect((screen.getByRole("button", {name: "创建工单"}) as HTMLButtonElement).disabled).toBe(true);
});
