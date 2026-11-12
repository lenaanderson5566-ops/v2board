import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const consoleOrigin = "https://console.example.test";
const gateway = "https://gateway.example.test/pay";
const orderNumber = "2026110900000000000000001";
const orderPath = `/api/v10/me/orders/${orderNumber}`;
const checkoutUrl = `${consoleOrigin}/app#/order/${orderNumber}`;
const build = new URL("../../public/console/", import.meta.url);
const narrowViewports = [{ width: 320, height: 740 }, { width: 390, height: 844 }];

// Serve only the exact build under test. All APIs and the checkout destination
// are synthetic, so the browser cannot call a real site or payment provider.
async function consoleFixture(context, mode, api, { authenticated = true, emailDomains = [] } = {}) {
    await context.addInitScript(({ origin, mode, emailDomains }) => {
        if (location.origin !== origin) return;
        window.FASTAI = {
            mode, title: "FastAI Test", adminPath: "test-admin", landing: false,
            emailWhitelistEnabled: emailDomains.length > 0, emailWhitelistSuffixes: emailDomains,
        };
        localStorage.setItem("fastai.language", "zh-CN");
    }, { origin: consoleOrigin, mode, emailDomains });
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
            ? { authenticated, accountId: authenticated ? 7 : null, csrfToken: "synthetic-csrf" }
            : path === "/api/v10/me"
                ? { id: 7, email: "account@example.test", language: "zh-CN", planId: 1, expiresAt: null,
                    accountStatus: { state: "active", available: true }, currency: "CNY" }
                : await api(path, request);
        if (result === undefined) return route.fulfill({ status: 404, json: { message: "Fixture route unavailable" } });
        return route.fulfill({ json: { data: result } });
    });
}

async function expectPageWidth(page, width) {
    const bounds = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
    }));
    expect(bounds.viewport).toBe(width);
    expect(bounds.content).toBeLessThanOrEqual(width);
}

test("mobile authentication keeps its type hierarchy and fits narrow screens", async ({ page, context }) => {
    await consoleFixture(context, "user", path => {
        if (path === "/api/v10/public/settings") return {};
    }, { authenticated: false, emailDomains: ["registration.example.test"] });
    const title = page.getByRole("heading", { name: "账户登录", exact: true });
    const intro = page.getByText("登录后可管理订阅与账户。", { exact: true });
    const email = page.locator('.user-auth-form input[type="email"]');
    const password = page.locator('.user-auth-form input[type="password"]');
    const domain = page.getByRole("combobox", { name: "邮箱后缀" });
    for (const viewport of narrowViewports) {
        await page.setViewportSize(viewport);
        await page.goto(`${consoleOrigin}/app#/login`);
        await expect(title).toBeVisible();
        await expect(title).toHaveCSS("font-size", "24px");
        await expect(intro).toHaveCSS("font-size", "14px");
        await expect(email).toHaveCSS("font-size", "16px");
        await expect(password).toHaveCSS("font-size", "16px");
        await expectPageWidth(page, viewport.width);

        await page.goto(`${consoleOrigin}/app#/register`);
        await expect(domain).toBeVisible();
        await expect(domain).toHaveCSS("font-size", "16px");
        await expectPageWidth(page, viewport.width);
    }
});

test.describe("desktop user frontend", () => {
    test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

    test("login retains desktop title size and two-column layout", async ({ page, context }) => {
        await consoleFixture(context, "user", path => {
            if (path === "/api/v10/public/settings") return {};
        }, { authenticated: false });
        await page.goto(`${consoleOrigin}/app#/login`);
        await expect(page.getByRole("heading", { name: "账户登录", exact: true })).toHaveCSS("font-size", "27px");
        await expect(page.locator(".user-auth-intro")).toBeVisible();
        const columns = await page.locator(".user-auth-layout").evaluate(layout =>
            getComputedStyle(layout).gridTemplateColumns.split(" ").length);
        expect(columns).toBe(2);
        await expectPageWidth(page, 1280);
    });
});

