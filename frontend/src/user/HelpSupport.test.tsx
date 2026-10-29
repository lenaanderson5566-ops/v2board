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
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({ detail:null as any, detailError: "", detailReload: vi.fn(), policy: "allowed", tickets: [] as any[], request: vi.fn(), saveError: vi.fn() }));
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
vi.mock("../shared/ui", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../shared/ui")>()),
    useData: vi.fn((path: string) => ({
        data: path === "user/info" ? { ticket_creation: mocks.policy } : path.includes("id=")
            ? (mocks.detailError ? null : mocks.detail || { subject: "现有工单", status: 1, message: [] })
            : mocks.tickets,
        loading: false,
        error: path.includes("id=") ? mocks.detailError : "",
        reload: path.includes("id=") ? mocks.detailReload : vi.fn(),
    })),
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
    mocks.detail = null;
    mocks.detailError = "";
    mocks.detailReload.mockReset();
    location.hash = "";
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

it.each(["closed", "purchase_required"])("hides new tickets for policy %s", (policy) => {
    mocks.policy = policy;
    render(<Tickets />);
    expect(screen.queryByRole("button", {name: "创建工单"})).toBeNull();
});
it("hides an open creation dialog if ticket creation is closed", () => {
    const view=render(<Tickets />);
    fireEvent.click(screen.getByRole("button",{name:"创建工单"}));
    mocks.policy="closed";view.rerender(<Tickets />);
    expect(screen.queryByRole("dialog",{name:"创建工单"})).toBeNull();
});
it("preserves existing ticket access when new tickets are closed", () => {
    mocks.policy="closed";mocks.tickets=[{id:12,status:0,subject:"Existing"}];
    render(<Tickets />);
    expect(screen.getByRole("button",{name:"继续已有工单"})).toBeTruthy();
});

it("acknowledges a displayed reply once even when ticket data refreshes",async()=>{
 location.hash="#/ticket?ticketId=42";mocks.detail={id:42,subject:"Reply test",status:1,message:[{id:8,is_me:false,message:"Support reply"}]};mocks.request.mockResolvedValue({data:true});
 const {Tickets}=await import("../shared/Tickets");const view=render(<Tickets/>);
 await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("user/notice/readTicket",{id:42,version:8}));
 mocks.detail={...mocks.detail};view.rerender(<Tickets/>);
 expect(mocks.request.mock.calls.filter(([path])=>path==="user/notice/readTicket")).toHaveLength(1);
 mocks.detail=null;location.hash="";
});

it("does not preload ticket detail until a ticket is opened",async()=>{
    location.hash="#/ticket";
    const {useData}=await import("../shared/ui");vi.mocked(useData).mockClear();
    render(<Tickets/>);
    expect(useData).toHaveBeenCalledWith("");
});
it("retries a failed ticket detail without closing its dialog", () => {
    location.hash = "#/ticket?ticketId=42";
    mocks.detailError = "ticket temporarily unavailable";
    const view = render(<Tickets />);
    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("alert").textContent).toContain(mocks.detailError);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.detailReload).toHaveBeenCalledTimes(1);
    mocks.detail = { id: 42, subject: "Recovered ticket", status: 1, message: [{ id: 8, is_me: true, message: "Existing message" }] };
    mocks.detailError = "";
    view.rerender(<Tickets />);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByText("Existing message")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
});
it("debounces knowledge searches and skips the unused category request",async()=>{
    vi.useFakeTimers();
    try {
        const {Knowledge}=await import("./user");
        const {useData}=await import("../shared/ui");vi.mocked(useData).mockClear();
        render(<Knowledge/>);
        const input=screen.getByLabelText("搜索文档");
        fireEvent.change(input,{target:{value:"h"}});fireEvent.change(input,{target:{value:"help"}});
        let paths=vi.mocked(useData).mock.calls.map(([path])=>path);
        expect(paths.some(path=>path.includes("keyword=h"))).toBe(false);
        await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
        paths=vi.mocked(useData).mock.calls.map(([path])=>path);
        expect(paths.some(path=>path.includes("keyword=help"))).toBe(true);
        expect(paths.some(path=>path.includes("getCategory"))).toBe(false);
    } finally {vi.useRealTimers();}
});
