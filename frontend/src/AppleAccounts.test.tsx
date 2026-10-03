// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", () => ({ request: mocks.request }));
vi.mock("./i18n", () => ({ default: { addResourceBundle: vi.fn() }, tx: (s: string) => s }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./ui", () => ({ Modal: ({ children, close }: any) => <div><button onClick={close}>close</button>{children}</div> }));
import { AppleAccounts } from "./AppleAccounts";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("loads only on demand, hides password, and clears credentials on close", async () => {
    mocks.request.mockResolvedValue({ data: [{ username: "test-account", password: "secret-value", available: true }] });
    render(<AppleAccounts />);
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("0"));
    await screen.findByText("test-account");
    expect(screen.queryByText("secret-value")).toBeNull();
    fireEvent.click(screen.getByText("8"));
    expect(screen.getByText("secret-value")).toBeTruthy();
    fireEvent.click(screen.getByText("close"));
    expect(screen.queryByText("secret-value")).toBeNull();
});
it("recovers from upstream failure with a manual retry", async () => {
    mocks.request.mockRejectedValueOnce(new Error("private error")).mockResolvedValueOnce({ data: [] });
    render(<AppleAccounts />);
    fireEvent.click(screen.getByText("0"));
    await screen.findByRole("alert");
    expect(screen.queryByText("private error")).toBeNull();
    fireEvent.click(screen.getByText("5"));
    await screen.findByText("4");
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
});
it("shows an unavailable account without password actions", async () => {
    mocks.request.mockResolvedValue({ data: [{ username: "unavailable-account", available: false, status: "disabled" }] });
    render(<AppleAccounts />);
    fireEvent.click(screen.getByText("0"));
    await screen.findByText("unavailable-account");
    expect(screen.queryByText("7")).toBeNull();
    expect(screen.queryByText("8")).toBeNull();
});
