import fs from "node:fs";
import ts from "typescript";
import path from "node:path";
const file = path.resolve(
    import.meta.dirname,
    "../../public/assets/admin/res_005.js",
);
const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
);
const text = (node) =>
    node && ts.isStringLiteralLike(node) ? node.text : undefined;
const prop = (node, key) =>
    node.properties?.find(
        (p) => p.name?.getText(source).replace(/["']/g, "") === key,
    )?.initializer;
function walk(node) {
    if (ts.isArrayLiteralExpression(node)) {
        const cols = node.elements
            .filter(ts.isObjectLiteralExpression)
            .map((o) => ({
                key: text(prop(o, "dataIndex")),
                title: text(prop(o, "title")),
            }))
            .filter((c) => c.key && c.title);
        if (cols.length > 1)
            console.log(
                JSON.stringify({
                    line:
                        source.getLineAndCharacterOfPosition(
                            node.getStart(source),
                        ).line + 1,
                    columns: cols,
                }),
            );
    }
    ts.forEachChild(node, walk);
}
walk(source);
