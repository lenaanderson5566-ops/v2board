import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const consoleOrigin = "https://console.example.test";
const gateway = "https://gateway.example.test/pay";
const orderNumber = "2026110900000000000000001";
const orderPath = `/api/v10/me/orders/${orderNumber}`;
const checkoutUrl = `${consoleOrigin}/app#/order/${orderNumber}`;
const build = new URL("../../public/console/", import.meta.url);

// Serve only the exact build under test. All APIs and the checkout destination
// are synthetic, so the browser cannot call a real site or payment provider.
async function consoleFixture(context, mode, api) {
    await context.addInitScript(({ origin, mode }) => {
        if (location.origin !== origin) return;
        window.FASTAI = { mode, title: "FastAI Test", adminPath: "test-admin", landing: false };
        localStorage.setItem("fastai.language", "zh-CN");
    }, { origin: consoleOrigin, mode });
    await context.route("**/*", async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.href === gateway) {
            return route.fulfill({
                contentType: "text/html; charset=utf-8",
                body: `<!doctype html><a href="${checkoutUrl}">返回商户</a>`,
            });
        }
        if (url.origin !== consoleOrigin) return route.abort("blockedbyclient");
        const path = url.pathname;
        if (path === "/app" || path === "/admin.html") {
            return route.fulfill({ path: fileURLToPath(new URL(path === "/app" ? "index.html" : "admin.html", build)) });
        }
        if (/^\/assets\/[\w.-]+$/.test(path)) {
            return route.fulfill({ path: fileURLToPath(new URL(path.slice(1), build)) });
        }
        const result = path === "/api/v10/auth/browser-session"
            ? { authenticated: true, accountId: 7, csrfToken: "synthetic-csrf" }
            : path === "/api/v10/me"
                ? { id: 7, email: "account@example.test", language: "zh-CN", planId: 1,
                    accountStatus: { state: "active", available: true }, currency: "CNY" }
                : await api(path, request);
        if (result === undefined) return route.fulfill({ status: 404, json: { message: "Fixture route unavailable" } });
        return route.fulfill({ json: { data: result } });
    });
}

test("mobile checkout opens a gateway, returns to the paid order and submits only once", async ({ page, context }) => {
    let paid = false;
    const payments = [];
    let releasePayment;
    const responseReady = new Promise(resolve => { releasePayment = resolve; });
    await consoleFixture(context, "user", async (path, request) => {
        if (path === orderPath) {
            return { orderNumber, planId: 1, billingPeriod: "monthly", kind: "new",
                status: paid ? "completed" : "unpaid", totalAmount: 5880, currency: "CNY",
                plan: { id: 1, name: "Test plan" } };
        }
        if (path === orderPath + "/status") return { status: paid ? "completed" : "unpaid" };
        if (path === "/api/v10/payment-methods") return [{ id: 11, name: "Test gateway", fixedFee: 0 }];
        if (path === orderPath + "/payments" && request.method() === "POST") {
            payments.push(request.postDataJSON());
            await responseReady;
            return { kind: "redirect", value: gateway };
        }
        if (path === "/api/v10/public/settings") return {};
        if (path === "/api/v10/announcements") return [];
        if (path === "/api/v10/me/notifications") return { items: [], ticketReplies: [], unread: 0 };
    });
    await page.goto(checkoutUrl);
    try {
        await page.getByRole("button", { name: "确认支付" }).dblclick();
        await expect(page.getByRole("button", { name: "提交中…" })).toBeDisabled();
        await expect.poll(() => payments.length).toBe(1);
        expect(payments[0]).toMatchObject({ paymentMethodId: 11, requestKey: expect.any(String) });
    } finally {
        releasePayment();
    }
    await page.getByRole("link", { name: "前往支付" }).click();
    await expect(page).toHaveURL(gateway);
    paid = true;
    await page.getByRole("link", { name: "返回商户" }).click();
    await expect(page).toHaveURL(checkoutUrl);
    await expect(page.getByRole("heading", { name: "订单已完成" })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认支付" })).toHaveCount(0);
    expect(payments).toHaveLength(1);
});

test("mobile admin navigation protects a settings draft and restores the tab on browser back", async ({ page, context }) => {
    const retention = "/api/v1/test-admin/system/logRetention";
    await consoleFixture(context, "admin", (path, request) => {
        if (path === "/api/v1/test-admin/config/fetch") return {};
        if (path === retention && request.method() === "GET") {
            return { settings: { login_log_retention_days: 30, connection_log_interval: 3600 }, lastRun: null };
        }
        if (path === "/api/v1/test-admin/analytics/settings") {
            return { ready: true, settings: { enabled: false, retentionDays: 30 } };
        }
    });
    const url = `${consoleOrigin}/admin.html#/log-settings`;
    await page.goto(url);
    const field = page.getByLabel("登录日志保留天数", { exact: false });
    await expect(field).toHaveValue("30");
    await page.getByRole("button", { name: "打开导航" }).click();
    const close = page.getByRole("button", { name: "关闭导航" });
    await expect(close).toBeFocused();
    await close.click();
    await field.fill("90");
    const statistics = page.getByRole("tab", { name: "访问统计" });
    const refusal = page.waitForEvent("dialog").then(dialog => dialog.dismiss());
    await Promise.all([refusal, statistics.click()]);
    await expect(page).toHaveURL(url);
    await expect(field).toHaveValue("90");

    const agreement = page.waitForEvent("dialog").then(dialog => dialog.accept());
    await Promise.all([agreement, statistics.click()]);
    await expect(page).toHaveURL(url + "?tab=analytics");
    await expect(statistics).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("开启访问统计")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(url);
    await expect(field).toHaveValue("30");
});
