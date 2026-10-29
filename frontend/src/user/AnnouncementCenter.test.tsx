// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    act,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    reload: vi.fn(),
    inbox: {} as any,
    detail: {} as any,
    loading: false,
    error: "",
    retryAt: 0,
}));
vi.mock("../shared/api", () => ({
    request: mocks.request,
    date: (n: number) => String(n),
}));
vi.mock("../shared/i18n", () => ({ tx: (s: string) => s }));
vi.mock("./announcement-copy", () => ({
    a: (s: string, v?: any) => (v ? `${s} ${v.count}` : s),
}));
vi.mock("../shared/ui", () => ({
    useData: (path: string) => ({
        data: path.includes("inbox") ? mocks.inbox : mocks.detail,
        reload: mocks.reload,
        loading: mocks.loading,
        error: mocks.error,
        retryAt: mocks.retryAt,
    }),
    Html: ({ value }: any) => <div>{value}</div>,
    Modal: ({ title, children, close }: any) => (
        <div role="dialog" aria-label={title}>
            <button onClick={close}>close</button>
            {children}
        </div>
    ),
}));
import { AnnouncementCenter, announcementSummary } from "./AnnouncementCenter";
beforeEach(() => {
    mocks.request.mockReset().mockResolvedValue({ data: true });
    mocks.reload.mockReset();
    mocks.inbox = {
        items: [
            {
                id: 1,
                title: "Service update",
                content: "A **short** summary",
                created_at: 100,
                updated_at: 200,
                is_read: 0,
            },
        ],
        total: 1,
        unread: 1,
    };
    mocks.detail = {
        id: 1,
        title: "Service update",
        content: "Full announcement",
        updated_at: 200,
    };
    mocks.loading = false;
    mocks.error = "";
    mocks.retryAt = 0;
});
afterEach(cleanup);
it("keeps notices out of the page until opened and only records a read after opening the detail", async () => {
    render(<AnnouncementCenter />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "unreadLabel 1" }));
    expect(screen.getByText("A short summary")).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Service update/ }));
    expect(screen.getByText("Full announcement")).toBeTruthy();
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/notice/read", {
            id: 1,
            version: 200,
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(screen.queryByText("Full announcement")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
});
it("retains reading access and offers retry when saving a receipt fails", async () => {
    mocks.request.mockRejectedValueOnce(new Error("Offline"));
    render(<AnnouncementCenter />);
    fireEvent.click(screen.getByRole("button", { name: "unreadLabel 1" }));
    fireEvent.click(screen.getByRole("button", { name: /Service update/ }));
    await screen.findByText("readError");
    expect(screen.getByText("Full announcement")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
});
it("does not mark unavailable content as read", () => {
    mocks.detail = null;
    mocks.error = "Unavailable";
    render(<AnnouncementCenter />);
    fireEvent.click(screen.getByRole("button", { name: "unreadLabel 1" }));
    expect(screen.getByText("loadError")).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
});
it("shows an empty state without an unread indicator", () => {
    mocks.inbox = { items: [], total: 0, unread: 0 };
    render(<AnnouncementCenter />);
    fireEvent.click(screen.getByRole("button", { name: "title" }));
    expect(screen.getByText("emptyHint")).toBeTruthy();
    expect(document.querySelector(".announcement-dot")).toBeNull();
});
it("supports more than one page without automatically acknowledging it", () => {
    mocks.inbox.total = 23;
    render(<AnnouncementCenter />);
    fireEvent.click(screen.getByRole("button", { name: "unreadLabel 1" }));
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
});
it("renders Markdown previews as plain text and strips executable HTML", () => {
    expect(
        announcementSummary(
            "**Hello** <script>alert(1)</script><img src=x onerror=alert(1)> &amp; welcome",
        ),
    ).toBe("Hello & welcome");
});

it("shows private ticket links without acknowledging unseen replies",()=>{
 mocks.inbox.ticketReplies=[{ticket_id:42,message_id:7,created_at:100}];mocks.inbox.ticketUnread=1;
 render(<AnnouncementCenter/>);fireEvent.click(screen.getByRole("button",{name:"unreadLabel 2"}));
 expect(screen.getByRole("link",{name:/ticketReply #42/}).getAttribute("href")).toBe("#/ticket?ticketId=42");
 expect(mocks.request).not.toHaveBeenCalled();
});
it("keeps known notices visible while respecting a list cooldown",async()=>{
 vi.useFakeTimers();
 try {
  mocks.error="Limited";mocks.retryAt=Date.now()+2000;
  render(<AnnouncementCenter/>);fireEvent.click(screen.getByRole("button",{name:"unreadLabel 1"}));
  expect(screen.getByText("A short summary")).toBeTruthy();
  const retry=screen.getByRole("button",{name:"retryIn"});expect((retry as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(retry);expect(mocks.reload).not.toHaveBeenCalled();
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(mocks.reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"重试"}));expect(mocks.reload).toHaveBeenCalledTimes(1);
 }finally {vi.useRealTimers();}
});
it("retains an opened article during a detail cooldown",async()=>{
 vi.useFakeTimers();
 try {
  const view=render(<AnnouncementCenter/>);fireEvent.click(screen.getByRole("button",{name:"unreadLabel 1"}));fireEvent.click(screen.getByRole("button",{name:/Service update/}));
  await act(async()=>{await Promise.resolve();});
  mocks.error="Limited";mocks.retryAt=Date.now()+2000;view.rerender(<AnnouncementCenter/>);
  expect(screen.getByText("Full announcement")).toBeTruthy();
  const reloads=mocks.reload.mock.calls.length;
  const retry=screen.getByRole("button",{name:"retryIn"});expect((retry as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(retry);expect(mocks.reload).toHaveBeenCalledTimes(reloads);
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(mocks.reload).toHaveBeenCalledTimes(reloads);
  fireEvent.click(screen.getByRole("button",{name:"重试"}));expect(mocks.reload).toHaveBeenCalledTimes(reloads+1);
 }finally {vi.useRealTimers();}
});
it("does not automatically resubmit a rate-limited read receipt",async()=>{
 vi.useFakeTimers();
 try {
  mocks.request.mockRejectedValueOnce(Object.assign(new Error("Limited"),{status:429,retryAfter:2}));
  render(<AnnouncementCenter/>);fireEvent.click(screen.getByRole("button",{name:"unreadLabel 1"}));fireEvent.click(screen.getByRole("button",{name:/Service update/}));
  await act(async()=>{await Promise.resolve();});
  const retry=screen.getByRole("button",{name:"retryIn"});expect((retry as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(retry);expect(mocks.request).toHaveBeenCalledTimes(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(mocks.request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"重试"}));await act(async()=>{await Promise.resolve();});
  expect(mocks.request).toHaveBeenCalledTimes(2);
 }finally {vi.useRealTimers();}
});