test("mobile coupon wallet keeps offers compact and preserves coupon details", async ({ page, context }) => {
    const longName = "LongUnbrokenCouponNameForNarrowMobileWalletCards";
    const offer = { discountPercent: 25, expiresAt: "2099-06-01T00:00:00Z", planIds: [1], billingPeriods: ["annual"] };
    await consoleFixture(context, "user", path => {
        if (path === "/api/v10/me/coupons") return [
            { ...offer, id: 11, name: "续费优惠", status: "available" },
            { ...offer, id: 12, name: longName, status: "available" },
            { ...offer, id: 13, name: "已占用测试券", status: "reservedOrUsed" },
            { ...offer, id: 14, name: "已过期测试券", status: "expired", expiresAt: "2020-01-01T00:00:00Z" },
        ];
        if (path === "/api/v10/me/coupon-offers" || path === "/api/v10/announcements") return [];
        if (path === "/api/v10/public/settings") return {};
        if (path === "/api/v10/me/notifications") return { items: [], ticketReplies: [], unread: 0 };
    });
    await page.goto(`${consoleOrigin}/app#/coupons`);

    const wallet = page.locator(".coupon-wallet-page");
    const cards = wallet.getByRole("article");
    const shortCard = cards.filter({ has: page.getByRole("heading", { name: "续费优惠", exact: true }) });
    const longTitle = wallet.getByRole("heading", { name: longName, exact: true });
    const purchase = shortCard.getByRole("link", { name: "选择套餐使用" });
    await expect(cards).toHaveCount(2);
    await expect(shortCard.getByText("25%", { exact: true })).toBeVisible();
    await expect(shortCard.getByText("仅限指定套餐 · 年付", { exact: true })).toBeVisible();
    await expect(shortCard.getByText(/有效期至.*2099/)).toBeVisible();
    await expect(shortCard.getByText("可使用", { exact: true })).toBeVisible();
    await expect(purchase).toHaveAttribute("href", "#/plan?couponId=11");

    const heights = [];
    for (const viewport of narrowViewports) {
        await page.setViewportSize(viewport);
        await expect(longTitle).toBeVisible();
        expect(await longTitle.evaluate(title => title.scrollWidth <= title.clientWidth)).toBe(true);
        expect(await cards.evaluateAll(items => items.every(card => card.scrollWidth <= card.clientWidth))).toBe(true);
        expect((await purchase.boundingBox()).height).toBeGreaterThanOrEqual(44);
        await expectPageWidth(page, viewport.width);
        heights.push((await shortCard.boundingBox()).height);
    }

    await wallet.getByRole("button", { name: /^已占用或使用/ }).click();
    await expect(cards).toHaveCount(1);
    await expect(wallet.getByRole("heading", { name: "已占用测试券", exact: true })).toBeVisible();
    await expect(wallet.getByRole("link", { name: "选择套餐使用" })).toHaveCount(0);
    await wallet.getByRole("button", { name: /^已过期/ }).click();
    await expect(cards).toHaveCount(1);
    await expect(wallet.getByRole("heading", { name: "已过期测试券", exact: true })).toBeVisible();
    await expect(wallet.getByRole("link", { name: "选择套餐使用" })).toHaveCount(0);
    await wallet.getByRole("button", { name: /^可使用/ }).click();
    await purchase.click();
    await expect(page).toHaveURL(`${consoleOrigin}/app#/plan?couponId=11`);
    expect(Math.max(...heights)).toBeLessThanOrEqual(175);
});

test("mobile plan checkout only reserves room for visible quote details", async ({ page, context }) => {
    let releaseAnnual;
    const annualReady = new Promise(resolve => { releaseAnnual = resolve; });
    await consoleFixture(context, "user", async (path, request) => {
        if (path === "/api/v10/plans/1") {
            return { id: 1, name: "Ultimate", currency: "CNY", semiannualPrice: 33516, annualPrice: 58800, renewable: true };
        }
        if (path === "/api/v10/me/orders" || path === "/api/v10/announcements") return [];
        if (path === "/api/v10/public/settings" || path === "/api/v10/me/subscription") return {};
        if (path === "/api/v10/me/coupons" || path === "/api/v10/me/coupon-offers") return { items: [] };
        if (path === "/api/v10/me/notifications") return { items: [], ticketReplies: [], unread: 0 };
        if (path === "/api/v10/me/checkout-quotes" && request.method() === "POST") {
            const annual = request.postDataJSON().billingPeriod === "annual";
            if (annual) await annualReady;
            const amount = annual ? 58800 : 33516;
            const fee = annual ? 100 : 0;
            return {
                planAmount: amount,
                amountDue: amount,
                handlingAmount: fee,
                paymentAmount: amount + fee,
                paymentMethodId: 11,
                currency: "CNY",
                paymentCurrency: "CNY",
                quoteToken: "synthetic-quote",
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                methods: [{ id: 11, name: "Alipay", category: "wallet", fixedFee: fee }],
            };
        }
    });
    await page.goto(`${consoleOrigin}/app#/plan/1?period=half_year_price`);
    const breakdown = page.getByRole("region", { name: "价格明细" });
    const lines = breakdown.locator(".checkout-lines");
    const rows = lines.locator(":scope > div");
    const status = page.locator(".checkout-method-section [role=status]");
    const confirm = page.getByRole("button", { name: "确认并支付" });
    const fee = breakdown.locator(".purchase-fee-note");
    const summary = fee.getByText("费用说明", { exact: true });
    await expect(page.getByRole("radio", { name: /Alipay/ })).toBeChecked();
    await expect(confirm).toBeEnabled();
    await expect(rows).toHaveCount(1);
    expect((await lines.boundingBox()).height).toBeLessThanOrEqual(60);
    expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await summary.click();
    await expect(fee).toHaveJSProperty("open", true);
    await expect(fee.getByText(/套餐价格已包含周期优惠/)).toBeVisible();
    await summary.click();
    await expect(fee).toHaveJSProperty("open", false);
    expect(await status.evaluate(element => element.getBoundingClientRect().height)).toBe(0);
    const idleStatus = await status.elementHandle();

    try {
        await page.locator('input[name="period"][value="year_price"]').check();
        await expect(status).toHaveText("正在核算金额…");
        await expect(status).toBeVisible();
        expect(await status.evaluate((element, idle) => element === idle, idleStatus)).toBe(true);
        await expect(breakdown.getByText("上次报价")).toBeVisible();
        await expect(confirm).toBeDisabled();
    } finally {
        releaseAnnual();
    }
    await expect(confirm).toBeEnabled();
    await expect(rows).toHaveCount(2);
    await page.locator('input[name="period"][value="half_year_price"]').check();
    await expect(confirm).toBeEnabled();
    await expect(rows).toHaveCount(1);
    expect((await lines.boundingBox()).height).toBeLessThanOrEqual(60);
    expect(await status.evaluate(element => element.getBoundingClientRect().height)).toBe(0);
    await expectPageWidth(page, 390);
});

