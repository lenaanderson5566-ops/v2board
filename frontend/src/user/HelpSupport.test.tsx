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
const mocks = vi.hoisted(() => ({ knowledge:{} as any, detail:null as any, detailError: "", detailLoading: false, detailRetryAt: 0, detailReload: vi.fn(), accountError: "", accountLoading: false, accountRetryAt: 0, accountReload: vi.fn(), realEditor: false, policy: "allowed", tickets: [] as any[], request: vi.fn(), date: vi.fn(() => "date"), saveError: vi.fn() }));
vi.mock("../shared/i18n", () => ({
    default: { addResourceBundle: () => undefined, t: (key: string) => key },
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
    date: mocks.date,
}));
vi.mock("../shared/ui", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../shared/ui")>();
    return {
    ...actual,
    useData: vi.fn((path: string) => ({
        data: path === "user/info" ? { ticket_creation: mocks.policy } : path.startsWith("user/knowledge/fetch") && !path.includes("id=") ? mocks.knowledge : path.includes("id=")
            ? (mocks.detail || (mocks.detailError ? null : { subject: "现有工单", status: 1, message: [] }))
            : mocks.tickets,
        loading: path === "user/info" ? mocks.accountLoading : path.includes("id=") ? mocks.detailLoading : false,
        error: path === "user/info" ? mocks.accountError : path.includes("id=") ? mocks.detailError : "",
        retryAt: path === "user/info" ? mocks.accountRetryAt : path.includes("id=") ? mocks.detailRetryAt : 0,
        reload: path === "user/info" ? mocks.accountReload : path.includes("id=") ? mocks.detailReload : vi.fn(),
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
    Editor: (props: any) => mocks.realEditor ? <actual.Editor {...props} /> : (
        <button
            onClick={() =>
                Promise.resolve(props.onSave({ ...props.initial, subject: "未到账", message: "详情" })).catch(mocks.saveError)
            }
        >
            提交测试工单
        </button>
    ),
}; });
import { HelpGuides, ContactSupport } from "./HelpGuides";
import { Tickets } from "./user";
import { browserSessionKey } from "../shared/browser-session";
import { sessionPreferences } from "../shared/browser-storage";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => {
    mocks.policy = "allowed";
    mocks.detail = null;
    mocks.knowledge = {};
    mocks.detailError = "";
    mocks.detailLoading = false;
    mocks.detailRetryAt = 0;
    mocks.accountError = "";
    mocks.accountLoading = false;
    mocks.accountRetryAt = 0;
    mocks.accountReload.mockReset();
    mocks.realEditor = false;
    mocks.detailReload.mockReset();
    mocks.date.mockClear();
    location.hash = "";
    mocks.tickets = [];
    mocks.request.mockReset();
    mocks.saveError.mockReset();
    sessionStorage.clear();
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
        const input=screen.getByLabelText("searchAll");
        expect(screen.getAllByRole("searchbox")).toHaveLength(1);
        fireEvent.change(input,{target:{value:"h"}});fireEvent.change(input,{target:{value:"help"}});
        let paths=vi.mocked(useData).mock.calls.map(([path])=>path);
        expect(paths.some(path=>path.includes("keyword=h"))).toBe(false);
        await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
        paths=vi.mocked(useData).mock.calls.map(([path])=>path);
        expect(paths.some(path=>path.includes("keyword=help"))).toBe(true);
        expect(paths.some(path=>path.includes("getCategory"))).toBe(false);
    } finally {vi.useRealTimers();}
});
it("uses the same search for FAQ answers and remote documents", async () => {
    vi.useFakeTimers();
    try {
        const { Knowledge } = await import("./user");
        const { useData } = await import("../shared/ui");
        const view = render(<Knowledge />);
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "qImport" } });
        expect(view.container.querySelectorAll("details")).toHaveLength(1);
        expect(screen.getByText("qImport")).toBeTruthy();
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        expect(vi.mocked(useData).mock.calls.some(([path]) => path.includes("keyword=qImport"))).toBe(true);
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "unknown-topic" } });
        fireEvent.click(screen.getByRole("button", { name: "clear" }));
        expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
        expect(view.container.querySelectorAll("details")).toHaveLength(8);
    } finally { vi.useRealTimers(); }
});
it("retries a failed knowledge article inside the same dialog", async () => {
    const { Knowledge } = await import("./user");
    mocks.knowledge = { Setup: [{ id: 8, title: "Client setup" }] };
    mocks.detailError = "article temporarily unavailable";
    const view = render(<Knowledge />);
    fireEvent.click(screen.getByRole("button", { name: "Client setup" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.detailReload).toHaveBeenCalledTimes(1);
    mocks.detailError = "";
    mocks.detail = { id: 8, title: "Client setup", body: "Recovered article" };
    view.rerender(<Knowledge />);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByText("Recovered article")).toBeTruthy();
});

it("uses minute precision for user ticket messages without altering their source time", async () => {
    location.hash = "#/ticket?ticketId=42";
    mocks.detail = { id: 42, subject: "Timestamp ticket", status: 1, message: [{ id: 8, is_me: true, created_at: 1793404800, message: "Reply" }] };
    const { Tickets: SharedTickets } = await import("../shared/Tickets");
    render(<SharedTickets />);
    expect(screen.getByText("Reply")).toBeTruthy();
    expect(mocks.date).toHaveBeenCalledWith(1793404800, { second: undefined });
});

it("keeps new ticket drafts separate for each order and restores the matching draft", () => {
    mocks.realEditor = true;
    const first = render(<Tickets orderTradeNo="ORDER_A" />);
    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));
    fireEvent.change(screen.getByRole("textbox", { name: /问题描述/ }), { target: { value: "Order A needs help" } });
    first.unmount();
    const second = render(<Tickets orderTradeNo="ORDER_B" />);
    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));
    expect(screen.getByText("ORDER_B")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: /问题描述/ }) as HTMLTextAreaElement).value).toBe("");
    second.unmount();
    render(<Tickets orderTradeNo="ORDER_A" />);
    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));
    expect((screen.getByRole("textbox", { name: /问题描述/ }) as HTMLTextAreaElement).value).toBe("Order A needs help");
});

