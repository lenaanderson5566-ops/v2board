import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = resolve(root, "public/console");
const provenance = "build-provenance.json";
const inputs = [
    "frontend/admin.html",
    "frontend/index.html",
    "frontend/package.json",
    "frontend/package-lock.json",
    "frontend/tsconfig.json",
    "frontend/vite.config.ts",
    "frontend/build-isolation.ts",
    "frontend/locale-startup.ts",
    "frontend/scripts/build-console.mjs",
    "frontend/scripts/package-frontends.mjs",
    "frontend/scripts/build-metrics.mjs",
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

function inputDigest() {
    const roots = existsSync(resolve(root, "frontend/public")) ? [...inputs, "frontend/public"] : inputs;
    return digest(root, roots.flatMap(path => filesUnder(root, path, candidate =>
        candidate.startsWith("frontend/src/") &&
        (/\.(?:test|spec)\.[^.]+$/.test(candidate) || candidate.split("/").includes("test-support")),
    )));
}

function outputDigest() {
    const excluded = new Set([provenance, "user-config.json", "admin-config.json"]);
    return digest(output, filesUnder(output, "", path => excluded.has(path)));
}

const mode = process.argv[2];
if (process.argv.length > 3 || (mode && mode !== "--verify")) {
    throw new Error("Usage: node scripts/build-console.mjs [--verify]");
}
if (mode === "--verify") {
    const recordPath = resolve(output, provenance);
    if (!existsSync(recordPath)) throw new Error("Missing committed console build metadata. Run npm run build and include public/console in the release.");
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    if (record.version !== 1 || !record.defaultEnvironment || record.inputSha256 !== inputDigest()) {
        throw new Error("Committed console build is stale or uses a custom build environment. Run npm run build with default Vite settings and include public/console in the release.");
    }
    if (record.outputSha256 !== outputDigest()) {
        throw new Error("Committed console files differ from the recorded build. Include the complete public/console output in the release.");
    }
    console.log("Verified committed console input and output fingerprints.");
} else {
    const inputSha256 = inputDigest();
    let defaultEnvironment = false;
    const { build } = await import("vite");
    await build({
        root: resolve(root, "frontend"),
        plugins: [{
            name: "fastai-console-build-environment",
            configResolved(config) {
                defaultEnvironment = config.isProduction && config.mode === "production" &&
                    !Object.entries(config.env).some(([key, value]) => key.startsWith("VITE_") && value !== "");
            },
        }],
    });
    await import("./package-frontends.mjs");
    if (inputSha256 !== inputDigest()) throw new Error("Console inputs changed during the build. Rebuild after edits finish.");
    const record = { version: 1, defaultEnvironment, inputSha256, outputSha256: outputDigest() };
    writeFileSync(resolve(output, provenance), `${JSON.stringify(record, null, 2)}\n`);
}
