import type { Plugin } from "vite";

const normalize = (id: string) => id.replace(/\\/g, "/");
const startupModules = ["/src/user/main.ts", "/src/user/app.tsx", "/src/shared/render-app.tsx"];
const publicViewModules = ["/src/user/UserWorkspace.tsx", "/src/user/Landing.tsx", "/src/user/MinimalLanding.tsx"];
export function publicStartupViolation(id: string): boolean {
    const source = normalize(id).split("?")[0];
    return /\/src\/locales\/[^/]+\.json$/.test(source) || [
        "/src/shared/markdown.ts",
        "/src/shared/ui/Editor.tsx",
        "/src/shared/ui/Table.tsx",
        "/src/shared/style.css",
        "/src/shared/console.css",
        "/src/user/user-experience.css",
        "/src/user/product.css",
    ].some(module => source.endsWith(module));
}
export function loginDependencyViolation(id: string): boolean {
    const source = normalize(id).split("?")[0];
    return source.includes("/node_modules/dompurify/") || [
        "/src/shared/markdown.ts",
        "/src/shared/ui/Editor.tsx",
        "/src/shared/ui/Table.tsx",
        "/src/user/UserStatusGate.tsx",
        "/src/user/WorkspaceHeaderControls.tsx",
        "/src/user/AnnouncementCenter.tsx",
        "/src/user/AccountMenu.tsx",
        "/src/user/InviteCampaign.tsx",
    ].some(module => source.endsWith(module));
}
export function boundaryViolation(from: string, to: string): boolean {
    const source = normalize(from),
        target = normalize(to);
    const backend =
        target.includes("/src/admin/") ||
        target.includes("/public/assets/admin/");
    return (
        (source.includes("/src/shared/") &&
            (backend || target.includes("/src/user/"))) ||
        (source.includes("/src/user/") && backend) ||
        (source.includes("/src/admin/") && target.includes("/src/user/"))
    );
}
export function userBundleIsolation(): Plugin {
    return {
        name: "frontend-boundaries",
        generateBundle(_, bundle) {
            for (const id of this.getModuleIds()) {
                const info = this.getModuleInfo(id);
                for (const target of [
                    ...(info?.importedIds || []),
                    ...(info?.dynamicallyImportedIds || []),
                ]) {
                    if (boundaryViolation(id, target))
                        this.error(
                            "Invalid frontend dependency: " +
                                id +
                                " -> " +
                                target,
                        );
                }
            }
            const entries = Object.values(bundle).filter(
                (item) => item.type === "chunk" && item.isEntry,
            );
            const entry = entries.find(
                (chunk) =>
                    chunk.type === "chunk" &&
                    normalize(chunk.facadeModuleId || "").endsWith(
                        "/index.html",
                    ),
            );
            if (!entry || entry.type !== "chunk")
                this.error("Missing independent user entry");
            const sourceSeen = new Set<string>();
            const source = (id: string) => {
                if (sourceSeen.has(id)) return;
                sourceSeen.add(id);
                if (
                    normalize(id).includes("/src/admin/") ||
                    normalize(id).includes("/public/assets/admin/")
                )
                    this.error("Backend source entered the user graph: " + id);
                const info = this.getModuleInfo(id);
                [
                    ...(info?.importedIds || []),
                    ...(info?.dynamicallyImportedIds || []),
                ].forEach(source);
            };
            source(entry.facadeModuleId!);
            // CSS may be extracted from output chunks, so check the static
            // source graph as well as emitted JavaScript. Full catalogs and
            // business presentation belong behind the public entry gate.
            const startupSeen = new Set<string>();
            const visitStartupSource = (id: string) => {
                if (startupSeen.has(id)) return;
                startupSeen.add(id);
                if (publicStartupViolation(id)) this.error("Heavy dependency entered the public startup: " + id);
                this.getModuleInfo(id)?.importedIds.forEach(visitStartupSource);
            };
            for (const id of this.getModuleIds()) {
                if (startupModules.some(module => normalize(id).endsWith(module))) visitStartupSource(id);
            }
            const loginSeen = new Set<string>();
            const visitLoginSource = (id: string) => {
                if (loginSeen.has(id)) return;
                loginSeen.add(id);
                if (loginDependencyViolation(id)) this.error("Heavy dependency entered the login view: " + id);
                this.getModuleInfo(id)?.importedIds.forEach(visitLoginSource);
            };
            for (const id of this.getModuleIds()) {
                if (publicViewModules.some(module => normalize(id).endsWith(module))) visitLoginSource(id);
            }
            const seen = new Set<string>();
            const visit = (name: string) => {
                if (seen.has(name)) return;
                seen.add(name);
                const chunk = bundle[name];
                if (!chunk || chunk.type !== "chunk") return;
                const forbidden = Object.keys(chunk.modules).filter((id) =>
                    normalize(id).includes("/src/admin/"),
                );
                if (forbidden.length)
                    this.error(
                        "Backend modules entered the user graph: " +
                            forbidden.join(", "),
                    );
                [...chunk.imports, ...chunk.dynamicImports].forEach(visit);
            };
            visit(entry.fileName);
            // The public browser gate must not fetch/evaluate the business shell
            // through a shared or merged static chunk. Dynamic imports stay lazy.
            const workspaceSeen = new Set<string>();
            const visitEntryDependency = (name: string) => {
                if (workspaceSeen.has(name)) return;
                workspaceSeen.add(name);
                const chunk = bundle[name];
                if (!chunk || chunk.type !== "chunk") return;
                if (Object.keys(chunk.modules).some(id => normalize(id).endsWith("/src/user/UserWorkspace.tsx")))
                    this.error("Business workspace entered the public browser entry: " + name);
                const heavy = Object.keys(chunk.modules).filter(publicStartupViolation);
                if (heavy.length) this.error("Heavy dependency entered the public startup chunk: " + heavy.join(", "));
                chunk.imports.forEach(visitEntryDependency);
            };
            for (const chunk of Object.values(bundle)) {
                if (chunk.type === "chunk" && Object.keys(chunk.modules).some(id => startupModules.some(module => normalize(id).endsWith(module))))
                    visitEntryDependency(chunk.fileName);
            }
            const loginChunks = new Set<string>();
            const visitLoginChunk = (name: string) => {
                if (loginChunks.has(name)) return;
                loginChunks.add(name);
                const chunk = bundle[name];
                if (!chunk || chunk.type !== "chunk") return;
                const heavy = Object.keys(chunk.modules).filter(loginDependencyViolation);
                if (heavy.length) this.error("Heavy dependency entered the login chunk: " + heavy.join(", "));
                chunk.imports.forEach(visitLoginChunk);
            };
            for (const chunk of Object.values(bundle)) {
                if (chunk.type === "chunk" && Object.keys(chunk.modules).some(id => publicViewModules.some(module => normalize(id).endsWith(module)))) visitLoginChunk(chunk.fileName);
            }
        },
    };
}
