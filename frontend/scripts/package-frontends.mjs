import {
    copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMetrics, manifestFiles, metricsReport } from "./build-metrics.mjs";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const defaultConsoleRoot = resolve(frontend, "../public/console");
const dist = resolve(frontend, "dist");

function assetPath(directory, file) {
    const path = resolve(directory, file);
    if (!path.startsWith(directory + sep)) throw new Error(`Invalid asset path: ${file}`);
    return path;
}

function reportBytes(report) {
    return Buffer.from(JSON.stringify(report, null, 2) + "\n");
}

function packageFilesMatch(directory, files, report, managedRoots) {
    if (!existsSync(directory) || !lstatSync(directory).isDirectory()) return false;
    const remaining = new Set([...files.keys(), "build-metrics.json"]);
    function matches(relative) {
        for (const entry of readdirSync(resolve(directory, relative), { withFileTypes: true })) {
            if (!relative && !managedRoots.has(entry.name)) continue;
            const name = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (!matches(name)) return false;
                continue;
            }
            if (!entry.isFile() || !remaining.delete(name)) return false;
            const reference = files.get(name);
            const current = resolve(directory, name);
            // A locally exported runtime config is kept in place until the operator changes it.
            if (reference === current) continue;
            const expected = name === "build-metrics.json" ? report : readFileSync(reference);
            if (!expected.equals(readFileSync(current))) return false;
        }
        return true;
    }
    return matches("") && remaining.size === 0;
}

export function packageFrontends(modes = ["user", "admin"], source = defaultConsoleRoot, { reuseCurrent = false, verifiedMetrics } = {}) {
    const selected = new Set(modes);
    for (const mode of selected) {
        if (mode !== "user" && mode !== "admin") throw new Error(`Unknown frontend: ${mode}`);
    }
    source = resolve(source);
    const manifest = JSON.parse(readFileSync(resolve(source, ".vite/manifest.json"), "utf8"));
    const metrics = verifiedMetrics ?? buildMetrics(manifest, file => readFileSync(assetPath(source, file)));

    for (const mode of selected) {
        const entry = mode === "user" ? "index.html" : "admin.html";
        const output = resolve(dist, mode);
        const assets = manifestFiles(manifest, [entry]);
        const files = new Map([...assets].map(file => [file, assetPath(source, file)]));
        files.set("index.html", resolve(source, entry));
        const configName = `${mode}-config.json`;
        const publishedConfig = resolve(source, configName);
        const config = existsSync(publishedConfig) ? publishedConfig : resolve(output, configName);
        if (existsSync(config)) files.set(configName, config);
        const report = reportBytes(metricsReport(metrics.modes.filter(result => result.mode === mode)));
        const managedRoots = new Set(["assets", "admin.html", "admin-config.json", "user-config.json", "build-metrics.json"]);
        for (const file of files.keys()) managedRoots.add(file.split("/")[0]);
        if (reuseCurrent && packageFilesMatch(output, files, report, managedRoots)) continue;

        // Stage a complete replacement before removing anything from the local package.
        mkdirSync(dist, { recursive: true });
        const stage = mkdtempSync(resolve(dist, `.${mode}-`));
        const previous = stage + ".previous";
        try {
            // An automatic package refresh preserves hosting files such as _headers and .well-known.
            if (reuseCurrent && existsSync(output) && lstatSync(output).isDirectory()) {
                for (const name of readdirSync(output)) {
                    if (!managedRoots.has(name)) {
                        cpSync(resolve(output, name), resolve(stage, name), { recursive: true, verbatimSymlinks: true });
                    }
                }
            }
            for (const [file, reference] of files) {
                const target = assetPath(stage, file);
                mkdirSync(dirname(target), { recursive: true });
                copyFileSync(reference, target);
            }
            writeFileSync(resolve(stage, "build-metrics.json"), report);
            if (existsSync(output)) renameSync(output, previous);
            try {
                renameSync(stage, output);
            } catch (error) {
                if (existsSync(previous)) renameSync(previous, output);
                throw error;
            }
            rmSync(previous, { recursive: true, force: true });
        } finally {
            rmSync(stage, { recursive: true, force: true });
        }
        console.log(`Packaged ${mode}: ${files.size} files → dist/${mode}`);
    }

    if (!verifiedMetrics) writeFileSync(resolve(source, "build-metrics.json"), reportBytes(metrics));
    for (const warning of metrics.warnings) console.warn(warning);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const modes = process.argv.slice(2);
    packageFrontends(modes.length ? modes : undefined);
}