it.each([undefined, "ORDER_B"])("does not let a restored draft override the current order %s", async (orderTradeNo) => {
    mocks.realEditor = true;
    mocks.request.mockResolvedValue({ data: [] });
    const draft = orderTradeNo ? `ticket-new-order-${orderTradeNo}` : "ticket-new";
    sessionPreferences.setItem(`fastai.draft.user.${browserSessionKey()}.${draft}`, JSON.stringify({
        topic: "payment", level: 0, subject: "Saved question", message: "Saved description", order_trade_no: "OLD_ORDER",
    }));
    render(<Tickets orderTradeNo={orderTradeNo} />);
    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("user/ticket/save", {
        subject: "[支付问题] Saved question", level: 0,
        message: `${orderTradeNo ? `关联订单: ${orderTradeNo}\n\n` : ""}Saved description`,
    }));
});

it("explains a failed permissions check and retries without hiding existing tickets", () => {
    mocks.accountError = "permission request failed";
    mocks.tickets = [{ id: 12, status: 0, subject: "Existing" }];
    render(<Tickets />);
    expect(screen.getByRole("alert").textContent).toContain("暂时无法确认工单创建权限");
    expect(screen.getByRole("button", { name: "继续已有工单" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.accountReload).toHaveBeenCalledTimes(1);
});

it("respects the permissions retry deadline and restores creation after recovery", () => {
    vi.useFakeTimers();
    mocks.accountError = "limited";
    mocks.accountRetryAt = Date.now() + 10000;
    const view = render(<Tickets />);
    expect((screen.getByRole("button", { name: "retryIn" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => vi.advanceTimersByTime(10000));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.accountReload).toHaveBeenCalledTimes(1);
    mocks.accountError = "";
    mocks.accountRetryAt = 0;
    view.rerender(<Tickets />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "创建工单" })).toBeTruthy();
});

it("refreshes open conversations only while visible, online and outside request limits", () => {
    vi.useFakeTimers();
    location.hash = "#/ticket?ticketId=42";
    mocks.detail = { id: 42, subject: "Active ticket", status: 0, message: [] };
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const view = render(<Tickets />);
    act(() => vi.advanceTimersByTime(30000));
    expect(mocks.detailReload).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("hidden");
    act(() => vi.advanceTimersByTime(30000));
    visibility.mockReturnValue("visible");
    online.mockReturnValue(false);
    act(() => vi.advanceTimersByTime(30000));
    expect(mocks.detailReload).toHaveBeenCalledTimes(1);
    online.mockReturnValue(true);
    mocks.detailRetryAt = Date.now() + 90000;
    view.rerender(<Tickets />);
    act(() => vi.advanceTimersByTime(60000));
    expect(mocks.detailReload).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "retryIn" }) as HTMLButtonElement).disabled).toBe(true);
    mocks.detailRetryAt = 0;
    mocks.detailLoading = true;
    view.rerender(<Tickets />);
    act(() => vi.advanceTimersByTime(30000));
    expect(mocks.detailReload).toHaveBeenCalledTimes(1);
    mocks.detailLoading = false;
    view.rerender(<Tickets />);
    fireEvent.click(screen.getByRole("button", { name: "刷新回复" }));
    expect(mocks.detailReload).toHaveBeenCalledTimes(2);
    mocks.detail = { ...mocks.detail, status: 1 };
    view.rerender(<Tickets />);
    act(() => vi.advanceTimersByTime(60000));
    expect(mocks.detailReload).toHaveBeenCalledTimes(2);
    view.unmount();
    act(() => vi.advanceTimersByTime(60000));
    expect(mocks.detailReload).toHaveBeenCalledTimes(2);
});

