// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("./payment-icons", () => ({ paymentIcons: [], paymentIconInitial: () => ({}), resolvePaymentIcon: () => "" }));
vi.mock("./PaymentCategoryEditor", () => ({ PaymentCategoryEditor: () => null, paymentCategoryInitial: () => ({ category: "regular" }) }));
const api = vi.hoisted(() => {
    window.FASTAI = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (importOriginal) => ({
    ...await importOriginal<typeof import("../shared/api")>(),
    request: api.request,
    readRequest: api.request,
}));
import { Payments } from "./admin";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("opens the selected channel's failure records and links to the affected order", async () => {
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("/fetch")) return { data: [{ id: 7, name: "WeChat", payment: "EPayQrcode", enable: 1, recent_failure_count: 1 }] };
        if (path.endsWith("/getPaymentMethods")) return { data: ["EPayQrcode"] };
        if (path.endsWith("/payment/7/recentFailures")) return { data: { available: true, events: [
            { id: 2, reason: "gateway_timeout", stage: "gateway", trade_no: "fixture-order", created_at: 1791849600, has_raw_diagnostic: true },
        ] } };
        if (path.endsWith("/payment/diagnostics/attempt/2")) return { data: { sections: [{ title: "网关响应", text: '{"msg":"原始网关错误"}' }] } };
        throw new Error(`Unexpected endpoint: ${path}`);
    });

    render(<Payments />);
    fireEvent.click(await screen.findByRole("button", { name: "查看 WeChat 的支付诊断" }));
    expect((await screen.findByRole("link", { name: "fixture-order" })).getAttribute("href")).toBe("#/orders?trade_no=fixture-order");
    expect(api.request.mock.calls.some(([path]) => path.includes("payment/diagnostics/"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "查看原始诊断" }));
    expect(await screen.findByText('{"msg":"原始网关错误"}')).toBeTruthy();
});

it("opens original unassociated callback diagnostics for a channel with no failed attempts", async () => {
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("/fetch")) return { data: [{ id: 7, name: "WeChat", payment: "EPayQrcode", enable: 1, recent_failure_count: 0 }] };
        if (path.endsWith("/getPaymentMethods")) return { data: ["EPayQrcode"] };
        if (path.endsWith("/payment/7/recentFailures")) return { data: { available: true, events: [], callbackEvents: [
            { id: 3, reason: "verify error", stage: "verification", result: "failed", created_at: 1791849600, has_raw_diagnostic: true },
        ] } };
        if (path.endsWith("/payment/diagnostics/callback/3")) return { data: { sections: [{ title: "回调请求", text: "sign=fixture" }] } };
        throw new Error(`Unexpected endpoint: ${path}`);
    });

    render(<Payments />);
    fireEvent.click(await screen.findByRole("button", { name: "查看 WeChat 的支付诊断" }));
    expect(await screen.findByText("最近一小时没有记录到发起支付失败。")).toBeTruthy();
    expect(screen.getByText("验签或通知内容校验失败")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看原始诊断" }));
    expect(await screen.findByText("sign=fixture")).toBeTruthy();
});

it("enables and disables PaytaroQR using the existing backend show endpoint", async () => {
    let enabled = 0;
    api.request.mockImplementation(async (path: string, body: any) => {
        if (path === "test-admin/payment/fetch") return { data: [{ id: 7, name: "PaytaroQR", payment: "PaytaroQR", enable: enabled }] };
        if (path === "test-admin/payment/getPaymentMethods") return { data: ["PaytaroQR"] };
        if (path === "test-admin/payment/show") {
            expect(body).toEqual({ id: 7 });
            enabled = enabled ? 0 : 1;
            return { data: true };
        }
        throw new Error(`Unexpected endpoint: ${path}`);
    });
    render(<Payments />);
    fireEvent.click(await screen.findByRole("switch", { name: "PaytaroQR 启用" }));
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false"));
    expect(api.request.mock.calls.filter(([path]) => path.endsWith("/show"))).toHaveLength(2);
});

it("keeps the disabled state and displays activation errors", async () => {
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("/fetch")) return { data: [{ id: 7, name: "PaytaroQR", payment: "PaytaroQR", enable: 0 }] };
        if (path.endsWith("/getPaymentMethods")) return { data: ["PaytaroQR"] };
        throw new Error("保存失败");
    });
    render(<Payments />);
    fireEvent.click(await screen.findByRole("switch", { name: "PaytaroQR 启用" }));
    expect((await screen.findByRole("alert")).textContent).toBe("保存失败");
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
});

it("has one enable control and prevents duplicate deletion while showing errors inline", async () => {
    let reject!: (reason: Error) => void;
    api.request.mockImplementation((path: string) => path.endsWith("/drop") ? new Promise((_, fail) => {reject = fail;}) : Promise.resolve({data:path.endsWith("getPaymentMethods") ? ["Stripe"] : [{id:1,name:"Card",payment:"Stripe",enable:1}]}));
    const confirm = vi.spyOn(window,"confirm").mockReturnValue(true);
    try {
        render(<Payments/>);
        const button = await screen.findByRole("button",{name:"删除"});
        expect(screen.queryByRole("button",{name:"切换启用"})).toBeNull();
        fireEvent.click(button);fireEvent.click(button);
        expect(api.request.mock.calls.filter(([p]) => p.endsWith("/drop"))).toHaveLength(1);
        reject(new Error("操作失败"));
        await screen.findByRole("alert");
        expect((button as HTMLButtonElement).disabled).toBe(false);
    } finally {confirm.mockRestore();}
});

it("keeps existing channels visible when payment interface discovery fails and retries only that read", async () => {
    let available = false;
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("payment/fetch")) return { data: [{ id: 8, name: "Existing wallet", payment: "EPay", enable: 1 }] };
        if (path.endsWith("getPaymentMethods")) {
            if (!available) throw new Error("接口目录不可用");
            return { data: ["EPay"] };
        }
        return { data: true };
    });
    render(<Payments />);
    expect(await screen.findByText("Existing wallet")).toBeTruthy();
    expect(screen.getByText("支付接口列表暂不可用，重试后可添加或编辑渠道。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "添加支付方式" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "编辑" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("switch", { name: "Existing wallet 启用" })).toBeTruthy();
    const listReads = api.request.mock.calls.filter(([path]) => path.endsWith("payment/fetch")).length;
    available = true;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "编辑" }) as HTMLButtonElement).disabled).toBe(false));
    expect(api.request.mock.calls.filter(([path]) => path.endsWith("payment/fetch"))).toHaveLength(listReads);
    expect(api.request.mock.calls.some(([path]) => /\/(show|drop|save)$/.test(path))).toBe(false);
});

it("retains channels during a failed refresh, disables stale writes and recovers with a read", async () => {
    let fail = false;
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("getPaymentMethods")) return { data: ["Stripe"] };
        if (path.endsWith("payment/fetch")) {
            if (fail) throw new Error("渠道刷新失败");
            return { data: [{ id: 8, name: "Existing card", payment: "Stripe", enable: 1 }] };
        }
        return { data: true };
    });
    render(<Payments />);
    await screen.findByText("Existing card");
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByText("渠道刷新失败");
    expect(screen.getByText("Existing card")).toBeTruthy();
    for (const name of ["编辑", "删除", "添加支付方式"])
        expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "编辑" }) as HTMLButtonElement).disabled).toBe(false));
    expect(api.request.mock.calls.some(([path]) => /\/(show|drop|save)$/.test(path))).toBe(false);
});
