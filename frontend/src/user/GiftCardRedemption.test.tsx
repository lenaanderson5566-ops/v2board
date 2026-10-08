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
    clear: vi.fn(),
    redeemed: vi.fn(),
    close: vi.fn(),
}));
vi.mock("../shared/api", () => ({
    request: mocks.request,
    clearReadCache: mocks.clear,
}));
vi.mock("../shared/i18n", () => ({ tx: (key: string) => key }));
vi.mock("../shared/account-copy", () => ({ ac: (key: string) => key }));
vi.mock("../shared/ui", () => ({
    Modal: ({ children, close }: any) => (
        <div role="dialog">
            <button onClick={close}>close</button>
            {children}
        </div>
    ),
}));
import { GiftCardRedemption } from "./GiftCardRedemption";
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
const open = (email: string | undefined = "member@example.com") =>
    render(
        <GiftCardRedemption
            email={email}
            close={mocks.close}
            redeemed={mocks.redeemed}
        />,
    );
const input = (code: string) =>
    fireEvent.change(screen.getByLabelText("礼品卡代码"), {
        target: { value: code },
    });
it("shows the recipient and prevents empty codes", () => {
    open();
    expect(screen.getByText("member@example.com")).toBeTruthy();
    input("   ");
    expect(
        (screen.getByRole("button", { name: "兑换" }) as HTMLButtonElement)
            .disabled,
    ).toBe(true);
});
it("trims without changing case, blocks duplicates and closing while pending, then shows success", async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementation(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    open();
    input("  Ab-Cd  ");
    const form = screen.getByLabelText("礼品卡代码").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.click(screen.getByText("close"));
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith("user/redeemgiftcard", {
        giftcard: "Ab-Cd",
    });
    resolve({ data: true });
    await screen.findByRole("status");
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.redeemed).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("礼品卡代码")).toBeNull();
    fireEvent.click(screen.getByText("完成"));
    expect(mocks.close).toHaveBeenCalledTimes(1);
});
it("retains the code on rejection and allows a corrected retry", async () => {
    mocks.request
        .mockRejectedValueOnce(Error("Card expired"))
        .mockResolvedValueOnce({ data: true });
    open();
    input("expired");
    fireEvent.click(screen.getByText("兑换"));
    expect((await screen.findByRole("alert")).textContent).toBe("Card expired");
    expect(
        (screen.getByLabelText("礼品卡代码") as HTMLInputElement).value,
    ).toBe("expired");
    expect(mocks.redeemed).not.toHaveBeenCalled();
    input("valid");
    fireEvent.click(screen.getByText("兑换"));
    await waitFor(() => expect(mocks.redeemed).toHaveBeenCalledTimes(1));
});
it("requires a loaded recipient account", () => {
    open("");
    input("valid");
    fireEvent.submit(screen.getByLabelText("礼品卡代码").closest("form")!);
    expect(mocks.request).not.toHaveBeenCalled();
});
