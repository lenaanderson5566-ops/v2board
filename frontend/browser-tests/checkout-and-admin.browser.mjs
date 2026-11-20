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
async function consoleFixture(context, mode, api, { authenticated = true, emailDomains = [], title = "FastAI Test", language = "zh-CN", account = {}, bootOptions = {} } = {}) {
    await context.addInitScript(({ origin, mode, emailDomains, title, language, bootOptions }) => {
        if (location.origin !== origin) return;
        window.FASTAI = {
            mode, title, adminPath: "test-admin", landing: false,
            emailWhitelistEnabled: emailDomains.length > 0, emailWhitelistSuffixes: emailDomains,
            ...bootOptions,
        };
        localStorage.setItem("fastai.language", language);
    }, { origin: consoleOrigin, mode, emailDomains, title, language, bootOptions });
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
        if (path === "/" || path === "/app" || path === "/admin.html") {
            return route.fulfill({ path: fileURLToPath(new URL(path === "/admin.html" ? "admin.html" : "index.html", build)) });
        }
        if (/^\/assets\/[\w.-]+$/.test(path)) {
            return route.fulfill({ path: fileURLToPath(new URL(path.slice(1), build)) });
        }
        const result = path === "/api/v10/auth/browser-session"
            ? { authenticated, accountId: authenticated ? 7 : null, csrfToken: "synthetic-csrf" }
            : path === "/api/v10/me"
                ? { id: 7, email: "account@example.test", language, planId: 1, expiresAt: null,
                    accountStatus: { state: "active", available: true }, currency: "CNY", ...account }
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
        await expect(title).toHaveCSS("font-size", "20px");
        await expect(intro).toHaveCSS("font-size", "14px");
        await expect(email).toHaveCSS("font-size", "16px");
        await expect(password).toHaveCSS("font-size", "16px");
        await expectPageWidth(page, viewport.width);

        await page.goto(`${consoleOrigin}/app#/register`);
        await expect(domain).toBeVisible();
        await expect(domain).toHaveCSS("font-size", "16px");
        await expectPageWidth(page, viewport.width);

        await page.goto(`${consoleOrigin}/app#/forget`);
        await expect(page.locator(".auth-title-row h2")).toHaveCSS("font-size", "20px");
        await expect(email).toBeVisible();
        await expectPageWidth(page, viewport.width);
    }
});

for (const style of ["original", "minimal"]) {
    test(`public ${style} landing keeps its content inside phone viewports`, async ({ page, context }) => {
        await consoleFixture(context, "user", () => undefined, { authenticated: false, bootOptions: { landing: true, landingStyle: style } });
        await page.goto(consoleOrigin);
        const title = page.locator(style === "original" ? ".landing-hero h1" : ".minimal-landing-copy h1");
        await expect(title).toBeVisible();
        for (const viewport of narrowViewports) {
            await page.setViewportSize(viewport);
            await expect(title).toHaveCSS("font-size", "26px");
            await expectPageWidth(page, viewport.width);
        }
    });
}

test("member pages and detail dialogs fit both phone widths with loaded data", async ({ context, page }) => {
    test.setTimeout(90000);
    const plan = { id: 1, name: "测试周期套餐", description: "<table><thead><tr><th>套餐权益</th></tr></thead><tbody><tr><td>共享额度</td></tr></tbody></table>", currency: "CNY", monthlyPrice: 1800, renewable: true, quotaBytes: 10737418240 };
    const ticket = { id: 9, subject: "测试工单主题", priority: "normal", status: "closed" };
    const article = { id: 8, title: "测试帮助文章", category: "设备设置", body: "## 设备说明\n\n测试文章正文\n\n| 系统 | 版本 |\n| --- | --- |\n| Android | 版本较长的客户端 |" };
    const notice = { id: 3, title: "测试公告", content: article.body, read: true, version: 1 };
    const offer = { id: 11, name: "测试折扣券", discountPercent: 20, expiresAt: "2099-01-01T00:00:00Z", planIds: [1], billingPeriods: ["monthly"] };
    const authorizationId = "1".repeat(64);
    const data = {
        "/plans": [plan],
        "/me/subscription": { planId: 1, plan, active: true, expiresAt: "2099-01-01T00:00:00Z", subscriptionUrl: consoleOrigin + "/test-subscription" },
        "/me/orders": [{ orderNumber, planId: 1, plan, billingPeriod: "monthly", status: "completed", totalAmount: 1800, currency: "CNY" }],
        "/me/usage-resets": { available: 1, credits: [], history: [] },
        "/me/traffic-records": [{ recordedAt: new Date().toISOString(), uploadedBytes: 1024, downloadedBytes: 2048, rate: 1, recordTimezone: "UTC" }],
        "/me/coupon-offers": [{ ...offer, activityTitle: "测试优惠活动", activityDescription: "测试活动说明" }],
        "/me/coupons": [{ ...offer, status: "available" }],
        "/me/referrals": { availableCommission: 12345, currency: "CNY" },
        "/me/commissions": [],
        "/me/invitations": [],
        "/me/tickets": [ticket],
        "/me/tickets/9": { ...ticket, messages: [{ id: 1, mine: true, message: "测试对话内容" }] },
        "/knowledge-articles": { "设备设置": [article] },
        "/knowledge-articles/8": article,
        "/me/notifications": { items: [notice], ticketReplies: [], unread: 0 },
        "/announcements/3": notice,
        "/me/notifications/read-receipts": true,
        "/me/preferences/options": { currency: "CNY", timeZones: ["Asia/Shanghai"], systemTimeZone: "Asia/Shanghai" },
        "/me/sessions": {},
        "/me/security/mfa": { enrollmentEnabled: true, emailEnabled: false, totpEnabled: false },
        "/me/security/passkeys": { enabled: false, credentials: [] },
        "/me/account-deletion": { enabled: true, blockers: [] },
        "/me/subscription/access-records": [{ id: 2, status: "success", clientName: "Layout Test Client", requestedAt: "2026-11-17T12:00:00Z" }],
        [`/me/client-authorizations/${authorizationId}`]: { platform: "android", expiresAt: "2099-01-01T00:00:00Z" },
        "/me/nodes": [],
        "/credit-packages": [],
        "/announcements": [],
        "/public/banners": [],
        "/public/settings": {},
    };
    await consoleFixture(context, "user", path => data[path.replace(/^\/api\/v10/, "")],
        { account: { balance: 12345, quotaBytes: plan.quotaBytes, ticketCreation: "allowed" } });
    const pages = [
        ["dashboard", ".usage-current-plan .subscription-name"],
        ["overview", ".usage-current-plan .subscription-name"],
        ["traffic", ".usage-page .usage-quota"],
        ["plan", ".plan-card.mobile-active h2"],
        ["order", ".billing-page .transaction-row"],
        ["activities", ".activity-offer h3"],
        ["invite", ".invite-wallet-balance > strong"],
        ["profile", ".profile-email .preference-readonly"],
        ["security", ".security-password-card input"],
        ["security/configuration-updates", ".configuration-record-client"],
        ["notifications", ".notification-options [role=switch]"],
        ["knowledge", ".knowledge-articles .article-link"],
        ["ticket", ".user-ticket-list tbody tr"],
        ["ticket?ticketId=9", "[role=dialog] .message"],
        [`client-authorize?authorizationId=${authorizationId}`, ".client-authorization .primary:enabled"],
    ];
    for (const [route, selector] of pages) {
        await test.step(route, async () => {
            await page.goto(`${consoleOrigin}/app#/${route}`);
            const content = page.locator(selector).first();
            await expect(content).toBeVisible();
            for (const viewport of narrowViewports) {
                await page.setViewportSize(viewport);
                await expectPageWidth(page, viewport.width);
                const box = await content.boundingBox();
                expect(box.x).toBeGreaterThanOrEqual(-1);
                expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
                if (route === "traffic") await expect(content).toHaveCSS("min-height", "0px");
                if (route === "plan") await expect(page.getByRole("columnheader", { name: "套餐权益" })).toBeVisible();
                if (route === "order") await expect(page.locator(".balance-card .balance-amount")).toHaveCSS("font-size", "18px");
                if (route === "security") await expect(content).toHaveCSS("font-size", "16px");
                if (route.startsWith("client-authorize")) expect(box.height).toBeGreaterThanOrEqual(44);
            }
            if (route === "order") {
                await page.evaluate(() => document.documentElement.style.fontSize = "125%");
                await expect(page.locator(".balance-card .balance-amount")).toHaveCSS("font-size", "22.5px");
                await expectPageWidth(page, 390);
                await page.evaluate(() => document.documentElement.style.removeProperty("font-size"));
            }
        });
    }
    await page.goto(`${consoleOrigin}/app#/knowledge`);
    await page.getByRole("button", { name: article.title }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("测试文章正文", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "设备说明" })).toBeVisible();
    for (const viewport of narrowViewports) {
        await page.setViewportSize(viewport);
        await expect(dialog.getByRole("columnheader", { name: "版本" })).toBeVisible();
        await expect(dialog.getByRole("columnheader", { name: "版本" })).toHaveCSS("font-size", "13px");
        await expect(dialog.getByRole("cell", { name: "Android" })).toHaveCSS("font-size", "14px");
        await expectPageWidth(page, viewport.width);
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.keyboard.press("Escape");
    await page.locator(".announcement-trigger").click();
    await dialog.getByRole("button", { name: new RegExp(notice.title) }).click();
    await expect(dialog.getByText("测试文章正文", { exact: true })).toBeVisible();
    for (const viewport of narrowViewports) {
        await page.setViewportSize(viewport);
        await expect(dialog.getByRole("columnheader", { name: "系统" })).toBeVisible();
        await expectPageWidth(page, viewport.width);
    }
    await page.keyboard.press("Escape");
    await page.goto(`${consoleOrigin}/app#/traffic`);
    await page.locator(".usage-page .settings-tabs button").nth(1).click();
    await expect(page.locator(".usage-bars button").first()).toBeVisible();
    await page.locator(".usage-records summary").click();
    await expect(page.locator(".usage-records tbody").getByText(/UTC/)).toBeVisible();
    for (const viewport of narrowViewports) {
        await page.setViewportSize(viewport);
        await expectPageWidth(page, viewport.width);
    }
    await page.goto(`${consoleOrigin}/app#/ticket/order/${orderNumber}`);
    await page.getByRole("button", { name: "创建工单" }).click();
    await expect(dialog.getByText(orderNumber, { exact: true })).toBeVisible();
    for (const viewport of narrowViewports) {
        await page.setViewportSize(viewport);
        await expect(dialog.getByRole("combobox").first()).toHaveCSS("font-size", "16px");
        await expectPageWidth(page, viewport.width);
    }
});

