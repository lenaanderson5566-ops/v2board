import { createHash } from "node:crypto";
import {
    cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
    readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageFrontends } from "./package-frontends.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const frontend = resolve(root, "frontend");
const output = resolve(root, "public/console");
const provenance = "build-provenance.json";
const manifestFile = ".vite/manifest.json";
const entries = { user: "index.html", admin: "admin.html" };
const modes = Object.keys(entries);
const runtimeFiles = modes.map(mode => `${mode}-config.json`);
const sharedInputs = [
    "frontend/package.json",
    "frontend/package-lock.json",
    "frontend/tsconfig.json",
    "frontend/vite.config.ts",
    "frontend/build-isolation.ts",
    "frontend/locale-startup.ts",
    "frontend/scripts",
    "frontend/src",
    "public/payment-icons",
    "resources/client/anytls-padding-presets.json",
    "resources/client/node-countries.json",
    "resources/client/node-locations.json",
    "resources/client/node-route-presets.json",
    "resources/payment-catalog.json",
];
const textExtensions = new Set([
    ".css", ".html", ".js", ".json", ".md", ".mjs", ".svg", ".ts", ".tsx", ".txt",
]);

function filesUnder(directory, path, exclude) {
    if (exclude(path)) return [];
    const filename = resolve(directory, path);
    const stat = lstatSync(filename);
    if (stat.isFile()) return [path];
    if (!stat.isDirectory()) throw new Error(`Unexpected build path: ${path}`);
    return readdirSync(filename).flatMap(name =>
        filesUnder(directory, path ? `${path}/${name}` : name, exclude),
    );
}

function digest(directory, paths) {
    const hash = createHash("sha256");
    for (const path of paths.sort()) {
        const bytes = readFileSync(resolve(directory, path));
        // Git checkouts may use LF or CRLF; binary assets are always hashed verbatim.
        const content = textExtensions.has(extname(path))
            ? bytes.toString("utf8").replace(/\r\n/g, "\n")
            : bytes;
        hash.update(`${path}\0${createHash("sha256").update(content).digest("hex")}\n`);
    }
    return hash.digest("hex");
}

function inputDigests() {
    const roots = existsSync(resolve(frontend, "public")) ? [...sharedInputs, "frontend/public"] : sharedInputs;
    const files = roots.flatMap(path => filesUnder(root, path, candidate =>
        /\.(?:test|spec)\.[^.]+$/.test(candidate) || candidate.split("/").includes("test-support"),
    ));
    return Object.fromEntries(modes.map(mode => {
        const other = mode === "user" ? "admin" : "user";
        const ownFiles = files.filter(file => !file.startsWith(`frontend/src/${other}/`));
        return [mode, digest(root, [...ownFiles, `frontend/${entries[mode]}`])];
    }));
}

function outputDigest(directory) {
    const excluded = new Set([provenance, ...runtimeFiles]);
    return digest(directory, filesUnder(directory, "", path => excluded.has(path)));
}

function readJson(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}

function buildRecord() {
    const path = resolve(output, provenance);
    if (!existsSync(path)) return null;
    let record;
    try {
        record = readJson(path);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return null;
    }
    return record?.version === 2 && record.defaultEnvironment === true &&
        modes.every(mode => typeof record.inputSha256?.[mode] === "string") ? record : null;
}

function manifestFor(manifest, mode) {
    return Object.fromEntries(Object.entries(manifest).filter(([key]) =>
        (key === entries.admin || key.startsWith("admin:")) === (mode === "admin"),
    ));
}

function prefixAdminManifest(manifest) {
    // Each Vite build uses source paths as keys, including shared modules.
    // Laravel still reads the two HTML entry keys in a single manifest.
    const adminKey = key => key === entries.admin ? key : `admin:${key}`;
    return Object.fromEntries(Object.entries(manifest).map(([key, entry]) => [adminKey(key), {
        ...entry,
        ...(entry.imports ? { imports: entry.imports.map(adminKey) } : {}),
        ...(entry.dynamicImports ? { dynamicImports: entry.dynamicImports.map(adminKey) } : {}),
    }]));
}

function copyFile(from, to) {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { preserveTimestamps: true });
}

function copySurface(from, to, mode) {
    copyFile(resolve(from, entries[mode]), resolve(to, entries[mode]));
    mkdirSync(resolve(to, "assets"), { recursive: true });
    cpSync(resolve(from, "assets", mode), resolve(to, "assets", mode), {
        recursive: true, preserveTimestamps: true,
    });
}

function copyPublicFiles(to) {
    const directory = resolve(frontend, "public");
    if (!existsSync(directory)) return;
    for (const file of filesUnder(directory, "", () => false)) {
        if (file.startsWith(".vite/") || file.startsWith("assets/user/") || file.startsWith("assets/admin/") ||
            [provenance, "build-metrics.json", ...Object.values(entries), ...runtimeFiles].includes(file)) {
            throw new Error(`Reserved console public path: ${file}`);
        }
        copyFile(resolve(directory, file), resolve(to, file));
    }
}

