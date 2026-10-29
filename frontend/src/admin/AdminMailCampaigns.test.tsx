// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ reload: vi.fn(), listError: "", detailError: "", listMissing: false, detailMissing: false, listLoading: false, detailLoading: false, retryAt: 0 }));
vi.mock("../shared/api", () => ({
    boot: { mode: "admin" },
    admin: (p: string) => p,
    date: () => "date",
}));
vi.mock("../shared/ui", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../shared/ui")>()),
    useData: (path: string) => ({
        loading: path.includes("id=") ? mocks.detailLoading : mocks.listLoading,
        error: path.includes("id=") ? mocks.detailError : mocks.listError,
        reload: mocks.reload,
        retryAt: mocks.retryAt,
        data: (path.includes("id=") ? mocks.detailMissing : mocks.listMissing) ? null : path.includes("id=")
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
}));
import { AdminMailCampaigns } from "./AdminMailCampaigns";
import i18n from "../shared/i18n";
afterEach(cleanup);
beforeEach(async () => { await i18n.changeLanguage("zh-CN");mocks.reload.mockClear(); mocks.listError="";mocks.detailError="";mocks.listMissing=false;mocks.detailMissing=false;mocks.listLoading=false;mocks.detailLoading=false;mocks.retryAt=0; });
it("shows the archived content and describes delivery as server confirmation", () => {
    render(<AdminMailCampaigns />);
    fireEvent.click(screen.getByRole("button", { name: "Maintenance" }));
    expect(screen.getByText("<p>Saved content</p>")).toBeTruthy();
    expect(screen.getByText(/确认送达比例：50%/)).toBeTruthy();
    expect(screen.getByText(/退信或投诉停发：2/)).toBeTruthy();
    expect(screen.getByText(/不代表打开率/)).toBeTruthy();
});
it.each(["list", "detail"])("offers a local retry when the campaign %s cannot be loaded", kind => {
    if(kind === "list"){mocks.listError="读取记录失败";mocks.listMissing=true;}
    else {mocks.detailError="读取详情失败";mocks.detailMissing=true;}
    render(<AdminMailCampaigns />);
    if(kind === "detail")fireEvent.click(screen.getByRole("button", {name:"Maintenance"}));
    expect(screen.getByText(kind === "list" ? "读取记录失败" : "读取详情失败")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name:"重试"}));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
});
it("retains archived content during refresh and disables duplicate status updates and rate-limit bypasses", () => {
    const view=render(<AdminMailCampaigns />);
    fireEvent.click(screen.getByRole("button", {name:"Maintenance"}));
    mocks.detailLoading=true;
    view.rerender(<AdminMailCampaigns />);
    expect(screen.getByText("<p>Saved content</p>")).toBeTruthy();
    const update=screen.getByRole("button",{name:"更新投递状态"}) as HTMLButtonElement;
    expect(update.disabled).toBe(true);
    mocks.detailLoading=false;mocks.detailError="临时详情失败";mocks.retryAt=Date.now()+60000;
    view.rerender(<AdminMailCampaigns />);
    expect(screen.getByText("<p>Saved content</p>")).toBeTruthy();
    expect(update.disabled).toBe(true);
});
