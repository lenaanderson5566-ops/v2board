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
    expect(report.warnings).toEqual([]);
    expect(() =>
        buildMetrics(
            { ...manifest, shell: { file: "shell.js", imports: ["missing"] } },
            () => content,
        ),
    ).toThrow("Missing manifest");
});