it("keeps the reply editor, draft and focus while refreshed messages arrive", () => {
    mocks.realEditor = true;
    location.hash = "#/ticket?ticketId=42";
    mocks.detail = { id: 42, subject: "Active ticket", status: 0, message: [] };
    mocks.request.mockResolvedValue({ data: true });
    const view = render(<Tickets />);
    const editor = screen.getByRole("textbox", { name: /回复内容/ }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "My unfinished reply" } });
    editor.focus();
    editor.setSelectionRange(3, 7);
    const dialog = screen.getByRole("dialog");
    dialog.scrollTop = 120;
    mocks.detailLoading = true;
    view.rerender(<Tickets />);
    mocks.detailLoading = false;
    mocks.detail = { ...mocks.detail, message: [{ id: 8, is_me: false, message: "New support reply" }] };
    view.rerender(<Tickets />);
    expect(screen.getByText("New support reply")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /回复内容/ })).toBe(editor);
    expect(editor.value).toBe("My unfinished reply");
    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([3, 7]);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(dialog.scrollTop).toBe(120);
});

it("pauses background and manual refresh while a reply is being sent", async () => {
    vi.useFakeTimers();
    mocks.realEditor = true;
    location.hash = "#/ticket?ticketId=42";
    mocks.detail = { id: 42, subject: "Active ticket", status: 0, message: [] };
    let finishReply!: () => void;
    mocks.request.mockImplementation(() => new Promise<void>((resolve) => { finishReply = resolve; }));
    render(<Tickets />);
    fireEvent.change(screen.getByRole("textbox", { name: /回复内容/ }), { target: { value: "Please check my order" } });
    fireEvent.click(screen.getByRole("button", { name: "发送回复" }));
    expect((screen.getByRole("button", { name: "刷新回复" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => vi.advanceTimersByTime(60000));
    expect(mocks.detailReload).not.toHaveBeenCalled();
    await act(async () => { finishReply(); });
    expect(mocks.detailReload).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("textbox", { name: /回复内容/ }) as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByRole("button", { name: "刷新回复" }) as HTMLButtonElement).disabled).toBe(false);
});