for (const state of ["new", "expired", "banned"]) {
    test(`account entry displays the ${state} state at phone widths`, async ({ context, page }) => {
        await consoleFixture(context, "user", path => {
            if (path === "/api/v10/me/orders") return [];
            if (path === "/api/v10/me/subscription") return { plan: state === "new" ? null : { id: 1, name: "上期套餐" } };
            if (path === "/api/v10/me/notifications") return { items: [], ticketReplies: [] };
        }, { account: { planId: state === "new" ? null : 1, accountStatus: { state, available: false } } });
        await page.goto(`${consoleOrigin}/app#/dashboard`);
        const entry = page.locator(`.account-entry-${state}`);
        await expect(entry.locator("h2")).toBeVisible();
        if (state === "expired") await expect(entry.locator(".entry-previous")).toContainText("上期套餐");
        for (const viewport of narrowViewports) {
            await page.setViewportSize(viewport);
            await expectPageWidth(page, viewport.width);
        }
    });
}

test("session recovery displays a retry action at phone widths", async ({ context, page }) => {
    await consoleFixture(context, "user", () => undefined);
    await context.route("**/api/v10/me", route => route.fulfill({ status: 503, json: { message: "Temporary failure" } }));
    await page.goto(`${consoleOrigin}/app#/dashboard`);
    await expect(page.locator(".session-recovery button")).toBeVisible();
    for (const viewport of narrowViewports) {
        await page.setViewportSize(viewport);
        await expect(page.locator("#session-recovery-title")).toHaveCSS("font-size", "20px");
        await expectPageWidth(page, viewport.width);
    }
});

