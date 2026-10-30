import { gzipSync } from "node:zlib";

export function buildMetrics(manifest, read) {
    const warnings = [];
    const assets = new Map();
    const asset = (file) => {
        if (!assets.has(file)) {
            const content = read(file);
            assets.set(file, { file, bytes: content.length, gzipBytes: gzipSync(content).length });
        }
        return assets.get(file);
    };
    const modes = [
        ["user", "index.html", 160 * 1024],
        ["admin", "admin.html", 450 * 1024],
    ].map(([mode, entry, budget]) => {
        function collect(roots, dynamic) {
            const seen = new Set(),
                files = new Set();
            function visit(key) {
                if (seen.has(key)) return;
                seen.add(key);
                const item = manifest[key];
                if (!item) throw new Error(`Missing manifest resource ${key}`);
                [
                    item.file,
                    ...(item.css || []),
                    ...(item.assets || []),
                ].forEach((file) => files.add(file));
                [
                    ...(item.imports || []),
                    ...(dynamic ? item.dynamicImports || [] : []),
                ].forEach(visit);
            }
            roots.forEach(visit);
            return files;
        }
        const all = collect([entry], true);
        const startupRoots = [entry, ...(manifest[entry].dynamicImports || [])];
        const startup = collect(startupRoots, false);
        const startupAssets = [...startup].map(asset);
        const startupGzipBytes = startupAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
        const named = name => Object.keys(manifest).filter(key => manifest[key].name === name);
        const workspace = named("UserWorkspace");
        // A smaller gate bundle alone does not describe the first usable page.
        // Count its workspace, page and selected full catalog too, including
        // their static JS/CSS dependencies but excluding unrelated lazy pages
        // and assets that the page may never render.
        const firstViews = mode === "user" && workspace.length ? [
            { view: "browserGuide", language: null, roots: [] },
            ...["zh-CN", "en-US"].flatMap(language => {
                const catalog = Object.keys(manifest).filter(key => key === `src/locales/${language}.json`);
                return [
                    { view: "login", language, roots: [...workspace, ...named("UserAuth"), ...catalog] },
                    { view: "landing", language, roots: [...workspace, ...named("Landing"), ...catalog] },
                ];
            }),
        ].map(({ view, language, roots }) => {
            const files = [...collect([...startupRoots, ...roots], false)]
                .filter(file => /\.(?:js|css)$/.test(file));
            return {
                view, language,
                gzipBytes: files.reduce((sum, file) => sum + asset(file).gzipBytes, 0),
                bytes: files.reduce((sum, file) => sum + asset(file).bytes, 0),
                fileCount: files.length,
            };
        }) : undefined;
        if (startupGzipBytes > budget)
            warnings.push(
                `${mode === "user" ? "用户端" : "管理端"}启动资源超过 gzip 预算 ${budget / 1024} KiB。`,
            );
        return {
            mode,
            startupGzipBytes,
            startupBytes: startupAssets.reduce((sum, asset) => sum + asset.bytes, 0),
            startupFileCount: startup.size,
            largestStartupAssets: startupAssets
                .sort((a, b) => b.gzipBytes - a.gzipBytes || a.file.localeCompare(b.file))
                .slice(0, 5),
            budget,
            ...(firstViews ? { firstViews } : {}),
            totalBytes: [...all].reduce(
                (sum, file) => sum + asset(file).bytes,
                0,
            ),
            fileCount: all.size,
        };
    });
    return { version: 1, modes, warnings };
}
