import { gzipSync } from "node:zlib";

export function buildMetrics(manifest, read) {
    const warnings = [];
    const modes = [
        ["user", "index.html", 300 * 1024],
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
        const startup = collect(
            [entry, ...(manifest[entry].dynamicImports || [])],
            false,
        );
        const startupGzipBytes = [...startup].reduce(
            (sum, file) => sum + gzipSync(read(file)).length,
            0,
        );
        if (startupGzipBytes > budget)
            warnings.push(
                `${mode === "user" ? "用户端" : "管理端"}启动资源超过 gzip 预算 ${budget / 1024} KiB。`,
            );
        return {
            mode,
            startupGzipBytes,
            budget,
            totalBytes: [...all].reduce(
                (sum, file) => sum + read(file).length,
                0,
            ),
            fileCount: all.size,
        };
    });
    return { version: 1, modes, warnings };
}
