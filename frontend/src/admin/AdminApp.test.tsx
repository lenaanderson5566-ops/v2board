// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn(), logout: vi.fn(), navigate: vi.fn() }));
vi.mock("../shared/api", () => ({ boot: { mode: "admin", adminPath: "test-admin" }, storageKey: "admin-test", request: mocks.request, logoutSession: mocks.logout, navigate: mocks.navigate }));
vi.mock("../shared/browser-session", () => ({ initializeBrowserSession: vi.fn().mockResolvedValue(undefined), hasBrowserSession: () => true }));
vi.mock("../shared/i18n", () => ({ tx: (text: string) => text }));
vi.mock("./AdminAuth", () => ({ AdminAuth: () => <div>Admin login</div> }));
vi.mock("./admin-workspace", () => ({ default: ({ logout }: { logout: () => void }) => <div>Admin workspace<button onClick={logout}>Logout</button></div> }));
import AdminApp from "./AdminApp";

beforeEach(() => { vi.clearAllMocks(); mocks.navigate.mockReset(); localStorage.clear(); history.replaceState(null,"",location.pathname); mocks.logout.mockResolvedValue(undefined); });
afterEach(() => {cleanup();vi.restoreAllMocks();});
it("restores a session only after the backend confirms administrative access", async () => {
    localStorage.setItem("admin-test", "test-session");
    mocks.request.mockResolvedValue({ data: { email: "admin@example.test" } });
    render(<AdminApp />);
    await screen.findByText("Admin workspace");
    expect(mocks.request.mock.calls.map(call => call[0])).toEqual(["user/info", "test-admin/config/fetch"]);
    fireEvent.click(screen.getByText("Logout"));
    fireEvent.click(screen.getByText("Logout"));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
    await screen.findByText("Admin login");
});
it("returns to login when the saved session lacks administrative access", async () => {
    localStorage.setItem("admin-test", "test-session");
    mocks.request.mockResolvedValueOnce({ data: {} }).mockRejectedValueOnce(new Error("Forbidden"));
    render(<AdminApp />);
    await screen.findByText("Admin login");
    expect(screen.queryByText("Admin workspace")).toBeNull();

});

it("clears administrative data and shows a persistent error if offline revocation cannot be queued", async () => {
    mocks.request.mockResolvedValue({data:{email:"admin@example.test"}});
    mocks.logout.mockRejectedValue(new Error("退出未完成，请联网后重试。"));
    render(<AdminApp />);
    await screen.findByText("Admin workspace");
    fireEvent.click(screen.getByText("Logout"));
    await screen.findByText("Admin login");
    expect(screen.queryByText("Admin workspace")).toBeNull();
    expect(screen.getByText("退出未完成，请联网后重试。")).toBeTruthy();
});

it.each(["logout", "expired"])("releases route protection after %s while retaining it for authenticated drafts", async (reason) => {
    mocks.request.mockResolvedValue({data:{email:"admin@example.test"}});
    mocks.navigate.mockImplementation((path:string)=>{
        history.replaceState(null,"",`#/${path}`);
        fireEvent(window,new HashChangeEvent("hashchange"));
    });
    const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    const marker=document.createElement("div");
    marker.dataset.unsaved="true";
    render(<AdminApp />);
    await screen.findByText("Admin workspace");
    document.body.append(marker);
    try {
        history.replaceState(null,"","#/users");
        fireEvent(window,new HashChangeEvent("hashchange"));
        expect(confirm).toHaveBeenCalledOnce();
        expect(location.hash).toBe("");
        confirm.mockClear();
        if(reason==="logout") fireEvent.click(screen.getByText("Logout"));
        else fireEvent(window,new Event("auth-expired"));
        await screen.findByText("Admin login");
        history.replaceState(null,"","#/forget");
        fireEvent(window,new HashChangeEvent("hashchange"));
        expect(confirm).not.toHaveBeenCalled();
        expect(location.hash).toBe("#/forget");
    } finally {marker.remove();}
});
