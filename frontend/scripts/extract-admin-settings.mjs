import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
const root = path.resolve(import.meta.dirname, "../..");
const source = ts.createSourceFile(
    "legacy.js",
    fs.readFileSync(path.join(root, "public/assets/admin/res_005.js"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
);
const text = (node) =>
    node && ts.isStringLiteralLike(node) ? node.text : undefined;
const prop = (node, key) =>
    node?.properties?.find(
        (p) => p.name?.getText(source).replace(/["']/g, "") === key,
    )?.initializer;
const settings = {};
function visit(node) {
    if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "set" &&
        text(node.arguments[0]) &&
        text(node.arguments[1])
    ) {
        const group = text(node.arguments[0]),
            key = text(node.arguments[1]);
        if (
            [
                "site",
                "safe",
                "subscribe",
                "invite",
                "server",
                "email",
                "telegram",
                "app",
                "ticket",
                "deposit",
            ].includes(group)
        ) {
            let placeholder, presentation;
            for (let parent = node.parent; parent; parent = parent.parent) {
                if (
                    !ts.isCallExpression(parent) ||
                    !ts.isPropertyAccessExpression(parent.expression) ||
                    parent.expression.name.text !== "createElement"
                )
                    continue;
                const props = parent.arguments[1];
                placeholder ??= text(prop(props, "placeholder"));
                const label = text(prop(props, "title"));
                if (label) {
                    presentation = {
                        label,
                        hint: text(prop(props, "description")),
                        placeholder,
                        child:
                            prop(props, "isChildren")?.getText(source) === "!0",
                        line:
                            source.getLineAndCharacterOfPosition(
                                node.getStart(source),
                            ).line + 1,
                    };
                    break;
                }
            }
            if (presentation) (settings[group] ??= {})[key] = presentation;
        }
    }
    ts.forEachChild(node, visit);
}
visit(source);
fs.writeFileSync(
    path.join(root, "frontend/src/admin-settings-reference.json"),
    JSON.stringify(settings, null, 2) + "\n",
);
console.log(
    `Extracted ${Object.values(settings).reduce((count, group) => count + Object.keys(group).length, 0)} original setting presentations`,
);
