import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type { Plugin } from "vite";

export type Catalog = Record<string, Record<string, string>>;
const startupSources = [
    ["shared/ui/BrowserNoticeView.tsx"],
    ["shared/LanguagePicker.tsx"],
    ["shared/WorkspaceSkeleton.tsx"],
    ["shared/ErrorBoundary.tsx"],
    ["shared/ui/Modal.tsx"],
    ["user/AnalyticsPrivacy.tsx", "PrivacyFooterLinks"],
] as const;
const startupNamespaces = ["translation", "experience", "ux"];

/** Pick existing catalog values from the small public entry, never maintain a second translation source. */
export function startupCatalogs(root: string, watch: (path: string) => void = () => {}): Record<string, Catalog> {
    const directory = resolve(root, "src/locales");
    const read = (path: string) => { watch(path); return readFileSync(path, "utf8"); };
    const base: Catalog = JSON.parse(read(resolve(directory, "en-US.json")));
    const keys = Object.fromEntries(startupNamespaces.map(namespace => [namespace, new Set<string>()]));
    for (const [source, functionName] of startupSources) {
        const path = resolve(root, "src", source);
        const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const scopes = functionName ? file.statements.filter(statement =>
            ts.isFunctionDeclaration(statement) && statement.name?.text === functionName) : [file];
        if (!scopes.length) throw new Error(`Missing startup translation source: ${source}/${functionName}`);
        const visit = (node: ts.Node) => {
            if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
                for (const namespace of startupNamespaces)
                    if (Object.hasOwn(base[namespace] || {}, node.text)) keys[namespace].add(node.text);
            ts.forEachChild(node, visit);
        };
        scopes.forEach(visit);
    }
    const resources: Record<string, Catalog> = {};
    for (const file of readdirSync(directory).filter(name => name.endsWith(".json")).sort()) {
        const catalog: Catalog = JSON.parse(read(resolve(directory, file)));
        resources[file.slice(0, -5)] = Object.fromEntries(startupNamespaces.map(namespace => [namespace,
            Object.fromEntries([...keys[namespace]].sort().map(key => {
                const value = catalog[namespace]?.[key];
                if (typeof value !== "string" || !value.trim()) throw new Error(`Missing startup translation: ${file}/${namespace}/${key}`);
                return [key, value];
            })),
        ]));
    }
    return resources;
}

export function startupCatalogPlugin(): Plugin {
    const name = "virtual:startup-catalogs", resolved = "\0" + name;
    let root = "";
    return {
        name: "small-startup-catalogs",
        configResolved(config) { root = config.root; },
        resolveId(id) { if (id === name) return resolved; },
        load(id) {
            if (id !== resolved) return;
            return "export default " + JSON.stringify(startupCatalogs(root, path => this.addWatchFile(path))) + ";";
        },
    };
}
