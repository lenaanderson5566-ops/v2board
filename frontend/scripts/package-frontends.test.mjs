import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

function write(file, content) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
}

it("repackages one frontend from a staged manifest and preserves the other deployment", () => {
    const root = mkdtempSync(join(tmpdir(), "fastai-package-test-"));
    const frontend = join(root, "frontend");
    const source = join(root, "public", "console");
    const dist = join(frontend, "dist");
    const script = join(frontend, "scripts", "package-frontends.mjs");
    const report = directory => JSON.parse(readFileSync(join(directory, "build-metrics.json"), "utf8"));
    try {
        mkdirSync(dirname(script), { recursive: true });
        for (const name of ["package-frontends.mjs", "build-metrics.mjs"]) {
            copyFileSync(new URL(name, import.meta.url), join(dirname(script), name));
        }
        const manifest = {
            "index.html": { file: "assets/user/start.js", dynamicImports: ["shared"] },
            shared: { file: "assets/user/shared.js" },
            "admin.html": { file: "assets/admin/start.js", dynamicImports: ["admin:shared"] },
            "admin:shared": { file: "assets/admin/shared.js", css: ["assets/admin/style.css"] },
        };
        write(join(source, ".vite", "manifest.json"), JSON.stringify(manifest));
        for (const file of ["index.html", "admin.html", "assets/user/start.js", "assets/user/shared.js",
            "assets/admin/start.js", "assets/admin/shared.js", "assets/admin/style.css"]) {
            write(join(source, file), file);
        }
        write(join(dist, "admin", "admin-config.json"), "local admin config");
        write(join(source, "user-config.json"), "user config");
        execFileSync(process.execPath, [script]);
        const user = join(dist, "user");
        const admin = join(dist, "admin");
        const userReport = report(user);
        expect(report(source).modes.map(item => item.mode)).toEqual(["user", "admin"]);
        expect(userReport.modes.map(item => item.mode)).toEqual(["user"]);
        expect(report(admin).modes.map(item => item.mode)).toEqual(["admin"]);
        expect(readFileSync(join(user, "user-config.json"), "utf8")).toBe("user config");
        expect(existsSync(join(user, "assets", "admin"))).toBe(false);
        expect(existsSync(join(admin, "assets", "user"))).toBe(false);

        const stage = join(root, "stage");
        renameSync(source, stage);
        write(join(user, "untouched.txt"), "keep");
        manifest["admin:shared"].file = "assets/admin/new.js";
        write(join(stage, ".vite", "manifest.json"), JSON.stringify(manifest));
        write(join(stage, "assets", "admin", "new.js"), "new backend");
        const scoped = `import { packageFrontends } from ${JSON.stringify(pathToFileURL(script).href)}; packageFrontends(["admin"], process.argv[1]);`;
        execFileSync(process.execPath, ["--input-type=module", "-e", scoped, stage]);
        expect(existsSync(source)).toBe(false);
        expect(readFileSync(join(user, "untouched.txt"), "utf8")).toBe("keep");
        expect(report(user)).toEqual(userReport);
        expect(report(stage).modes[1]).toEqual(report(admin).modes[0]);
        expect(readFileSync(join(admin, "admin-config.json"), "utf8")).toBe("local admin config");
        expect(readFileSync(join(admin, "assets", "admin", "new.js"), "utf8")).toBe("new backend");
        expect(existsSync(join(admin, "assets", "admin", "shared.js"))).toBe(false);

        rmSync(join(stage, "admin.html"));
        expect(() => execFileSync(process.execPath, ["--input-type=module", "-e", scoped, stage], { stdio: "pipe" })).toThrow();
        expect(readFileSync(join(admin, "index.html"), "utf8")).toBe("admin.html");
        expect(readFileSync(join(admin, "admin-config.json"), "utf8")).toBe("local admin config");
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

it("repairs standalone packages from current assets and rebuilds only affected frontends", () => {
    // Node resolves the installed Vite from the parent frontend. All outputs live in the fixture.
    const cache = fileURLToPath(new URL("../node_modules/.cache/", import.meta.url));
    mkdirSync(cache, { recursive: true });
    const root = mkdtempSync(join(cache, "fastai-build-test-"));
    const frontend = join(root, "frontend");
    const consoleRoot = join(root, "public", "console");
    const dist = join(frontend, "dist");
    const script = join(frontend, "scripts", "build-console.mjs");
    const env = { ...process.env, NODE_ENV: "production" };
    for (const key of Object.keys(env)) if (key.startsWith("VITE_")) delete env[key];
    const build = () => execFileSync(process.execPath, [script], { cwd: frontend, env, encoding: "utf8" });
    const record = () => JSON.parse(readFileSync(join(consoleRoot, "build-provenance.json"), "utf8"));
    const userEntry = join(dist, "user", "index.html");
    try {
        mkdirSync(dirname(script), { recursive: true });
        for (const name of ["build-console.mjs", "package-frontends.mjs", "build-metrics.mjs"]) {
            copyFileSync(new URL(name, import.meta.url), join(dirname(script), name));
        }
        write(join(frontend, "package.json"), '{"type":"module"}');
        for (const name of ["package-lock.json", "tsconfig.json"]) write(join(frontend, name), "{}");
        for (const name of ["locale-startup.ts", "build-isolation.ts"]) write(join(frontend, name), "");
        write(join(frontend, "vite.config.ts"), 'export default { base: "./", build: { manifest: true } };');
        write(join(root, "public/payment-icons/card.svg"), "<svg/>");
        write(join(root, "resources/payment-catalog.json"), "{}");
        for (const name of ["anytls-padding-presets", "node-countries", "node-locations", "node-route-presets"]) {
            write(join(root, `resources/client/${name}.json`), '["original"]');
        }
        for (const [mode, entry] of [["user", "index.html"], ["admin", "admin.html"]]) {
            write(join(frontend, entry), `<script type="module" src="/src/${mode}/main.ts"></script>`);
            const data = mode === "admin" ? 'import data from "../../../resources/client/node-locations.json";' : 'const data = ["user"];';
            write(join(frontend, `src/${mode}/main.ts`), `${data} import { text } from "../shared"; document.body.textContent = text + data;`);
        }
        const shared = join(frontend, "src/shared.ts");
        write(shared, 'export const text = "shared";');
        build();
        const original = record();
        const userHtml = readFileSync(userEntry);
        const userAssets = join(consoleRoot, "assets/user");
        const snapshot = () => readdirSync(userAssets).sort().map(name => [name, readFileSync(join(userAssets, name))]);
        const originalAssets = snapshot();
        write(join(dist, "user/_headers"), "user hosting headers");
        utimesSync(userEntry, 1000000000, 1000000000);
        const userMtime = statSync(userEntry).mtimeMs;

        write(join(root, "resources/client/node-locations.json"), '["revised"]');
        const adminBuild = build();
        expect(adminBuild).toContain("Building admin console.");
        expect(adminBuild).toContain("Reusing user console build.");
        expect(adminBuild).not.toContain("Packaged user:");
        expect(record().inputSha256.user).toBe(original.inputSha256.user);
        expect(record().inputSha256.admin).not.toBe(original.inputSha256.admin);
        expect(readFileSync(userEntry)).toEqual(userHtml);
        expect(snapshot()).toEqual(originalAssets);
        expect(statSync(userEntry).mtimeMs).toBe(userMtime);

        const admin = join(dist, "admin");
        const adminAsset = join("assets/admin", readdirSync(join(admin, "assets/admin"))[0]);
        const config = join(admin, "admin-config.json");
        write(config, "site runtime config");
        write(join(admin, ".well-known/hosting"), "site rule");
        write(join(admin, "user-config.json"), "config from a different package");
        write(join(admin, "index.html"), "previous release");
        const repairedEntry = build();
        expect(repairedEntry).not.toContain("Building ");
        expect(repairedEntry).toContain("Packaged admin:");
        expect(readFileSync(join(admin, "index.html"))).toEqual(readFileSync(join(consoleRoot, "admin.html")));
        rmSync(join(admin, adminAsset));
        write(join(admin, "assets/admin/retired.js"), "old chunk");
        expect(build()).toContain("Packaged admin:");
        expect(readFileSync(join(admin, adminAsset))).toEqual(readFileSync(join(consoleRoot, adminAsset)));
        expect(existsSync(join(admin, "assets/admin/retired.js"))).toBe(false);
        write(join(admin, adminAsset), Buffer.alloc(statSync(join(admin, adminAsset)).size));
        expect(build()).toContain("Packaged admin:");
        expect(readFileSync(join(admin, adminAsset))).toEqual(readFileSync(join(consoleRoot, adminAsset)));
        expect(readFileSync(config, "utf8")).toBe("site runtime config");
        expect(readFileSync(join(admin, ".well-known/hosting"), "utf8")).toBe("site rule");
        expect(existsSync(join(admin, "user-config.json"))).toBe(false);
        expect(readFileSync(join(dist, "user/_headers"), "utf8")).toBe("user hosting headers");
        expect(statSync(userEntry).mtimeMs).toBe(userMtime);
        expect(build()).not.toContain("Packaged ");

        write(shared, 'export const text = "updated";');
        const sharedBuild = build();
        expect(sharedBuild).toContain("Building user console.");
        expect(sharedBuild).toContain("Building admin console.");
        expect(record().inputSha256.user).not.toBe(original.inputSha256.user);

        write(join(root, "public/payment-icons/card.svg"), '<svg width="10"/>');
        const iconBuild = build();
        expect(iconBuild).toContain("Building user console.");
        expect(iconBuild).toContain("Building admin console.");
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 30000);