test.describe("embedded browser", () => {
    test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.42" });
    test("entry guidance and manual address fit both phone widths", async ({ page, context }) => {
        await consoleFixture(context, "user", () => undefined, { authenticated: false });
        await page.goto(`${consoleOrigin}/app#/login`);
        const guide = page.locator(".browser-notice-entry");
        await expect(guide.locator(".browser-notice-heading")).toBeVisible();
        await guide.locator(".browser-manual").click();
        for (const viewport of narrowViewports) {
            await page.setViewportSize(viewport);
            await expectPageWidth(page, viewport.width);
            await expect(guide.getByRole("textbox")).toHaveValue(/\/app#\/login$/);
        }
    });
});

for (const [language, nodesLabel, manageLabel] of [
    ["zh-CN", "可用节点", "管理订阅"],
    ["en-US", "Available servers", "Manage subscription"],
]) {
    test(`quick start keeps phone actions legible in ${language}`, async ({ page, context }) => {
        await consoleFixture(context, "user", path => {
            if (path === "/api/v10/me/subscription") return { subscriptionUrl: consoleOrigin + "/test-subscription" };
            if (path === "/api/v10/me/nodes" || path === "/api/v10/announcements") return [];
            if (path === "/api/v10/public/settings") return {};
            if (path === "/api/v10/me/notifications") return { items: [], ticketReplies: [], unread: 0 };
        }, { language });
        await page.goto(`${consoleOrigin}/app#/subscribe`);
        const quickStart = page.locator(".configuration-quick-start");
        const nodeButton = quickStart.getByRole("button", { name: nodesLabel, exact: true });
        const manageButton = quickStart.getByRole("link", { name: manageLabel, exact: true });
        const systems = quickStart.locator(".device-options").getByRole("button");
        const ios = systems.filter({ hasText: /^iOS$/ });
        const systemRows = () => systems.evaluateAll(buttons =>
            new Set(buttons.map(el => Math.round(el.getBoundingClientRect().top))).size);
        await ios.click();
        await expect(ios).toHaveAttribute("aria-pressed", "true");
        await expect(systems).toHaveCount(5);
        const viewports = [
            ...[320, 375, 390, 430].map(width => [width, "20px", "16px"]),
            [768, "24px", "18px"], [1280, "28px", "15px"],
        ];
        for (const [width, titleSize, sectionSize] of viewports) {
            await page.setViewportSize({ width, height: 844 });
            await expectPageWidth(page, width);
            await expect(page.locator(".page-heading h1")).toHaveCSS("font-size", titleSize);
            await expect(quickStart.locator(".panel-head h2")).toHaveCSS("font-size", sectionSize);
            if (width > 768) continue;
            for (const action of [nodeButton, manageButton]) {
                const metrics = await action.evaluate(el => {
                    const label = document.createRange();
                    label.selectNodeContents(el);
                    const rects = Array.from(label.getClientRects());
                    const box = el.getBoundingClientRect();
                    return {
                        lines: new Set(rects.map(rect => Math.round(rect.top))).size,
                        fits: rects.every(rect => rect.left >= box.left && rect.right <= box.right),
                        height: box.height,
                    };
                });
                expect(metrics.lines).toBe(1);
                expect(metrics.fits).toBe(true);
                expect(metrics.height).toBeGreaterThanOrEqual(44);
            }
            expect(await systems.evaluateAll(buttons =>
                buttons.every(el => el.getBoundingClientRect().height >= 44 && el.scrollWidth <= el.clientWidth)
            )).toBe(true);
            if (width === 320) expect(await systemRows()).toBeGreaterThan(1);
            if (width === 390) {
                expect(await systemRows()).toBe(1);
                await page.evaluate(() => document.documentElement.style.fontSize = "125%");
                expect(await systemRows()).toBeGreaterThan(1);
                const labelsFit = await systems.evaluateAll(buttons => buttons.every(el => {
                    const range = document.createRange();
                    range.selectNodeContents(el.firstChild);
                    const rects = Array.from(range.getClientRects());
                    const box = el.getBoundingClientRect();
                    return rects.length === 1 && rects[0].left >= box.left && rects[0].right <= box.right;
                }));
                expect(labelsFit).toBe(true);
                await expectPageWidth(page, width);
                await page.evaluate(() => document.documentElement.style.removeProperty("font-size"));
            }
        }
        await nodeButton.click();
        await expect(page.getByRole("region", { name: nodesLabel })).toBeFocused();
        await expect(manageButton).toHaveAttribute("href", "#/plan");
    });
}

test("user navigation keeps phone labels compact and touch targets accessible", async ({ page, context }) => {
    await consoleFixture(context, "user", path => {
        if (path === "/api/v10/me/subscription") return { subscriptionUrl: consoleOrigin + "/test-subscription" };
        if (path === "/api/v10/me/nodes" || path === "/api/v10/announcements" || path === "/api/v10/knowledge-articles") return [];
        if (path === "/api/v10/public/settings") return {};
        if (path === "/api/v10/me/notifications") return { items: [], ticketReplies: [], unread: 0 };
    });
    await page.goto(`${consoleOrigin}/app#/subscribe`);
    await expect(page.locator(".configuration-quick-start .device-options")).toBeVisible();
    const toggle = page.getByRole("button", { name: "打开导航", exact: true });
    await toggle.click();
    const sidebar = page.locator("#user-primary-navigation");
    const menu = sidebar.locator("nav");
    const current = menu.locator('[aria-current="page"]');
    const help = menu.getByRole("link", { name: "帮助中心" });
    const group = menu.locator(".nav-group > small").first();

    await expect(current).toHaveAttribute("href", "#/subscribe");
    await expect(current).toHaveCSS("font-weight", "600");
    expect(await current.evaluate(el => getComputedStyle(el).backgroundColor))
        .not.toBe(await help.evaluate(el => getComputedStyle(el).backgroundColor));
    for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(sidebar).toHaveAttribute("aria-modal", "true");
        await expect(current).toHaveCSS("font-size", width <= 600 ? "13px" : "14px");
        await expect(group).toHaveCSS("font-size", "12px");
        expect(await menu.getByRole("link").evaluateAll(links =>
            links.every(el => el.getBoundingClientRect().height >= 44 && el.scrollWidth <= el.clientWidth),
        )).toBe(true);
        await expectPageWidth(page, width);
        if (width === 390) {
            await page.screenshot({ path: test.info().outputPath("user-mobile-navigation-390.png"), animations: "disabled" });
            await page.evaluate(() => document.documentElement.style.fontSize = "125%");
            await expect(current).toHaveCSS("font-size", "16.25px");
            await expect(group).toHaveCSS("font-size", "15px");
            expect(await menu.getByRole("link").evaluateAll(links => links.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);
            await expectPageWidth(page, width);
            await page.evaluate(() => document.documentElement.style.removeProperty("font-size"));
        }
    }
    await help.click();
    await expect(page).toHaveURL(/#\/knowledge$/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(current).toHaveAttribute("href", "#/knowledge");
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(sidebar).not.toHaveAttribute("aria-modal", "true");
    await expect(current).toBeInViewport();
    await expect(current).toHaveCSS("font-size", "13px");
    await expect(group).toHaveCSS("font-size", "10px");
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
        await expect(page.locator(".checkout-heading h1")).toHaveCSS("font-size", "20px");
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

test("mobile admin users prioritize account columns and distinguish subscription expiry", async ({ page, context }) => {
    const fixedTime = new Date("2026-11-16T10:19:52Z");
    await page.clock.setFixedTime(fixedTime);
    const now = fixedTime.getTime() / 1000;
    const gib = 1024 ** 3;
    const account = { plan_id: 1, plan_name: "测试周期套餐", transfer_enable: gib, banned: 0 };
    await consoleFixture(context, "admin", path => {
        if (path === "/api/v1/test-admin/config/fetch") return {};
        if (path === "/api/v1/test-admin/plan/fetch") return [{ id: 1, name: "测试周期套餐" }, { id: 2, name: "测试额度包" }];
        if (path === "/api/v1/test-admin/user/fetch") return [
            { ...account, id: 1, email: "expired@example.test", expired_at: now - 3 * 86400, currency: "USD", total_paid_amount: 1234, total_recharge_amount: 0 },
            { ...account, id: 2, email: "active@example.test", expired_at: now + 27 * 86400, currency: "CNY", total_paid_amount: 0, credit_balance: 2 * gib, total_used: gib },
            { id: 3, email: "unknown@example.test", transfer_enable: 0, expired_at: null, currency: "CNY", banned: 0 },
            { ...account, id: 4, email: "expiring@example.test", expired_at: now + 2 * 86400, credit_balance: 0 },
            { id: 5, email: "purchased@example.test", transfer_enable: 0, expired_at: 0, has_recurring_order_history: true, banned: 0 },
            { id: 6, email: "never@example.test", transfer_enable: 0, expired_at: 0, has_recurring_order_history: false, banned: 0 },
            { id: 7, email: "missing@example.test", transfer_enable: 0, has_recurring_order_history: false, banned: 0 },
            { id: 8, email: "credit-only@example.test", plan_id: 2, plan_name: "测试额度包", transfer_enable: 0, expired_at: 0, has_recurring_order_history: false, credit_balance: 3 * gib, banned: 0 },
            { id: 9, email: "legacy@example.test", plan_id: 2, plan_name: "测试额度包", transfer_enable: gib, expired_at: null, credit_balance: 0, banned: 0 },
        ];
    });
    await page.goto(`${consoleOrigin}/admin.html#/users`);
    const userCell = (email, label) => page.getByRole("row").filter({ hasText: email }).locator(`td[data-label="${label}"]`);
    const expiryCell = (email) => userCell(email, "周期到期");
    const expired = expiryCell("expired@example.test").getByText("已到期", { exact: true });
    const expiringCell = expiryCell("expiring@example.test");
    const expiring = expiringCell.getByText("即将到期", { exact: true });
    await expect(expired).toHaveAttribute("data-tone", "danger");
    await expect(expiring).toHaveAttribute("data-tone", "warning");
    const [expiredColor, warningColor] = await Promise.all(
        [expired, expiring].map(badge => badge.evaluate(element => getComputedStyle(element).color)),
    );
    expect(expiredColor).not.toBe(warningColor);
    const activeCell = expiryCell("active@example.test");
    const timestamp = activeCell.locator("time");
    await expect(timestamp).toHaveText(/\s\d{2}:\d{2}$/);
    await expect(timestamp).toHaveAttribute("datetime", "2026-12-13T10:19:52.000Z");
    const active = activeCell.getByText("有效期内", { exact: true });
    await expect(active).toBeVisible();
    await expect(active).toHaveAttribute("data-tone", "success");
    await expect(active).toHaveCSS("color", "rgb(22, 101, 52)");
    const supplementaryColors = { info: "rgb(29, 78, 216)", neutral: "rgb(75, 85, 99)" };
    for (const [email, label, tone] of [
        ["unknown@example.test", "到期时间未记录", "info"],
        ["purchased@example.test", "到期时间未记录", "info"],
        ["never@example.test", "尚未购买周期套餐", "neutral"],
        ["missing@example.test", "到期信息缺失", "info"],
        ["credit-only@example.test", "尚未购买周期套餐", "neutral"],
        ["legacy@example.test", "旧版流量无固定到期", "info"],
    ]) {
        const cell = expiryCell(email);
        await expect(cell).toHaveText(label);
        const badge = cell.getByText(label, { exact: true });
        await expect(badge).toHaveAttribute("data-tone", tone);
        await expect(badge).toHaveCSS("color", supplementaryColors[tone]);
        await expect(cell.locator("time")).toHaveCount(0);
    }
    const priority = [
        "邮箱", "周期套餐", "周期到期", "余额", "累计实付", "佣金", "基础流量（GiB）", "已用（GiB）", "可用独立额度", "状态",
    ];
    const headers = page.getByRole("columnheader");
    for (const [index, name] of priority.entries()) {
        await expect(headers.nth(index)).toHaveAccessibleName(name);
    }
    for (const [email, amount] of [["expired@example.test", "USD 12.34"], ["active@example.test", "CNY 0.00"], ["unknown@example.test", "—"]]) {
        const row = page.getByRole("row").filter({ hasText: email });
        await expect(row.locator('td[data-label="累计实付"]')).toHaveText(amount);
    }
    for (const [email, plan, balance] of [
        ["active@example.test", "测试周期套餐", "2 GiB"],
        ["expiring@example.test", "测试周期套餐", "0 B"],
        ["credit-only@example.test", "—", "3 GiB"],
        ["legacy@example.test", "—", "0 B"],
        ["unknown@example.test", "—", "—"],
    ]) {
        await expect(userCell(email, "周期套餐")).toHaveText(plan);
        await expect(userCell(email, "可用独立额度")).toHaveText(balance);
    }
    expect(await page.locator(".users-page .table-viewport").evaluate(viewport => {
        viewport.scrollLeft = 40;
        return viewport.scrollLeft > 0;
    })).toBe(true);
    await expectPageWidth(page, 390);
    await page.setViewportSize({ width: 1280, height: 900 });
    const dateBounds = await expiringCell.locator("time").boundingBox();
    const statusBounds = await expiring.boundingBox();
    expect(dateBounds.y + dateBounds.height).toBeLessThan(statusBounds.y);
});

test.describe("desktop admin frontend", () => {
    test.use({ isMobile: false, hasTouch: false, viewport: { width: 1280, height: 900 } });

    test("reviews only the selected raw risk hits and keeps the rest pending", async ({ page, context }) => {
        await consoleFixture(context, "admin", () => []);
        const makeHit = (id, level) => ({
            id, user_id: id, email: `risk-${id}@example.test`, scene: "subscribe",
            rule_name: "订阅请求", risk_level: level, hit_at: 1700000000, payload: {},
        });
        let pending = [makeHit(71, "low"), makeHit(72, "medium")];
        const writes = [];
        await context.route("**/ops/log/rule-hit/fetch*", route => {
            const query = new URL(route.request().url()).searchParams;
            const items = query.get("review_state") === "pending" && query.get("grouped") !== "1"
                ? pending : [{ ...pending[0], id: 99, hit_count: 8 }];
            return route.fulfill({ json: { data: items, total: items.length } });
        });
        await context.route("**/ops/log/rule-hit/review", route => {
            const body = route.request().postDataJSON();
            writes.push(body);
            const count = pending.length;
            pending = pending.filter(hit => !body.ids.includes(hit.id));
            return route.fulfill({ json: { data: { updated: count - pending.length, skipped: 0 } } });
        });
        await page.goto(`${consoleOrigin}/admin.html#/access-logs-risk`);
        await page.getByText("待复核原始记录", { exact: true }).click();
        await page.getByRole("checkbox", { name: "选择本页待复核记录" }).check();
        const kept = page.getByRole("checkbox", { name: "选择命中记录 #72" });
        await kept.uncheck();
        const open = page.getByRole("button", { name: "批量复核", exact: true });
        await open.click();
        const dialog = page.getByRole("dialog", { name: "批量复核" });
        await dialog.getByRole("button", { name: "取消" }).click();
        expect(writes).toHaveLength(0);
        await open.click();
        await dialog.getByLabel("复核结论").selectOption("ignored");
        await dialog.getByLabel("统一备注").fill("已核对历史事件");
        await dialog.getByRole("button", { name: "确认复核" }).click();
        await expect(page.getByRole("checkbox", { name: "选择命中记录 #71" })).toHaveCount(0);
        await expect(kept).toBeVisible();
        expect(writes).toEqual([{ ids: [71], state: "ignored", note: "已核对历史事件" }]);
        await expect(page.getByRole("link", { name: "日志保留策略" })).toHaveAttribute("href", "#/log-settings");
        await expect(page.getByRole("button", { name: "一次性清理", exact: true })).toHaveCount(0);
    });

    for (const list of ["users", "tickets"]) {
        test(`${list} jumps directly to the requested page`, async ({ page, context }) => {
            await consoleFixture(context, "admin", () => []);
            const requests = [];
            let releaseLastPage;
            const lastPageReady = new Promise(resolve => { releaseLastPage = resolve; });
            const endpoint = list === "users" ? "user/fetch" : "ticket/fetch";
            await context.route(`**/api/v1/test-admin/${endpoint}*`, async route => {
                const params = new URL(route.request().url()).searchParams;
                const current = Number(params.get("current"));
                requests.push(current);
                if (current === Math.ceil(500 / Number(params.get("pageSize")))) await lastPageReady;
                const row = list === "users"
                    ? { id: current, email: `page-${current}@example.test`, banned: 0 }
                    : { id: current, subject: `工单页 ${current}`, status: 0 };
                return route.fulfill({ json: { data: [row], total: 500 } });
            });
            await page.goto(`${consoleOrigin}/admin.html#/${list}`);
            const pager = page.getByRole("navigation", { name: "分页" });
            const input = pager.getByRole("textbox", { name: "跳转页码" });
            const active = pager.locator('[aria-current="page"]');
            await expect(active).toHaveText("1");
            if (list === "users") {
                const [sizeBox, numberBox, jumpBox] = await Promise.all([
                    pager.getByLabel("每页显示行数").boundingBox(),
                    active.boundingBox(),
                    input.boundingBox(),
                ]);
                expect(numberBox.width).toBeGreaterThanOrEqual(32);
                expect(numberBox.height).toBeGreaterThanOrEqual(32);
                const controls = [sizeBox, numberBox, jumpBox];
                const top = Math.max(...controls.map(box => box.y));
                const bottom = Math.min(...controls.map(box => box.y + box.height));
                expect(bottom - top).toBeGreaterThan(16);
            }
            await input.fill("5");
            expect(requests.every(number => number === 1)).toBeTruthy();
            if (list === "users") await input.press("Enter");
            else await pager.getByRole("button", { name: "跳转", exact: true }).click();
            await expect(active).toHaveText("5");
            await expect(page.getByRole("row").filter({ hasText: list === "users" ? "page-5@example.test" : "工单页 5" })).toBeVisible();
            expect([...new Set(requests)]).toEqual([1, 5]);
            const lastPage = Math.ceil(500 / Number(await pager.getByLabel("每页显示行数").inputValue()));
            const last = pager.getByRole("button", { name: `第 ${lastPage} 页`, exact: true });
            await last.focus();
            await last.press("Enter");
            try {
                await expect(pager).toHaveAttribute("aria-busy", "true");
                await expect(last).toBeFocused();
            } finally {
                releaseLastPage();
            }
            await expect(active).toHaveText(String(lastPage));
            await expect(page.getByRole("row").filter({ hasText: list === "users" ? `page-${lastPage}@example.test` : `工单页 ${lastPage}` })).toBeVisible();
            await expect(last).toBeFocused();
            await pager.getByRole("button", { name: "第 1 页", exact: true }).click();
            await expect(active).toHaveText("1");
            await expect(page.getByRole("row").filter({ hasText: list === "users" ? "page-1@example.test" : "工单页 1" })).toBeVisible();
        });
    }

    test("desktop traffic trends fit 90 days and distinguish missing coverage from zero sessions", async ({ page, context }) => {
        const dateAt = index => new Date(Date.UTC(2026, 7, 21 + index)).toISOString().slice(0, 10);
        const history = Array.from({ length: 90 }, (_, index) => ({
            date: dateAt(index),
            available: index >= 10,
            sessions: index >= 10 && index < 60 ? 2 + index % 9 : 0,
        }));
        const total = days => days.reduce((sum, day) => sum + day.sessions, 0);
        await consoleFixture(context, "admin", (path, request) => {
            if (path === "/api/v1/test-admin/config/fetch") return {};
            if (path !== "/api/v1/test-admin/analytics/report") return;
            const days = Number(new URL(request.url()).searchParams.get("days"));
            const daily = history.slice(-days);
            return {
                ready: true, settings: { enabled: true, retentionDays: 90 }, timeZone: "UTC",
                from: daily[0].date + "T00:00:00Z", to: dateAt(89) + "T12:00:00Z",
                collectionStartedAt: dateAt(10) + "T00:00:00Z", effectiveFrom: dateAt(Math.max(10, 90 - days)) + "T00:00:00Z",
                sessions: total(daily), daily,
                previous: days === 30 ? { sessions: total(history.slice(30, 60)), from: dateAt(30) + "T00:00:00Z", to: dateAt(59) + "T12:00:00Z" } : null,
                sourceCoverage: { known: 0, unknown: total(daily), historical: 0 }, sources: [],
            };
        });
        await page.goto(`${consoleOrigin}/admin.html#/overview-analytics`);
        const metrics = page.locator(".analytics-metrics");
        await expect(metrics.getByText("-100%", { exact: true })).toBeVisible();
        await page.getByLabel("统计范围").selectOption("90");
        const chart = page.getByRole("img", { name: /每日访问会话趋势/ });
        await expect(chart.locator(":scope > div")).toHaveCount(90);
        await expect(chart.locator('[data-available="false"]')).toHaveCount(10);
        await expect(metrics.getByText(String(total(history)), { exact: true })).toBeVisible();
        await expect(metrics.getByText("80 / 90 天", { exact: true })).toBeVisible();
        await expect(page.locator(".analytics-trend figcaption")).toContainText("单日最高会话 10");
        await expect(chart.locator('[data-available="true"] > span')).toHaveCount(50);
        await expect(metrics.getByText("—", { exact: true })).toBeVisible();
        expect(await chart.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await expectPageWidth(page, 1280);
        await page.screenshot({ path: test.info().outputPath("admin-traffic-90-days-desktop.png") });
        await page.getByText("每日会话明细", { exact: true }).click();
        const newest = page.locator("details[open] tbody tr").first();
        await expect(newest.getByRole("cell").first()).toHaveText(dateAt(89));
        await expect(newest.getByRole("cell").last()).toHaveText("0");
    });

    test("desktop conversion and experience distinguish sessions, accounts and zero denominators", async ({ page, context }) => {
        const bounds = {
            from: "2026-10-01T00:00:00Z", to: "2026-10-30T02:00:00Z", timeZone: "Asia/Shanghai",
            effectiveFrom: "2026-10-01T00:00:00Z", collectionStartedAt: "2026-10-01T00:00:00Z",
        };
        const requests = [];
        await consoleFixture(context, "admin", (path, request) => {
            if (path === "/api/v1/test-admin/config/fetch") return {};
            if (!path.startsWith("/api/v1/test-admin/analytics/")) return;
            const query = new URL(request.url()).searchParams;
            const view = query.get("view");
            const device = query.get("device");
            const mobile = device === "mobile";
            requests.push({ view, device });
            const common = { ...bounds, ready: true, settings: { enabled: true, retentionDays: 30 } };
            if (view === "traffic") return {
                ...common, sessions: 20, previous: null, daily: [{ date: "2026-10-30", sessions: 20, available: true }],
                sourceCoverage: { known: 12, unknown: 8, historical: 0 }, sources: [{ domain: "partner.example.test", sessions: 12, paymentEntries: 3 }],
            };
            if (view === "conversion") return {
                ...common, visitedSessions: mobile ? 2 : 20,
                funnel: [
                    { step: "plan", sessions: mobile ? 0 : 10 }, { step: "confirmation", sessions: mobile ? 0 : 4 },
                    { step: "payment", sessions: mobile ? 0 : 3 },
                ],
                firstPurchase: {
                    ...bounds, available: true, windowDays: 7, registered: 10, verifiedPayingAccounts: 5,
                    verifiedRecurringAccounts: 4, verifiedCreditAccounts: 2,
                    funding: { externalOnly: 4, mixed: 0, walletOnly: 0, manual: 0, unclassified: 0 },
                },
            };
            if (view === "experience") return { experience: {
                ...bounds, available: true, enabled: true, retentionDays: 30, observedSessions: 20, affectedSessions: 3,
                rows: [
                    { page: "plan", event: "api_error", sessions: 3, samples: 6, average: null, p75Upper: null, p95Upper: null },
                    { page: "payment", event: "js_error", sessions: 2, samples: 2, average: null, p75Upper: null, p95Upper: null },
                ],
            } };
        });
        await page.goto(`${consoleOrigin}/admin.html#/overview-analytics`);
        await expect(page.getByRole("row", { name: "partner.example.test 12 3 25%" })).toBeVisible();
        await expectPageWidth(page, 1280);
        await page.getByRole("tab", { name: "购买转化" }).click();
        const metrics = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: /新用户付费转化/ }) }).locator(".analytics-metrics > div");
        await expect(metrics.filter({ hasText: "整体付费转化率" })).toContainText("50%5 / 10");
        await expect(metrics.filter({ hasText: "周期套餐首购" })).toContainText("40%4 / 10");
        await expect(metrics.filter({ hasText: "独立额度包购买" })).toContainText("20%2 / 10");
        await expect(page.getByRole("row", { name: "全部采集会话 → 浏览套餐 20 10 50% 10" })).toBeVisible();
        await expect(page.getByRole("row", { name: "浏览套餐 → 确认订单 10 4 40% 6" })).toBeVisible();
        await expect(page.getByRole("row", { name: "确认订单 → 进入付款 4 3 75% 1" })).toBeVisible();
        await expect(page.locator(".analytics-path-summary")).toContainText("15%");
        await expectPageWidth(page, 1280);
        await page.screenshot({ path: test.info().outputPath("admin-purchase-conversion-desktop.png"), fullPage: true });
        await page.getByLabel("访问设备").selectOption("mobile");
        await expect(page.getByRole("row", { name: "全部采集会话 → 浏览套餐 2 0 0% 2" })).toBeVisible();
        await expect(page.getByRole("row", { name: "浏览套餐 → 确认订单 0 0 — 0" })).toBeVisible();
        await expect(metrics.filter({ hasText: "整体付费转化率" })).toContainText("50%5 / 10");
        await page.getByLabel("访问设备").selectOption("all");
        await page.getByRole("tab", { name: "体验问题" }).click();
        await expect(page.getByText(/个已采集会话上报过异常/)).toContainText("3 / 20 个已采集会话上报过异常（15%）");
        await expect(page.getByRole("row", { name: "浏览套餐 接口错误 3" })).toBeVisible();
        await expect(page.getByRole("row", { name: "进入付款 脚本异常 2" })).toBeVisible();
        await expect(page.getByText(/查询范围/)).toContainText("业务时区 Asia/Shanghai");
        const beforeRefresh = requests.length;
        await page.getByRole("button", { name: "刷新体验报表" }).click();
        await expect.poll(() => requests.length).toBe(beforeRefresh + 1);
        expect(requests.at(-1)).toEqual({ view: "experience", device: "all" });
        await expectPageWidth(page, 1280);
        await page.screenshot({ path: test.info().outputPath("admin-experience-summary-desktop.png"), fullPage: true });
    });

    test("a signed-in refresh waits without displaying the sign-in layout", async ({ page, context }) => {
        const url = `${consoleOrigin}/admin.html#/users`;
        const email = "refresh@example.test";
        let refreshing = false;
        let finishVerification;
        const permissionCheck = new Promise(resolve => { finishVerification = resolve; });
        await consoleFixture(context, "admin", async path => {
            if (path === "/api/v1/test-admin/config/fetch") {
                if (refreshing) await permissionCheck;
                return {};
            }
            if (path === "/api/v1/test-admin/user/fetch") return [{ id: 11, email }];
        });
        await page.goto(url);
        await expect(page.getByRole("button", { name: `ID: 11 · ${email}` })).toBeVisible();

        refreshing = true;
        try {
            await page.reload({ waitUntil: "domcontentloaded" });
            await expect(page.getByRole("status")).toHaveText("Checking your session…");
            await expect(page.locator(".workspace-access")).toHaveCount(0);
            await expect(page.getByRole("button", { name: `ID: 11 · ${email}` })).toHaveCount(0);
        } finally {
            finishVerification();
        }
        await expect(page.getByRole("button", { name: `ID: 11 · ${email}` })).toBeVisible();
        await expect(page).toHaveURL(url);
    });

    test("the workspace entrance stays in English until sign-in verification succeeds", async ({ page, context }) => {
        const loginPath = "/api/v1/passport/auth/login";
        const verificationPath = "/api/v1/passport/mfa/verifications";
        const configPath = "/api/v1/test-admin/config/fetch";
        const configuredTitle = "后台控制台";
        const authRequests = [];
        await consoleFixture(context, "admin", (path, request) => {
            if ([loginPath, verificationPath, configPath].includes(path)) {
                authRequests.push({
                    path,
                    method: request.method(),
                    language: request.headers()["content-language"],
                    body: request.postDataJSON(),
                });
            }
            if (path === loginPath) return {
                mfaRequired: true, challengeId: "a".repeat(64), preferredMethod: "totp",
                methods: ["totp", "recovery"], expiresAt: "2099-01-01T00:00:00Z",
            };
            if (path === verificationPath) return { authenticated: true, accountId: 7 };
            if (path === configPath) return {};
        }, { authenticated: false, title: configuredTitle });
        await page.goto(`${consoleOrigin}/admin.html#/login`);
        const preferredLanguage = () => page.evaluate(() => localStorage.getItem("fastai.language"));
        const html = page.locator("html");
        const body = page.locator("body");
        const heading = page.getByRole("heading", { name: "Sign in" });
        await expect(heading).toBeVisible();
        await expect(page).toHaveTitle("Workspace access");
        await expect(html).toHaveAttribute("lang", "en-US");
        await expect(body).not.toContainText(/admin console|[\u3400-\u9fff]/i);
        await expectPageWidth(page, 1280);
        const artwork = await page.locator(".workspace-access-art").boundingBox();
        const form = await page.locator(".workspace-access-form").boundingBox();
        expect(artwork.x + artwork.width).toBeLessThan(form.x);
        expect(await preferredLanguage()).toBe("zh-CN");

        await page.getByRole("link", { name: "Forgot your password?" }).click();
        await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
        await expect(page.getByLabel("Verification code")).toBeVisible();
        await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
        await expect(page).toHaveTitle("Workspace access");
        await expect(body).not.toContainText(/[\u3400-\u9fff]/);
        await page.goBack();
        await expect(heading).toBeVisible();

        await page.getByLabel("Email address").fill("account@example.test");
        await page.getByLabel("Password", { exact: true }).fill("Testing!2026");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Login verification" })).toBeVisible();
        expect(authRequests.map(request => request.path)).toEqual([loginPath]);
        await expect(page).toHaveTitle("Workspace access");
        await expect(body).not.toContainText(/[\u3400-\u9fff]/);
        await page.getByLabel("Verification code").fill("123456");
        await page.getByRole("button", { name: "Verify and sign in" }).click();
        await expect(page.getByRole("heading", { name: "仪表盘", exact: true })).toBeVisible();
        await expect(html).toHaveAttribute("lang", "zh-CN");
        expect(await preferredLanguage()).toBe("zh-CN");
        expect(authRequests).toEqual([
            { path: loginPath, method: "POST", language: "en-US", body: { email: "account@example.test", password: "Testing!2026" } },
            { path: verificationPath, method: "POST", language: "en-US", body: { challengeId: "a".repeat(64), verificationMethod: "totp", verificationCode: "123456" } },
            { path: configPath, method: "GET", language: "en-US", body: null },
        ]);
    });

    test("desktop admin actions distinguish confirm, danger and secondary controls", async ({ page, context }) => {
        const writes = [];
        await consoleFixture(context, "admin", (path, request) => {
            if (path === "/api/v1/test-admin/config/fetch") return {};
            if (path === "/api/v1/test-admin/plan/fetch") return [];
            if (path === "/api/v1/test-admin/user/fetch") return [{ id: 7, email: "account@example.test" }];
            if (path === "/api/v1/test-admin/user/usageResetPreview") return { count: 1 };
            if (path === "/api/v1/test-admin/coupon/fetch") return [{ id: 12, name: "测试券模板", type: 2, value: 10, show: 1 }];
            if (request.method() !== "GET") writes.push(path);
        });
        await page.goto(`${consoleOrigin}/admin.html#/users`);
        const search = page.getByRole("button", { name: "搜索", exact: true });
        const userRow = page.getByRole("row").filter({ hasText: "account@example.test" });
        const userLink = userRow.getByRole("button", { name: "ID: 7 · account@example.test" });
        await expect(userLink).toBeVisible();
        expect((await userLink.boundingBox()).width).toBeGreaterThanOrEqual(160);
        expect((await userRow.boundingBox()).height).toBeLessThan(62);
        expect((await userRow.locator(".table-actions").boundingBox()).width).toBeLessThan(165);
        await expect(userLink).toHaveCSS("background-color", "rgb(255, 255, 255)");
        await expect(userLink).toHaveCSS("border-top-width", "1px");
        expect((await userLink.boundingBox()).height).toBeGreaterThanOrEqual(32);
        await userLink.hover();
        await expect(userLink).toHaveCSS("background-color", "rgb(248, 250, 252)");
        await expect(userLink).toHaveCSS("color", "rgb(65, 69, 82)");
        await expect(userLink).toHaveCSS("text-decoration-line", "none");
        await userLink.focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(userLink).toBeFocused();
        await expect(userLink).toHaveCSS("outline-style", "solid");
        const viewport = page.locator(".users-page .table-viewport");
        const identity = userRow.locator('td[data-label="邮箱"]');
        const plan = userRow.locator('td[data-label="周期套餐"]');
        const identityLeft = (await identity.boundingBox()).x;
        const planLeft = (await plan.boundingBox()).x;
        await viewport.evaluate(element => { element.scrollLeft = 400; });
        expect(await viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(100);
        expect(Math.abs((await identity.boundingBox()).x - identityLeft)).toBeLessThan(2);
        expect((await plan.boundingBox()).x).toBeLessThan(planLeft - 100);
        await expect(userLink).toBeVisible();
        await expect(userRow.getByRole("button", { name: "编辑", exact: true })).toBeInViewport();
        await page.screenshot({ path: test.info().outputPath("admin-users-scrolled.png") });
        await viewport.evaluate(element => { element.scrollLeft = 0; });
        const batch = page.getByRole("button", { name: "批量操作" });
        await expect(search).toHaveClass("primary");
        await batch.focus();
        await page.keyboard.press("ArrowDown");
        const group = page.getByRole("group", { name: "用户批量操作" });
        await expect(group).toBeVisible();
        await viewport.evaluate(element => element.dispatchEvent(new Event("scroll")));
        const reset = group.getByRole("button", { name: "全局重置用量" });
        const mail = group.getByRole("button", { name: "发送邮件" });
        await expect(group.getByRole("button", { name: "批量封禁" })).toBeDisabled();
        await expect(group.getByRole("button", { name: "批量删除" })).toBeDisabled();
        await expect(reset).toHaveClass("danger");
        expect((await reset.boundingBox()).height).toBeGreaterThanOrEqual(36);
        expect(await reset.evaluate(element => getComputedStyle(element).color))
            .not.toBe(await mail.evaluate(element => getComputedStyle(element).color));
        await reset.click();
        const dialog = page.getByRole("dialog", { name: "全局重置用量" });
        await expect(dialog.getByRole("button", { name: "确认全局重置" })).toBeDisabled();
        await dialog.getByRole("button", { name: "取消" }).click();
        await expect(batch).toBeFocused();
        await expect(batch).toHaveAttribute("aria-expanded", "false");

        await page.goto(`${consoleOrigin}/admin.html#/coupons`);
        const row = page.getByRole("row").filter({ hasText: "测试券模板" });
        await expect(row.getByRole("switch")).toBeChecked();
        await expect(row.getByRole("button", { name: "切换启用" })).toHaveCount(0);
        await expect(row.getByRole("button", { name: "删除" })).toHaveCount(0);
        const more = row.getByRole("button", { name: "更多操作" });
        expect((await more.boundingBox()).height).toBeGreaterThanOrEqual(32);
        await more.click();
        const remove = page.getByRole("group", { name: "测试券模板 更多操作" }).getByRole("button", { name: "删除" });
        await expect(remove).toHaveClass("danger");
        const refusal = page.waitForEvent("dialog").then(confirmation => confirmation.dismiss());
        await Promise.all([refusal, remove.click()]);
        await expect(more).toBeFocused();
        expect(writes).toEqual([]);
    });

    test("desktop settings keep compact fields and drawer focus below the title", async ({ page, context }) => {
        const user = { id: 7, email: "account@example.test", transfer_enable: 1073741824, expired_at: 1900000000 };
        await consoleFixture(context, "admin", path => {
            if (path === "/api/v1/test-admin/config/fetch") return {
                site: { app_name: "Example service", app_url: "https://console.example.test", app_description: "Example site description",
                    system_timezone: "Asia/Shanghai", logo: "", force_https: 1, landing_style: "original", tos_url: "", subscribe_url: "" },
            };
            if (path === "/api/v1/test-admin/console/configSchema") return {};
            if (path === "/api/v1/test-admin/server/group/fetch") return [];
            if (path === "/api/v1/test-admin/plan/fetch") return [];
            if (path === "/api/v1/test-admin/user/fetch") return [user];
            if (path === "/api/v1/test-admin/user/getUserInfoById") return { ...user, edit_versions: {} };
        });
        await page.goto(`${consoleOrigin}/admin.html#/site-settings`);
        const name = page.locator("[data-field=app_name] input");
        await expect(name).toHaveValue("Example service");
        const label = page.locator("[data-field=app_name] > span");
        expect((await label.boundingBox()).width).toBeLessThan(220);
        expect((await name.boundingBox()).width).toBeLessThanOrEqual(512);
        await page.getByRole("combobox", { name: "定位设置项" }).selectOption("app_name");
        await expect(name).toBeFocused();
        await page.getByRole("heading", { level: 1 }).click();
        await page.keyboard.press("Control+k");
        const navigationSearch = page.getByRole("searchbox", { name: "搜索后台页面" });
        await expect(navigationSearch).toBeFocused();
        await navigationSearch.fill("支持 用户管理");
        await navigationSearch.press("Enter");
        await expect(page).toHaveURL(`${consoleOrigin}/admin.html#/users`);
        await page.getByRole("button", { name: "编辑", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "编辑 · 用户管理" });
        const email = dialog.locator("[data-field=email] input");
        await expect(email).toHaveValue(user.email);
        const header = dialog.locator(".panel-head").first();
        const title = await header.boundingBox();
        const reserved = await dialog.evaluate(dialog => Number.parseFloat(getComputedStyle(dialog).scrollPaddingBlockStart));
        expect(reserved).toBeGreaterThanOrEqual(title.height);
        await dialog.evaluate(dialog => { dialog.scrollTop = dialog.scrollHeight; });
        await email.focus();
        await expect(email).toBeFocused();
        expect((await email.boundingBox()).y).toBeGreaterThanOrEqual(title.y + title.height);
    });

    test("coupon recipient details fit desktop content and recover from an empty filter", async ({ page, context }) => {
        await consoleFixture(context, "admin", path => {
            if (path === "/api/v1/test-admin/config/fetch") return {};
            if (path === "/api/v1/test-admin/coupon/fetch") return [];
        });
        await context.route(`${consoleOrigin}/api/v1/test-admin/coupon-campaign/*`, async route => {
            const url = new URL(route.request().url());
            const data = url.pathname.endsWith("/fetch") ? [{
                id: 3, couponName: "回归优惠", discountPercent: 10, scope: "filtered", status: "completed",
                matched: 2, issued: 1, skipped: 1, failed: 0, pending: 0, cancelled: 0, createdAt: 1794800000,
            }] : url.searchParams.get("status") ? [] : [
                    { user_id: 7, status: "issued", reason: "issued", updated_at: 1794800000 },
                    { user_id: 8, status: "skipped", reason: "already_claimed", updated_at: 1794800000 },
                ];
            return route.fulfill({ json: { data, total: data.length } });
        });
        await page.goto(`${consoleOrigin}/admin.html#/coupons`);
        await page.getByRole("tab", { name: "发放记录", exact: true }).click();
        const trigger = page.getByRole("button", { name: "查看明细" });
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "批次 #3 发放明细" });
        await expect(dialog.getByText("已领取或已使用")).toBeVisible();
        await expect(dialog.getByRole("navigation", { name: "分页" })).toContainText("共 2 条");
        expect((await dialog.boundingBox()).width).toBeGreaterThan(700);
        await page.screenshot({ path: test.info().outputPath("admin-coupon-recipients.png") });
        const status = dialog.getByLabel("结果筛选");
        await status.selectOption("failed");
        await expect(dialog.getByText("没有符合所选结果的发放记录")).toBeVisible();
        await expect(dialog.getByRole("table")).toHaveCount(0);
        await dialog.getByRole("button", { name: "清除结果筛选" }).click();
        await expect(dialog.getByText("已领取或已使用")).toBeVisible();
        await expect(status).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
    });

    test("desktop mail logs keep advanced conditions visible as a count and focus invalid fields", async ({ page, context }) => {
        const requests = [];
        const mail = { id: 7, email: "mail@example.test", status: "accepted", provider: "mailgun" };
        await consoleFixture(context, "admin", (path, request) => {
            if (path === "/api/v1/test-admin/config/fetch") return {};
            if (path === "/api/v1/test-admin/mail-logs/health") return {};
            if (path === "/api/v1/test-admin/mail-logs/suppressions") return [];
            if (path === "/api/v1/test-admin/mail-logs/fetch") {
                const query = new URL(request.url()).searchParams;
                requests.push(query);
                return query.has("enhanced_code") ? [] : [mail];
            }
        });
        await page.goto(`${consoleOrigin}/admin.html#/mail-logs`);
        await expect(page.getByRole("row").filter({ hasText: mail.email })).toBeVisible();
        const filter = page.getByRole("form", { name: "筛选条件" })
            .filter({ has: page.getByLabel("收件邮箱（精确查询）") });
        const advanced = filter.getByRole("button", { name: /^高级筛选/ });
        const query = filter.getByRole("button", { name: "查询" });
        const smtp = filter.getByLabel("SMTP 增强码");
        await expect(smtp).toBeHidden();
        expect((await filter.boundingBox()).height).toBeLessThan(120);
        await page.screenshot({ path: test.info().outputPath("admin-mail-default.png") });
        await advanced.click();
        await smtp.fill("invalid");
        await advanced.click();
        await expect(advanced).toContainText("有未提交的条件");
        await query.click();
        await expect(advanced).toHaveAttribute("aria-expanded", "true");
        await expect(smtp).toBeFocused();
        expect(requests).toHaveLength(1);

        await smtp.fill("5.1.1");
        await filter.getByLabel("投递反馈").selectOption("temporary");
        await advanced.click();
        await query.click();
        await expect(page.getByText("暂无匹配邮件日志")).toBeVisible();
        await expect(advanced).toContainText("已应用 2 项");
        await expect(advanced).not.toContainText("未提交");
        expect(requests.at(-1).get("enhanced_code")).toBe("5.1.1");
        expect(requests.at(-1).get("delivery_status")).toBe("temporary");
        await filter.getByRole("button", { name: "重置" }).click();
        await expect(advanced).toHaveText("高级筛选");
        await expect(page.getByRole("row").filter({ hasText: mail.email })).toBeVisible();
        await advanced.click();
        await page.screenshot({ path: test.info().outputPath("admin-mail-advanced.png") });
    });
});

