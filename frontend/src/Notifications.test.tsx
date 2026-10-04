// @vitest-environment jsdom
vi.mock("./help-copy", () => ({ h: (key: string) => key }));
vi.mock("./credit-copy", () => ({ c: (key: string) => key, minuteDate: (v: unknown) => String(v) }));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn(), readRequest: vi.fn() }));
vi.mock("./api", () => ({
    boot: { mode: "user", title: "Test" },
    request: mocks.request,
    readRequest: mocks.readRequest,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
vi.mock("./i18n", () => ({
    default: { addResourceBundle: () => undefined },
    tx: (key: string) => key,
    locale: () => "zh-CN",
    languages: [],
}));
vi.mock("./billing-copy", () => ({ b: (key: string) => key }));
vi.mock("./experience-copy", () => ({ e: (key: string) => key }));
vi.mock("./ux", () => ({ ux: (key: string) => key }));
import { Notifications } from "./user";
afterEach(cleanup);
beforeEach(() => {
    mocks.request.mockReset();
    mocks.readRequest.mockReset();
    mocks.readRequest.mockResolvedValue({
        data: {
            email: "test@example.com",
            remind_expire: 1,
            remind_traffic: 0,
            balance: 1000,
        },
    });
});
it("loads existing notification choices and saves only the two reminder fields", async () => {
    mocks.request.mockResolvedValue({ data: true });
    render(<Notifications />);
    const expiry = await screen.findByRole("switch", { name: "到期提醒" });
    const usage = screen.getByRole("switch", { name: "流量提醒" });
    expect(expiry.getAttribute("aria-checked")).toBe("true");
    expect(usage.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(expiry);
    fireEvent.click(usage);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith("user/update", {
            remind_expire: 0,
            remind_traffic: 1,
        }),
    );
    expect((await screen.findByRole("status")).textContent).toBe("saved");
});
it("shows a failed save without claiming success and allows retry", async () => {
    mocks.request.mockRejectedValue(Error("temporary failure"));
    render(<Notifications />);
    await screen.findByRole("switch", { name: "到期提醒" });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("temporary failure");
    expect(screen.queryByText("saved")).toBeNull();
    await waitFor(() =>
        expect(
            (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
                .disabled,
        ).toBe(false),
    );
});
