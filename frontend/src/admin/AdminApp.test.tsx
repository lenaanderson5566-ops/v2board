// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    render,
    screen,
    waitFor,
    fireEvent,
    act,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    logout: vi.fn(),
    navigate: vi.fn(),
    initialize: vi.fn(),
    setAdminSessionLanguage: vi.fn(async (_authenticated: boolean) => {}),
    hasSession: true,
}));
vi.mock("../shared/api", () => ({
    boot: { mode: "admin", adminPath: "test-admin" },
    storageKey: "admin-test",
    request: mocks.request,
    logoutSession: mocks.logout,
    navigate: mocks.navigate,
}));
vi.mock("../shared/browser-session", () => ({
    initializeBrowserSession: mocks.initialize,
    hasBrowserSession: () => mocks.hasSession,
}));
vi.mock("../shared/i18n", () => ({
    tx: (text: string) => text,
    setAdminSessionLanguage: mocks.setAdminSessionLanguage,
}));
vi.mock("./AdminAuth", () => ({
    AdminAuth: ({ notice }: { notice?: string }) => <div>Admin login{notice && <p>{notice}</p>}</div>,
}));
vi.mock("./admin-workspace", () => ({
    default: ({ path, logout }: { path: string; logout: () => void }) => (
        <div className="admin-content">
            Admin workspace<button onClick={logout}>Logout</button>
            <output data-testid="workspace-path">{path}</output>
        </div>
    ),
}));
import AdminApp from "./AdminApp";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.request.mockReset();
    mocks.initialize.mockReset().mockResolvedValue(undefined);
    mocks.hasSession = true;
    mocks.navigate.mockReset();
    localStorage.clear();
    history.replaceState(null, "", location.pathname);
    mocks.logout.mockResolvedValue(undefined);
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});
it("restores a session only after the backend confirms administrative access", async () => {
    localStorage.setItem("admin-test", "test-session");
    mocks.request.mockResolvedValue({ data: { email: "admin@example.test" } });
    render(<AdminApp />);
    await screen.findByText("Admin workspace");
    expect(mocks.request.mock.calls.map((call) => call[0])).toEqual([
        "user/info",
        "test-admin/config/fetch",
    ]);
    expect(mocks.setAdminSessionLanguage).toHaveBeenCalledWith(true, expect.any(Function));
    fireEvent.click(screen.getByText("Logout"));
    fireEvent.click(screen.getByText("Logout"));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
    await screen.findByText("Admin login");
    expect(mocks.setAdminSessionLanguage).toHaveBeenLastCalledWith(false);
});
it("returns to login when the saved session lacks administrative access", async () => {
    localStorage.setItem("admin-test", "test-session");
    mocks.request
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { status: 403 }),
        );
    render(<AdminApp />);
    await screen.findByText("Admin login");
    expect(screen.queryByText("Admin workspace")).toBeNull();
});

