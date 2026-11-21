import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("repackages one frontend from a staged manifest and preserves the other deployment", () => {
    const root = mkdtempSync(join(tmpdir(), "fastai-package-test-"));
    const frontend = join(root, "frontend");
    const source = join(root, "public", "console");
    const dist = join(frontend, "dist");
    const script = join(frontend, "scripts", "package-frontends.mjs");
    function write(file, content) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
    }
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