function publish(staged, previous) {
    const hadOutput = existsSync(output);
    if (hadOutput) renameSync(output, previous);
    try {
        renameSync(staged, output);
    } catch (error) {
        if (hadOutput) renameSync(previous, output);
        throw error;
    }
}

const option = process.argv[2];
if (process.argv.length > 3 || (option && !["--verify", "--force"].includes(option))) {
    throw new Error("Usage: node scripts/build-console.mjs [--verify | --force]");
}
const inputSha256 = inputDigests();
const record = buildRecord();
const verifiedOutput = record && record.outputSha256 === outputDigest(output);
if (option === "--verify") {
    if (!record || modes.some(mode => record.inputSha256[mode] !== inputSha256[mode])) {
        throw new Error("Committed console build is stale or uses a custom build environment. Run npm run build with default Vite settings and include public/console in the release.");
    }
    if (!verifiedOutput) {
        throw new Error("Committed console files differ from the recorded build. Include the complete public/console output in the release.");
    }
    console.log("Verified committed console input and output fingerprints.");
} else {
    const locallyConfigured = Object.keys(process.env).some(key => key.startsWith("VITE_")) ||
        (process.env.NODE_ENV && process.env.NODE_ENV !== "production") ||
        [".env", ".env.local", ".env.production", ".env.production.local"]
            .some(file => existsSync(resolve(frontend, file)));
    const changed = modes.filter(mode => option === "--force" || locallyConfigured || !verifiedOutput ||
        record.inputSha256[mode] !== inputSha256[mode]);
    const missingPackages = modes.filter(mode => !existsSync(resolve(frontend, "dist", mode, "index.html")));
    if (!changed.length) {
        if (missingPackages.length) packageFrontends(missingPackages);
        console.log("Console inputs are unchanged. Reused user and admin builds.");
    } else {
        const cache = resolve(frontend, "node_modules/.cache");
        mkdirSync(cache, { recursive: true });
        const temporary = mkdtempSync(resolve(cache, "console-build-"));
        const staged = resolve(temporary, "release");
        const previous = resolve(temporary, "previous");
        let published = false;
        let defaultEnvironment = true;
        const manifest = verifiedOutput ? readJson(resolve(output, manifestFile)) : {};
        try {
            const { build } = await import("vite");
            const graphs = {};
            for (const mode of modes) {
                if (!changed.includes(mode)) {
                    console.log(`Reusing ${mode} console build.`);
                    copySurface(output, staged, mode);
                    graphs[mode] = manifestFor(manifest, mode);
                    continue;
                }
                console.log(`Building ${mode} console.`);
                const outDir = resolve(temporary, mode);
                await build({
                    root: frontend,
                    build: {
                        outDir, assetsDir: `assets/${mode}`, copyPublicDir: false,
                        rollupOptions: { input: resolve(frontend, entries[mode]) },
                    },
                    plugins: [{
                        name: "fastai-console-build-environment",
                        configResolved(config) {
                            defaultEnvironment &&= config.isProduction && config.mode === "production" &&
                                !Object.entries(config.env).some(([key, value]) => key.startsWith("VITE_") && value !== "");
                        },
                    }],
                });
                copySurface(outDir, staged, mode);
                const graph = readJson(resolve(outDir, manifestFile));
                graphs[mode] = mode === "admin" ? prefixAdminManifest(graph) : graph;
            }
            copyPublicFiles(staged);
            for (const file of runtimeFiles) {
                const existing = resolve(output, file);
                if (existsSync(existing)) copyFile(existing, resolve(staged, file));
            }
            const manifestPath = resolve(staged, manifestFile);
            mkdirSync(dirname(manifestPath), { recursive: true });
            writeFileSync(manifestPath, `${JSON.stringify({ ...graphs.user, ...graphs.admin }, null, 2)}\n`);
            const current = inputDigests();
            if (modes.some(mode => current[mode] !== inputSha256[mode])) {
                throw new Error("Console inputs changed during the build. Rebuild after edits finish.");
            }
            if (verifiedOutput && record.outputSha256 !== outputDigest(output)) {
                throw new Error("Console output changed during the build. Retry when the other build finishes.");
            }
            packageFrontends(modes.filter(mode => changed.includes(mode) || missingPackages.includes(mode)), staged);
            const next = { version: 2, defaultEnvironment, inputSha256, outputSha256: outputDigest(staged) };
            writeFileSync(resolve(staged, provenance), `${JSON.stringify(next, null, 2)}\n`);
            publish(staged, previous);
            published = true;
        } finally {
            if (published || !existsSync(previous)) {
                try {
                    rmSync(temporary, { recursive: true, force: true, maxRetries: 3 });
                } catch (error) {
                    console.warn(`Could not remove temporary console build: ${error.message}`);
                }
            } else {
                console.error(`Previous console files retained at ${previous}`);
            }
        }
    }
}
