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
import { AdminSubscriptionProtection } from "./AdminSubscriptionProtection";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it("saves per-account limits without enabling the optional whitelist", async () => {
    render(<AdminSubscriptionProtection />);
    fireEvent.change(screen.getByLabelText("每账号 24 小时窗口上限"), {
        target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存访问策略" }));
    await waitFor(() =>
        expect(request).toHaveBeenCalledWith("config/save", {
            subscription_user_day_limit: 100,
        }),
    );
});
