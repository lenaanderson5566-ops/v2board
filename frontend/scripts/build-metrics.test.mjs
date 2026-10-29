import { expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { buildMetrics } from "./build-metrics.mjs";

it("deduplicates shared and cyclic imports and excludes lazy pages from startup", () => {
    const manifest = {
        "index.html": { file: "user.js", dynamicImports: ["shell"] },
        "admin.html": { file: "admin.js", dynamicImports: ["shell"] },
        shell: {
            file: "shell.js",
            imports: ["shared"],
            dynamicImports: ["page"],
            css: ["shared.css"],
        },
        shared: { file: "shared.js", imports: ["shell"], css: ["shared.css"] },
        page: { file: "page.js" },
    };
    const content = Buffer.from("fixture");
    const report = buildMetrics(manifest, () => content);
    expect(report.modes[0].fileCount).toBe(5);
    expect(report.modes[0].totalBytes).toBe(5 * content.length);
    expect(report.modes[0].startupGzipBytes).toBe(4 * gzipSync(content).length);
    expect(report.modes[0].startupBytes).toBe(4 * content.length);
    expect(report.modes[0].startupFileCount).toBe(4);
    expect(report.modes[0].largestStartupAssets).toHaveLength(4);
    expect(report.modes[0].largestStartupAssets.map((asset) => asset.file).sort())
        .toEqual(["user.js", "shell.js", "shared.js", "shared.css"].sort());
    expect(report.modes[0].largestStartupAssets.every((asset) => asset.bytes === content.length && asset.gzipBytes === gzipSync(content).length)).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(() =>
        buildMetrics(
            { ...manifest, shell: { file: "shell.js", imports: ["missing"] } },
            () => content,
        ),
    ).toThrow("Missing manifest");
});
it("ranks the largest startup resources without counting a lazy-only asset", () => {
    const manifest = {
        "index.html": { file: "user.js", imports: ["heavy"], dynamicImports: ["shell"] },
        "admin.html": { file: "admin.js", imports: ["heavy"] },
        heavy: { file: "heavy.js" },
        shell: { file: "shell.js", dynamicImports: ["lazy"] },
        lazy: { file: "lazy.js" },
    };
    const heavy = Buffer.from(Array.from({ length: 2048 }, (_, index) => index % 251));
    const report = buildMetrics(manifest, (file) => file === "heavy.js" || file === "lazy.js" ? heavy : Buffer.from("small"));
    expect(report.modes[0].largestStartupAssets[0].file).toBe("heavy.js");
    expect(report.modes[0].largestStartupAssets[0].bytes).toBe(heavy.length);
    expect(report.modes[0].largestStartupAssets.some((asset) => asset.file === "lazy.js")).toBe(false);
    expect(report.modes[0].startupFileCount).toBe(3);
    expect(report.modes[0].fileCount).toBe(4);
});