it("retains an unverified administrative session after a temporary failure and retries only the permission reads", async () => {
    mocks.request
        .mockRejectedValueOnce(
            Object.assign(new Error("internal detail"), { status: 503 }),
        )
        .mockResolvedValueOnce({ data: { email: "admin@example.test" } })
        .mockResolvedValueOnce({ data: {} });
    render(<AdminApp />);
    await screen.findByText("Check your connection and try again.");
    expect(screen.queryByText("Admin login")).toBeNull();
    expect(screen.queryByText("internal detail")).toBeNull();
    // The recovery DOM can appear before React runs its focus effect.
    await waitFor(() =>
        expect(document.activeElement).toBe(
            screen.getByRole("heading", { name: "This page could not load" }),
        ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: /Checking|Retry/ }));
    await screen.findByText("Admin workspace");
    expect(mocks.request.mock.calls.map((call) => call[0])).toEqual([
        "user/info",
        "user/info",
        "test-admin/config/fetch",
    ]);
    expect(mocks.logout).not.toHaveBeenCalled();
});
it("keeps bootstrap failures recoverable without showing a misleading login form", async () => {
    mocks.initialize.mockRejectedValueOnce(new Error("offline bootstrap"));
    mocks.request.mockResolvedValue({ data: { email: "admin@example.test" } });
    render(<AdminApp />);
    await screen.findByText("Check your connection and try again.");
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Admin workspace");
    expect(mocks.initialize).toHaveBeenCalledTimes(2);
});
it("respects Retry-After while administrative session reads are rate limited", async () => {
    mocks.request.mockRejectedValue(
        Object.assign(new Error("Too many attempts"), {
            status: 429,
            retryAfter: 60,
        }),
    );
    render(<AdminApp />);
    await screen.findByText("Check your connection and try again.");
    const retry = screen.getByRole("button", { name: /^Retry in \d+s$/ });
    expect((retry as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(retry);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.logout).not.toHaveBeenCalled();
});
it("discards late session reads after expiry instead of reopening the workspace", async () => {
    let finish!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    render(<AdminApp />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    fireEvent(window, new Event("auth-expired"));
    await screen.findByText("Admin login");
    await act(async () => {
        finish({ data: { email: "admin@example.test" } });
    });
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(screen.queryByText("Admin workspace")).toBeNull();
});

it("clears administrative data and shows a persistent error if offline revocation cannot be queued", async () => {
    mocks.request.mockResolvedValue({ data: { email: "admin@example.test" } });
    mocks.logout.mockRejectedValue(new Error("退出未完成，请联网后重试。"));
    render(<AdminApp />);
    await screen.findByText("Admin workspace");
    fireEvent.click(screen.getByText("Logout"));
    await screen.findByText("Admin login");
    expect(screen.queryByText("Admin workspace")).toBeNull();
    expect(screen.getByText("Sign-out is incomplete. Reconnect and try again.")).toBeTruthy();
});

it.each(["logout", "expired"])(
    "releases route protection after %s while retaining it for authenticated drafts",
    async (reason) => {
        mocks.request.mockResolvedValue({
            data: { email: "admin@example.test" },
        });
        mocks.navigate.mockImplementation((path: string) => {
            history.replaceState(null, "", `#/${path}`);
            fireEvent(window, new HashChangeEvent("hashchange"));
        });
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
        const marker = document.createElement("div");
        marker.dataset.unsaved = "true";
        render(<AdminApp />);
        await screen.findByText("Admin workspace");
        document.body.append(marker);
        try {
            history.replaceState(null, "", "#/users");
            fireEvent(window, new HashChangeEvent("hashchange"));
            expect(confirm).toHaveBeenCalledOnce();
            expect(location.hash).toBe("");
            confirm.mockClear();
            if (reason === "logout")
                fireEvent.click(screen.getByText("Logout"));
            else fireEvent(window, new Event("auth-expired"));
            await screen.findByText("Admin login");
            history.replaceState(null, "", "#/forget");
            fireEvent(window, new HashChangeEvent("hashchange"));
            expect(confirm).not.toHaveBeenCalled();
            expect(location.hash).toBe("#/forget");
        } finally {
            marker.remove();
        }
    },
);

it("accepts same-workspace history changes only after checking a draft or save", async () => {
    const reviews = "invitations?tab=reviews&review_id=42";
    const commissions = "invitations?tab=commissions&user_id=7";
    history.replaceState(null, "", `#/${reviews}`);
    mocks.request.mockResolvedValue({ data: { email: "admin@example.test" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminApp />);
    const path = await screen.findByTestId("workspace-path");
    expect(path.textContent).toBe(reviews);
    const editor = path.parentElement!;
    const marker = document.createElement("div");
    marker.dataset.unsaved = "true";
    editor.append(marker);
    function visitCommissions() {
        history.pushState(null, "", `#/${commissions}`);
        fireEvent(window, new HashChangeEvent("hashchange"));
    }
    try {
        visitCommissions();
        expect(confirm).toHaveBeenCalledOnce();
        expect(location.hash).toBe(`#/${reviews}`);
        expect(path.textContent).toBe(reviews);

        marker.dataset.saving = "true";
        visitCommissions();
        expect(confirm).toHaveBeenCalledOnce();
        expect(location.hash).toBe(`#/${reviews}`);
        expect(path.textContent).toBe(reviews);

        delete marker.dataset.saving;
        const dialog = document.createElement("section");
        dialog.className = "modal";
        const form = document.createElement("form");
        form.setAttribute("aria-busy", "true");
        dialog.append(form);
        document.body.append(dialog);
        try {
            visitCommissions();
            expect(confirm).toHaveBeenCalledOnce();
            expect(location.hash).toBe(`#/${reviews}`);
            expect(path.textContent).toBe(reviews);
        } finally {
            dialog.remove();
        }

        confirm.mockReturnValue(true);
        visitCommissions();
        expect(path.textContent).toBe(commissions);
        marker.remove();
        history.back();
        await waitFor(() => expect(path.textContent).toBe(reviews));
        history.forward();
        await waitFor(() => expect(path.textContent).toBe(commissions));
    } finally {
        marker.remove();
    }
});
