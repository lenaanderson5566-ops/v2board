// @vitest-environment jsdom
vi.mock("../shared/account-copy", () => ({ ac: (key: string) => key }));
vi.mock("./help-copy", () => ({ h: (key: string) => key }));
vi.mock("../shared/credit-copy", () => ({ c: (key: string) => key, minuteDate: (v: unknown) => String(v) }));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn(), readRequest: vi.fn() }));
vi.mock("../shared/api", () => ({
    boot: { mode: "user", title: "Test" },
    request: mocks.request,
    readRequest: mocks.readRequest,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({}) }));
vi.mock("../shared/i18n", () => ({
    default: { addResourceBundle: () => undefined },
    tx: (key: string) => key,
    locale: () => "zh-CN",
    languages: [],
}));
vi.mock("../shared/billing-copy", () => ({ b: (key: string) => key }));
vi.mock("../shared/experience-copy", () => ({ e: (key: string) => key }));
vi.mock("../shared/ux", () => ({ ux: (key: string) => key }));
import { Notifications } from "./user";
afterEach(cleanup);
beforeEach(() => {
    mocks.request.mockReset();
    mocks.readRequest.mockReset();
    mocks.readRequest.mockResolvedValue({
        data: {
            email: "test@example.com",
            remind_service: 1,
            remind_expire: 1,
            remind_traffic: 0,
            balance: 1000,
        },
    });
});
it("saves only the changed field without a save button", async () => {
    mocks.request.mockResolvedValue({ data: true });
    render(<Notifications />);
    const expiry = await screen.findByRole("switch", { name: "到期提醒" });
    expect(expiry.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    fireEvent.click(expiry);
    await screen.findByText("saved");
    expect(mocks.request).toHaveBeenCalledWith("user/update", { remind_expire: 0 });
    expect(expiry.getAttribute("aria-checked")).toBe("false");
    expect(mocks.readRequest).toHaveBeenCalledTimes(1);
});
it("restores a failed choice and allows retry", async () => {
    mocks.request.mockRejectedValueOnce(Error("temporary failure")).mockResolvedValueOnce({ data: true });
    render(<Notifications />);
    const usage = await screen.findByRole("switch", { name: "quotaNotice" });
    fireEvent.click(usage);
    await screen.findByText("notificationFailed");
    expect(usage.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("saved")).toBeNull();
    fireEvent.click(usage);
    await screen.findByText("saved");
    expect(usage.getAttribute("aria-checked")).toBe("true");
    expect(mocks.request).toHaveBeenCalledTimes(2);
});
it("blocks duplicate clicks while other settings save independently", async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValue({ data: true });
    render(<Notifications />);
    const service = await screen.findByRole("switch", { name: "serviceNotice" });
    fireEvent.click(service);
    fireEvent.click(service);
    expect((service as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "quotaNotice" }));
    await screen.findByText("saved");
    expect(mocks.request.mock.calls).toEqual([["user/update", { remind_service: 0 }], ["user/update", { remind_traffic: 1 }]]);
    resolve({ data: true });
    await waitFor(() => expect((service as HTMLButtonElement).disabled).toBe(false));
    expect(service.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "quotaNotice" }).getAttribute("aria-checked")).toBe("true");
});
