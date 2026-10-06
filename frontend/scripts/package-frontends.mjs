import {
    readFileSync,
    writeFileSync,
    existsSync,
    mkdirSync,
    rmSync,
    copyFileSync,
} from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(frontend, "../public/console");
const dist = resolve(frontend, "dist");
const manifest = JSON.parse(
    readFileSync(resolve(source, ".vite/manifest.json"), "utf8"),
);
for (const [mode, entry] of [
    ["user", "index.html"],
    ["admin", "admin.html"],
]) {
    const output = resolve(dist, mode);
    if (!output.startsWith(dist + sep))
        throw new Error("Invalid frontend output directory");
    const configName = `${mode}-config.json`;
    const configPath = existsSync(resolve(source, configName))
        ? resolve(source, configName)
        : resolve(output, configName);
    const runtime = existsSync(configPath) ? readFileSync(configPath) : null;
    rmSync(output, { recursive: true, force: true });
    mkdirSync(output, { recursive: true });
    const seen = new Set();
    const files = new Set([entry]);
    function visit(key) {
        if (seen.has(key)) return;
        seen.add(key);
        const item = manifest[key];
        if (!item) throw new Error(`Missing manifest resource ${key}`);
        [item.file, ...(item.css || []), ...(item.assets || [])].forEach(
            (file) => files.add(file),
        );
        [...(item.imports || []), ...(item.dynamicImports || [])].forEach(
            visit,
        );
    }
    visit(entry);
    for (const file of files) {
        const input = resolve(source, file);
        const target = resolve(output, file === entry ? "index.html" : file);
        if (!input.startsWith(source + sep) || !target.startsWith(output + sep))
            throw new Error("Invalid asset path");
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(input, target);
    }
    if (runtime) writeFileSync(resolve(output, configName), runtime);
    console.log(`Packaged ${mode}: ${files.size} files → dist/${mode}`);
}
