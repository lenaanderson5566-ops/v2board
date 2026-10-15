// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ reload: vi.fn() }));
vi.mock("../shared/api", () => ({
    boot: { mode: "admin" },
    admin: (p: string) => p,
    date: () => "date",
}));
vi.mock("../shared/ui", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../shared/ui")>()),
    useData: (path: string) => ({
        loading: false,
        error: "",
        reload: mocks.reload,
        data: path.includes("id=")
            ? {
                  campaign: {
                      subject: "Maintenance",
                      purpose: "service",
                      content: "<p>Saved content</p>",
                      translations: {},
                      administrator_id: 1,
                  },
                  stats: {
                      total: 10,
                      accepted: 8,
                      delivered: 4,
                      feedback_count: 4,
                      delivery_rate: 50,
                      skipped_reasons: [{ reason: "suppressed", n: 2 }],
                  },
              }
            : [
                  {
                      id: 1,
                      subject: "Maintenance",
                      purpose: "service",
                      stats: { total: 10, accepted: 8, queued: 0, skipped: 2 },
                  },
              ],
    }),
    Modal: ({ children }: any) => <div role="dialog">{children}</div>,
    Html: ({ value }: any) => <div>{value}</div>,
    State: () => null,
}));
import { AdminMailCampaigns } from "./AdminMailCampaigns";
afterEach(cleanup);
it("shows the archived content and describes delivery as server confirmation", () => {
    render(<AdminMailCampaigns />);
    fireEvent.click(screen.getByRole("button", { name: "Maintenance" }));
    expect(screen.getByText("<p>Saved content</p>")).toBeTruthy();
    expect(screen.getByText(/确认送达比例：50%/)).toBeTruthy();
    expect(screen.getByText(/退信或投诉停发：2/)).toBeTruthy();
    expect(screen.getByText(/不代表打开率/)).toBeTruthy();
});
