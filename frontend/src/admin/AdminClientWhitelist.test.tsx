// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const request = vi.fn().mockResolvedValue({ data: true });
vi.mock("../shared/api", () => ({
    admin: (s: string) => s,
    request: (...args: unknown[]) => request(...args),
}));
vi.mock("../shared/ui", () => ({
    useData: () => ({ data: { app: {} }, reload: vi.fn() }),
    State: ({ children }: any) => <>{children}</>,
}));
import { AdminClientWhitelist } from "./AdminClientWhitelist";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it("requires an allowed client before enabling and saves the selection", async () => {
    render(<AdminClientWhitelist />);
    fireEvent.click(screen.getByLabelText("开启 UA 白名单"));
    expect(
        (
            screen.getByRole("button", {
                name: "保存白名单",
            }) as HTMLButtonElement
        ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("FlClash"));
    fireEvent.click(screen.getByRole("button", { name: "保存白名单" }));
    await waitFor(() =>
        expect(request).toHaveBeenCalledWith("config/save", {
            subscription_ua_whitelist_enabled: 1,
            subscription_ua_whitelist: ["flclash"],
        }),
    );
});
