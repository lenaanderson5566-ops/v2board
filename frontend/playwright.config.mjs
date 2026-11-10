import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
    testDir: "./browser-tests",
    testMatch: "**/*.browser.mjs",
    outputDir: fileURLToPath(new URL("../storage/app/test-organization/browser-results/", import.meta.url)),
    workers: 1,
    use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: "zh-CN",
        serviceWorkers: "block",
        launchOptions: { executablePath: process.env.FASTAI_TEST_CHROMIUM || undefined },
    },
});
