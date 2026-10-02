// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    reload: vi.fn(),
    inbox: {} as any,
    detail: {} as any,
    loading: false,
    error: "",
}));
vi.mock("./api", () => ({
    request: mocks.request,
    date: (n: number) => String(n),
}));
vi.mock("./i18n", () => ({ tx: (s: string) => s }));
vi.mock("./announcement-copy", () => ({
    a: (s: string, v?: any) => (v ? `${s} ${v.count}` : s),
}));
vi.mock("./ui", () => ({
    useData: (path: string) => ({
        data: path.includes("inbox") ? mocks.inbox : mocks.detail,
        reload: mocks.reload,
        loading: mocks.loading,
        error: mocks.error,
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
