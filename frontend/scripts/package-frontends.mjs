import {
    copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
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

function writeReport(directory, report) {
    writeFileSync(resolve(directory, "build-metrics.json"), JSON.stringify(report, null, 2) + "\n");
}

export function packageFrontends(modes = ["user", "admin"], source = defaultConsoleRoot) {
    const selected = new Set(modes);
    for (const mode of selected) {
        if (mode !== "user" && mode !== "admin") throw new Error(`Unknown frontend: ${mode}`);
    }
    source = resolve(source);
    const manifest = JSON.parse(readFileSync(resolve(source, ".vite/manifest.json"), "utf8"));
    const metrics = buildMetrics(manifest, file => readFileSync(assetPath(source, file)));

    for (const mode of selected) {
        const entry = mode === "user" ? "index.html" : "admin.html";
        const output = resolve(dist, mode);
        const files = manifestFiles(manifest, [entry]);
        files.add(entry);
        const configName = `${mode}-config.json`;
        const publishedConfig = resolve(source, configName);
        const config = existsSync(publishedConfig) ? publishedConfig : resolve(output, configName);

        // Stage a complete replacement before removing anything from the local package.
        mkdirSync(dist, { recursive: true });
        const stage = mkdtempSync(resolve(dist, `.${mode}-`));
        const previous = stage + ".previous";
        try {
            for (const file of files) {
                const target = assetPath(stage, file === entry ? "index.html" : file);
                mkdirSync(dirname(target), { recursive: true });
                copyFileSync(assetPath(source, file), target);
            }
            if (existsSync(config)) copyFileSync(config, resolve(stage, configName));
            writeReport(stage, metricsReport(metrics.modes.filter(result => result.mode === mode)));
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

    writeReport(source, metrics);
    for (const warning of metrics.warnings) console.warn(warning);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const modes = process.argv.slice(2);
    packageFrontends(modes.length ? modes : undefined);
}