test("mobile checkout opens a gateway, returns to the paid order and submits only once", async ({ page, context }) => {
    const planName = "FastAIMonthlyPlanWithALongUnbrokenNameForNarrowCheckout";
    let paid = false;
    const payments = [];
    let releasePayment;
    const responseReady = new Promise(resolve => { releasePayment = resolve; });
    await consoleFixture(context, "user", async (path, request) => {
        if (path === orderPath) {
            return { orderNumber, planId: 1, billingPeriod: "monthly", kind: "new",
                status: paid ? "completed" : "unpaid", totalAmount: 5880, currency: "CNY",
                plan: { id: 1, name: planName } };
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
    const back = page.locator(".checkout-page > .receipt-back");
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", "#/order");
    expect((await back.boundingBox()).height).toBeGreaterThanOrEqual(44);
    const plan = page.getByRole("heading", { name: planName, exact: true });
    await expect(plan).toBeVisible();
    for (const viewport of narrowViewports) {
        await page.setViewportSize(viewport);
        await expect(page.locator(".checkout-heading h1")).toHaveCSS("font-size", "24px");
        await expect(page.locator(".checkout-heading p")).toHaveCSS("font-size", "14px");
        expect(await plan.evaluate(heading => heading.scrollWidth <= heading.clientWidth)).toBe(true);
        await expectPageWidth(page, viewport.width);
    }
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

test("mobile registration settings save a pause and keep account security in its own tab", async ({ page, context }) => {
    const changes = [];
    const config = { site: { stop_register: 0 }, invite: { invite_force: 1, invite_gen_limit: 5 }, safe: { secure_path: "test-admin" } };
    await consoleFixture(context, "admin", (path, request) => {
        if (path === "/api/v1/test-admin/config/fetch") return config;
        if (path === "/api/v1/test-admin/console/configSchema") return {};
        if (path === "/api/v1/test-admin/plan/fetch") return [];
        if (path === "/api/v1/test-admin/config/save" && request.method() === "POST") {
            const body = request.postDataJSON();
            changes.push(body);
            Object.assign(config.site, body);
            return true;
        }
    });
    await page.goto(`${consoleOrigin}/admin.html#/registration-settings`);
    const pageGroup = page.locator(".admin-page-group");
    await expect(pageGroup).toHaveText("系统设置");
    const modes = page.getByRole("group", { name: "注册方式" });
    await expect(modes.getByRole("button", { name: "仅限邮件邀请" })).toHaveAttribute("aria-pressed", "true");
    const pause = modes.getByRole("button", { name: "暂停注册" });
    await pause.click();
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    const bounds = await pause.boundingBox();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect.poll(() => changes).toEqual([{ stop_register: 1 }]);
    await expect(page.getByText("设置已保存")).toBeVisible();

    await page.getByRole("tab", { name: "账户安全" }).click();
    await expect(page).toHaveURL(`${consoleOrigin}/admin.html#/account-settings`);
    await expect(pageGroup).toHaveText("系统设置 / 账户与注册");
    await expect(page.getByLabel("后台入口路径")).toHaveValue("test-admin");
    await expect(modes).toHaveCount(0);
});
