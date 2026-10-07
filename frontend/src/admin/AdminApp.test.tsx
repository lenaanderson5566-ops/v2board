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

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); location.hash = ""; mocks.logout.mockResolvedValue(undefined); });
afterEach(cleanup);
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
