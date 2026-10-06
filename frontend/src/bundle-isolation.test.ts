import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { userBundleIsolation } from "../build-isolation";

function check(
    extra: Record<string, any>,
    imports: string[] = [],
    dynamicImports: string[] = [],
) {
    const plugin = userBundleIsolation();
    const hook = plugin.generateBundle as Function;
    hook.call(
        {
            getModuleInfo() {
                return null;
            },
            error(message: string) {
                throw new Error(message);
            },
        },
        {},
        {
            "main.js": {
                type: "chunk",
                isEntry: true,
                facadeModuleId: "/src/main.tsx",
                fileName: "main.js",
                modules: { "/src/main.tsx": {} },
                imports,
                dynamicImports,
            },
            ...extra,
        },
    );
}
const chunk = (
    module: string,
    imports: string[] = [],
    dynamicImports: string[] = [],
) => ({ type: "chunk", modules: { [module]: {} }, imports, dynamicImports });

it("allows the guarded backend entry but rejects eager backend dependencies", () => {
    const backend = chunk("/src/admin-workspace.tsx", ["editor.js"]);
    const editor = chunk("/src/AdminFastaiDownloads.tsx");
    expect(() =>
        check(
            { "backend.js": backend, "editor.js": editor },
            [],
            ["backend.js"],
        ),
    ).not.toThrow();
    expect(() =>
        check({ "backend.js": backend, "editor.js": editor }, ["backend.js"]),
    ).toThrow(/Backend modules/);
});
it("rejects backend modules reached through user page navigation", () => {
    expect(() =>
        check(
            {
                "user.js": chunk("/src/user-entry.tsx", [], ["settings.js"]),
                "settings.js": chunk(
                    "C:\\project\\src\\AdminFastaiDownloads.tsx",
                ),
            },
            [],
            ["user.js"],
        ),
    ).toThrow(/Backend modules/);
});
it("keeps both backend dynamic imports inside explicit backend-only branches", () => {
    const text = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
    const source = ts.createSourceFile(
        "main.tsx",
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    const guarded = new Set<string>();
    function walk(node: ts.Node, adminOnly = false) {
        if (
            ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            expect(node.moduleSpecifier.text).not.toMatch(/^\.\/admin/i);
        }
        if (
            ts.isIfStatement(node) &&
            node.expression.getText(source) === 'boot.mode === "admin"'
        ) {
            walk(node.thenStatement, true);
            if (node.elseStatement) walk(node.elseStatement, adminOnly);
            return;
        }
        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            ts.isStringLiteral(node.arguments[0]) &&
            node.arguments[0].text === "./admin-legacy.css"
        ) {
            expect(adminOnly).toBe(true);
            guarded.add("styles");
        }
        if (
            ts.isJsxSelfClosingElement(node) &&
            node.tagName.getText(source) === "AdminWorkspace"
        ) {
            expect(adminOnly).toBe(true);
            guarded.add("workspace");
        }
        ts.forEachChild(node, (child) => walk(child, adminOnly));
    }
    walk(source);
    expect([...guarded].sort()).toEqual(["styles", "workspace"]);
});
