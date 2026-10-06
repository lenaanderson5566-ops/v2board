import type { Plugin } from "vite";

export function userBundleIsolation(): Plugin {
    return {
        name: "user-bundle-isolation",
        generateBundle(_, bundle) {
            const chunks = Object.values(bundle).filter(
                (item) => item.type === "chunk",
            );
            const entry = chunks.find(
                (chunk) =>
                    chunk.isEntry &&
                    chunk.facadeModuleId
                        ?.replace(/\\/g, "/")
                        .endsWith("/src/main.tsx"),
            );
            if (!entry)
                this.error("Missing user entry for bundle isolation check");
            const sourceSeen = new Set<string>();
            const visitSource = (id: string) => {
                if (sourceSeen.has(id)) return;
                sourceSeen.add(id);
                if (
                    /\/src\/(?:admin[\w.-]*|Admin[\w.-]*)\.(?:tsx?|css|json)(?:\?|$)/.test(
                        id.replace(/\\/g, "/"),
                    )
                ) {
                    this.error(
                        "Backend source entered the user load graph: " + id,
                    );
                }
                const info = this.getModuleInfo(id);
                info?.importedIds.forEach(visitSource);
                for (const target of info?.dynamicallyImportedIds || []) {
                    const adminOnly =
                        id === entry.facadeModuleId &&
                        /\/src\/(admin-workspace\.tsx|admin-legacy\.css)(?:\?|$)/.test(
                            target.replace(/\\/g, "/"),
                        );
                    if (!adminOnly) visitSource(target);
                }
            };
            visitSource(entry.facadeModuleId!);
            const seen = new Set<string>();
            const visit = (name: string) => {
                if (seen.has(name)) return;
                seen.add(name);
                const chunk = bundle[name];
                if (!chunk || chunk.type !== "chunk") return;
                const modules = Object.keys(chunk.modules).map((id) =>
                    id.replace(/\\/g, "/"),
                );
                const forbidden = modules.filter((id) =>
                    /\/src\/(?:admin[\w.-]*|Admin[\w.-]*)\.(?:tsx?|css|json)(?:\?|$)/.test(
                        id,
                    ),
                );
                if (forbidden.length)
                    this.error(
                        "Backend modules entered the user load graph: " +
                            forbidden.join(", "),
                    );
                chunk.imports.forEach(visit);
                for (const target of chunk.dynamicImports) {
                    const next = bundle[target];
                    const ids =
                        next?.type === "chunk"
                            ? Object.keys(next.modules).map((id) =>
                                  id.replace(/\\/g, "/"),
                              )
                            : [];
                    const adminOnly =
                        chunk === entry &&
                        ids.some((id) =>
                            /\/src\/(admin-workspace\.tsx|admin-legacy\.css)(?:\?|$)/.test(
                                id,
                            ),
                        );
                    if (!adminOnly) visit(target);
                }
            };
            visit(entry.fileName);
        },
    };
}