test("admin order details adapt to mobile and desktop and keep diagnostics reachable", async ({ page, context }) => {
    const tradeNo = "order-" + "1234567890".repeat(12);
    const email = "account-" + "abcdef".repeat(9) + "@example.test";
    const requestId = "12345678-1234-4234-8234-123456789abc";
    const rawResponse = '{"reference":"' + "abcdefghij".repeat(30) + '"}';
    const rawRequests = [];
    const creditRequests = [];
    const order = {
        id: 1, trade_no: tradeNo, user_id: 7, email,
        currency: "CNY", period: "month_price", type: 1, status: 3, plan_id: 1,
        total_amount: 5880, created_at: 1791849600, paid_at: 1791849640,
        purchase_stage: "expired_repurchase", repurchase_expiry_status: "expired", repurchase_gap_days: 23,
    };
    const firstPurchase = {
        ...order, id: 2, trade_no: "first-purchase", user_id: 8, email: "first@example.test",
        purchase_stage: "first_purchase", repurchase_expiry_status: undefined, repurchase_gap_days: undefined,
    };
    const repeatPurchase = {
        ...order, id: 3, trade_no: "historical-repeat-purchase", email: "repeat@example.test",
        purchase_stage: "repeat_purchase", repurchase_expiry_status: "unknown", repurchase_gap_days: undefined,
    };
    const legacyCredit = {
        ...order, id: 4, trade_no: "historical-credit-purchase", period: "onetime_price",
        purchase_stage: undefined, repurchase_expiry_status: undefined, repurchase_gap_days: undefined,
    };
    const activeRepeat = {
        ...repeatPurchase, id: 5, trade_no: "active-repeat-purchase", email: "active@example.test", repurchase_expiry_status: "not_expired",
    };
    await consoleFixture(context, "admin", (path, request) => {
        if (path === "/api/v1/test-admin/config/fetch") return {};
        if (path === "/api/v1/test-admin/plan/fetch") return [{ id: 1, name: "测试套餐" }];
        if (path === "/api/v1/test-admin/order/fetch") return [order, firstPurchase, repeatPurchase, legacyCredit, activeRepeat];
        if (path === "/api/v1/test-admin/ops/risk/user-activity/fetch") return {
            user: { id: 7, email, current_plan_name: "当前生效的测试套餐", transfer_enable: 1073741824, expired_at: 1950000000, credit_balance: 1073741824 },
            events: [],
        };
        if (path === "/api/v1/test-admin/user/creditBatches") {
            creditRequests.push(new URL(request.url()).searchParams.get("user_id"));
            return [];
        }
        if (path === "/api/v1/test-admin/order/detail" && request.postDataJSON()?.id === 3) return repeatPurchase;
        if (path === "/api/v1/test-admin/order/detail" && request.postDataJSON()?.id === 5) return activeRepeat;
        if (path === "/api/v1/test-admin/order/detail") return {
            ...order,
            payment_attempt_history: { available: true, events: [{
                id: 3, provider: "EPayQrcode", stage: "gateway", result: "failed", reason: "gateway_rejected",
                created_at: 1791849620, request_id: requestId, gateway_host: "gateway.example.test",
                gateway_http_status: 200, gateway_code: 0, has_raw_diagnostic: true,
            }] },
            callback_history: { available: true, events: [] },
        };
        if (path.startsWith("/api/v1/test-admin/payment/diagnostics/")) rawRequests.push(path);
        if (path === "/api/v1/test-admin/payment/diagnostics/attempt/3") {
            return { sections: [{ title: "网关响应", text: rawResponse }] };
        }
    });
    await page.goto(`${consoleOrigin}/admin.html#/orders`);
    const repeatCells = page.getByRole("cell", { name: "再次购买", exact: true });
    await expect(repeatCells).toHaveCount(3);
    await expect(page.getByRole("cell", { name: "到期回购", exact: true })).toHaveCount(0);
    const returningRow = page.getByRole("row").filter({ hasText: email }).filter({ has: page.getByRole("cell", { name: "再次购买", exact: true }) });
    const returningCell = returningRow.getByRole("cell", { name: "再次购买", exact: true });
    const returningType = returningCell.locator(".admin-order-type");
    const firstType = page.getByRole("cell", { name: "首购", exact: true }).locator(".admin-order-type");
    const badgeColors = badge => badge.evaluate(element => {
        const { color, backgroundColor } = getComputedStyle(element);
        return { color, backgroundColor };
    });
    await expect(returningType).toBeVisible();
    await expect(returningType).toHaveClass(/\border-type-plan\b/);
    await expect(firstType).toHaveClass(/\border-type-first\b/);
    const repeatRow = page.getByRole("row").filter({ hasText: repeatPurchase.email });
    const repeatCell = repeatRow.getByRole("cell", { name: "再次购买", exact: true });
    const repeatType = repeatCell.locator(".admin-order-type");
    await expect(repeatType).toHaveClass(/\border-type-plan\b/);
    await expect(repeatType).toHaveAttribute("data-tone", "info");
    await expect(page.getByRole("cell", { name: "额度购买", exact: true }).locator(".admin-order-type"))
        .toHaveClass(/\border-type-traffic\b/);
    await expect(page.getByRole("cell", { name: "新购", exact: true })).toHaveCount(0);
    const returningColors = await badgeColors(returningType);
    expect(returningColors.backgroundColor).not.toBe((await badgeColors(firstType)).backgroundColor);
    expect(returningColors).toEqual(await badgeColors(repeatType));

    const identity = returningRow.getByRole("button", { name: `ID: 7 · ${email}` });
    await expect(identity).toHaveCSS("border-top-width", "1px");
    await expect(identity).toHaveCSS("color", "rgb(65, 69, 82)");
    await identity.focus();
    await page.keyboard.press("Enter");
    const identityDrawer = page.getByRole("dialog", { name: /^用户详情/ });
    await expect(identityDrawer.getByText("当前生效的测试套餐", { exact: true })).toBeVisible();
    await expect(identityDrawer.getByRole("tab", { name: "订单", exact: true })).toBeVisible();
    await expect(identityDrawer.getByRole("tab", { name: "流量额度包", exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${consoleOrigin}/admin.html#/orders`);
    await page.keyboard.press("Escape");
    await expect(identityDrawer).toHaveCount(0);
    await expect(identity).toBeFocused();
    await expect(identity).toHaveCSS("text-decoration-line", "none");

    await repeatRow.getByRole("button", { name: "订单详情" }).click();
    const repeatDetails = page.getByRole("dialog", { name: "订单详情" });
    await expect(repeatDetails.getByText("缺少可核实的下单前到期记录，无法确认是否到期回购。", { exact: true })).toBeVisible();
    await expect(repeatDetails.getByText("到期情况不详", { exact: true })).toHaveAttribute("data-tone", "neutral");
    await expect(repeatDetails.getByText("回购间隔", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(repeatDetails).toHaveCount(0);

    await page.getByRole("row").filter({ hasText: activeRepeat.email }).getByRole("button", { name: "订单详情" }).click();
    await expect(repeatDetails.getByText("有效期内购买", { exact: true })).toHaveAttribute("data-tone", "info");
    await expect(repeatDetails.getByText("下单时原周期仍在有效期内。", { exact: true })).toBeVisible();
    await expect(repeatDetails.getByText("到期情况不详", { exact: true })).toHaveCount(0);
    await expect(repeatDetails.getByText("回购间隔", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(repeatDetails).toHaveCount(0);

    const detailButton = returningRow.getByRole("button", { name: "订单详情" });
    await detailButton.click();
    const details = page.getByRole("dialog", { name: "订单详情" });
    for (const name of ["订单概况", "金额与渠道", "支付诊断"]) {
        await expect(details.getByRole("heading", { name })).toBeVisible();
    }
    await expect(details.getByText(tradeNo, { exact: true })).toBeVisible();
    await expect(details.getByText("到期 23 天后回购", { exact: true })).toBeVisible();
    const detailType = details.locator(".admin-order-type.order-type-returning");
    await expect(detailType).toHaveText("到期回购");
    expect((await badgeColors(detailType)).backgroundColor).not.toBe(returningColors.backgroundColor);
    expect(await badgeColors(details.getByText("再次购买", { exact: true }))).toEqual(returningColors);
    const completion = details.getByText("已完成", { exact: true });
    await expect(completion).toHaveAttribute("data-tone", "success");
    expect((await badgeColors(completion)).backgroundColor).not.toBe(returningColors.backgroundColor);
    const user = details.getByRole("button", { name: `ID: 7 · ${email}` });
    await expect(user).toBeVisible();
    await expect(user).toHaveCSS("border-top-width", "1px");
    await expect(user).toHaveCSS("color", "rgb(65, 69, 82)");
    expect(await user.evaluate(button => button.scrollWidth <= button.clientWidth)).toBe(true);
    const diagnostics = details.getByRole("region", { name: "支付诊断" });
    await expect(diagnostics.getByRole("link", { name: requestId })).toHaveAttribute("href", `#/system-log?request_id=${requestId}`);
    expect(await diagnostics.locator(".table-viewport").evaluate(viewport =>
        viewport.scrollWidth > viewport.clientWidth
    )).toBe(true);
    expect(await details.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    await expectPageWidth(page, 390);
    expect(rawRequests).toHaveLength(0);

    const trigger = diagnostics.getByRole("button", { name: "查看原始诊断" });
    await trigger.click();
    const raw = page.getByRole("dialog", { name: "原始支付诊断" });
    await expect(raw.getByRole("heading", { name: "网关响应" })).toBeVisible();
    const code = raw.locator("pre");
    await expect(code).toHaveText(rawResponse);
    expect(await code.evaluate(pre => pre.scrollWidth <= pre.clientWidth)).toBe(true);
    expect(await raw.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    expect(rawRequests).toEqual(["/api/v1/test-admin/payment/diagnostics/attempt/3"]);
    await page.keyboard.press("Escape");
    await expect(raw).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await user.click();
    const userDetails = page.getByRole("dialog", { name: /^用户详情/ });
    const account = userDetails.getByRole("region", { name: "账户概况" });
    await expect(account.getByText("当前周期套餐")).toBeVisible();
    await expect(account.getByText("当前生效的测试套餐")).toBeVisible();
    await expect(account.locator(".admin-subscription-expiry time")).toHaveText(/\d{2}:\d{2}:\d{2}$/);
    await expect(account.getByText("有效期内", { exact: true })).toHaveAttribute("data-tone", "success");
    await expect(account.getByText("可用独立额度")).toBeVisible();
    await expect(account.getByText("1 GiB")).toBeVisible();
    expect(creditRequests).toEqual([]);
    await account.getByRole("button", { name: "查看额度批次" }).click();
    await expect(userDetails.getByRole("tab", { name: "流量额度包" })).toHaveAttribute("aria-selected", "true");
    await expect(userDetails.getByRole("region", { name: "流量额度批次" })).toBeFocused();
    await expect.poll(() => creditRequests).toEqual(["7"]);
    await page.keyboard.press("Escape");
    await expect(user).toBeFocused();
    await expect(user).toHaveCSS("text-decoration-line", "none");
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: 900 });
    for (const badge of await page.locator("td .admin-order-type").all()) {
        expect((await badge.boundingBox()).height).toBeLessThan(32);
    }
    await page.locator(".table-viewport").evaluateAll(viewports => viewports.forEach(viewport => { viewport.scrollLeft = 0; }));
    await page.screenshot({ path: test.info().outputPath("admin-order-types-desktop.png") });
    await detailButton.click();
    const overview = await details.getByRole("heading", { name: "订单概况" }).boundingBox();
    const payment = await details.getByRole("heading", { name: "金额与渠道" }).boundingBox();
    expect(overview.y).toBe(payment.y);
    expect(overview.x).toBeLessThan(payment.x);
    expect(await details.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("admin-order-return-evidence-desktop.png") });
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

test("desktop node deployment keeps the live relay until its candidate is tested", async ({page, context}) => {
    await page.setViewportSize({width:1440,height:960});
    const node = {id:12, type:"v2box", name:"测试代理服务", protocol:"vless", show:1, group_id:[],
        host:"live.example.test", port:443, server_port:8443, tls:0, runtime_status:"online"};
    const entry = {id:8, purpose:"entry", server_id:2, enabled:true, domain:"next.example.test"};
    const candidate = {host:entry.domain,port:7443,previousHost:node.host,previousPort:443,ready:true,proof:"f".repeat(64),protocol:"vless"};
    let published=false;
    const submissions=[];
    await consoleFixture(context,"admin",(path, request) => {
        if (path.endsWith("/manage/getNodes")) return [published ? {...node,host:candidate.host,port:candidate.port} : node];
        if (path.endsWith("/connections/default")) return {revision:"current",values:{...node,tags:[]},sharedLines:0};
        if (path.endsWith("/manage/runtime")) return {runtimeStatus:"online",applicationState:"applied"};
        if (path.endsWith("/server/credentials")) return {keys:[{status:"active",lastUsedAt:1}],deploymentTask:{id:"latest",phase:"issued"}};
        if (path.endsWith("/ddns/fetch")) return {servers:[],credentials:[],assignments:[entry,{
            id:9, purpose:"node",node_type:"v2box",node_id:node.id,domain:"origin.example.test",family:"ipv4",enabled:true,managed:true,
            entry_id:entry.id,entry_port:candidate.port,published_domain:published ? candidate.host : node.host,
            published_port:published ? candidate.port : node.port,relay_cutover:published ? null : candidate}]};
        if (path.endsWith("/domains/activate") && request.method()==="POST") {
            submissions.push(request.postDataJSON());
            published=true;
            return true;
        }
        if (path.endsWith("/group/fetch") || path.endsWith("/route/fetch")) return [];
        if (path.startsWith("/api/v1/test-admin/")) return {};
    });
    await page.goto(`${consoleOrigin}/admin.html#/nodes`);
    await page.getByRole("row").filter({hasText:node.name}).getByRole("button",{name:"编辑",exact:true}).click();
    await page.getByRole("button",{name:"部署与状态"}).click();
    await expect(page.getByText("服务运行正常",{exact:true})).toBeVisible();
    await expect(page.getByRole("region",{name:"本次部署"})).toContainText("等待执行部署命令");
    await page.getByRole("button",{name:"验证新入口"}).click();
    const review=page.getByRole("region",{name:"验证候选入口"});
    await expect(review).toContainText("live.example.test:443");
    const publish=review.getByRole("button",{name:"确认并切换订阅入口"});
    await expect(publish).toBeDisabled();
    await review.getByRole("checkbox").check();
    page.once("dialog", dialog=>dialog.dismiss());
    await publish.click();
    expect(submissions).toEqual([]);
    page.once("dialog", dialog=>dialog.accept());
    await publish.click();
    await expect(review).toHaveCount(0);
    expect(submissions).toEqual([{id:9,confirm:true,clientTested:true,relayProof:candidate.proof}]);
    await expect(page.getByRole("region",{name:"地址与证书概览"})).toContainText("next.example.test:7443");
});

test("mobile admin plan workspace opens a focused credit package editor", async ({ page, context }) => {
    const access = { group_id: 1, transfer_enable: 100, show: 1 };
    await consoleFixture(context, "admin", path => {
        if (path === "/api/v1/test-admin/config/fetch") return {};
        if (path === "/api/v1/test-admin/server/group/fetch") return [{ id: 1, name: "测试权限组" }];
        if (path === "/api/v1/test-admin/plan/fetch") return [
            { ...access, id: 1, name: "测试周期商品", month_price: 2000, periodic_remaining_user_count: 0 },
            { ...access, id: 2, name: "测试额度商品", onetime_price: 3500, credit_remaining_user_count: 0 },
            { ...access, id: 3, name: "测试混合商品", month_price: 2000, onetime_price: 3500, periodic_remaining_user_count: 11, credit_remaining_user_count: 3 },
        ];
    });

    await page.goto(`${consoleOrigin}/admin.html#/plans`);
    await expect(page.getByRole("tab", { name: "周期套餐" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("columnheader", { name: "有余量人数", exact: true })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "测试周期商品" }).getByRole("cell", { name: "0 人", exact: true })).toBeVisible();
    const mixedRow = page.getByRole("row").filter({ hasText: "测试混合商品" });
    await expect(mixedRow.getByRole("cell", { name: "11 人", exact: true })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "测试额度商品" })).toHaveCount(0);
    await page.getByRole("tab", { name: "额度包", exact: true }).click();
    await expect(page).toHaveURL(`${consoleOrigin}/admin.html#/plans-credits`);
    await expect(mixedRow.getByText("混合商品", { exact: true })).toBeVisible();
    await expect(mixedRow.getByRole("cell", { name: "3 人", exact: true })).toBeVisible();
    const creditRow = page.getByRole("row").filter({ hasText: "测试额度商品" });
    await expect(creditRow.getByRole("cell", { name: "0 人", exact: true })).toBeVisible();
    await creditRow.getByRole("button", { name: "编辑" }).click();
    const editor = page.getByRole("dialog", { name: "编辑 · 额度包" });
    await expect(editor.getByLabel("额度包名称")).toHaveValue("测试额度商品");
    await expect(editor.getByLabel("额度包价格")).toHaveValue("35");
    await expect(editor.getByLabel("月付")).toHaveCount(0);
    await expectPageWidth(page, 390);
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

test("mobile workspace startup failure keeps its message readable and reload reachable", async ({ page, context }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await consoleFixture(context, "user", () => undefined, { language: "de-DE" });
    await page.route(`${consoleOrigin}/assets/UserWorkspace-*.js`, route => route.abort("failed"));
    await page.goto(`${consoleOrigin}/app#/dashboard`);

    const fallback = page.locator("#root > .panel");
    const heading = fallback.getByRole("heading", { name: "Diese Seite konnte nicht geladen werden" });
    const message = fallback.getByText("Aktion fehlgeschlagen. Laden Sie die Seite neu und versuchen Sie es erneut.");
    const reload = fallback.getByRole("button", { name: "Seite neu laden" });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS("font-size", "16px");
    expect(await heading.evaluate(el => el.getBoundingClientRect().height > parseFloat(getComputedStyle(el).lineHeight) + 1)).toBe(true);
    await expect(message).toBeVisible();
    await expect(message).toHaveCSS("font-size", "14px");
    await expect(reload).toBeVisible();
    expect((await reload.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expectPageWidth(page, 320);
});
