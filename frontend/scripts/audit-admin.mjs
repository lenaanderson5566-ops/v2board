import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const legacyPath = "public/assets/admin/res_005.js",
    currentPath = "frontend/src/admin.tsx";
const legacy = ts.createSourceFile(
    legacyPath,
    read(legacyPath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
);
const current = ts.createSourceFile(
    currentPath,
    read(currentPath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
);
const text = (node) =>
    node && (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node))
        ? node.text
        : undefined;
const walk = (node, fn) => {
    fn(node);
    ts.forEachChild(node, (child) => walk(child, fn));
};
const property = (node, key) =>
    node.properties?.find(
        (p) =>
            p.name?.getText(node.getSourceFile()).replace(/["']/g, "") === key,
    )?.initializer;
const line = (source, node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const rows = [],
    menus = [],
    settings = new Map(),
    userFields = new Map(),
    currentResources = new Map();
function controlInfo(node) {
    let control, label, condition;
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (
            !condition &&
            ts.isConditionalExpression(parent) &&
            !parent.condition.getText(legacy).includes("=>")
        )
            condition = parent.condition.getText(legacy).slice(0, 100);
        if (
            ts.isCallExpression(parent) &&
            ts.isPropertyAccessExpression(parent.expression) &&
            parent.expression.name.text === "createElement"
        ) {
            const props = parent.arguments[1];
            if (!control && props && ts.isObjectLiteralExpression(props))
                control = parent;
            const title =
                props && ts.isObjectLiteralExpression(props)
                    ? text(property(props, "title"))
                    : undefined;
            if (title) {
                label = title;
                break;
            }
        }
    }
    const props = control?.arguments[1],
        options = [];
    if (control)
        for (const child of control.arguments.slice(2))
            walk(child, (item) => {
                if (
                    ts.isCallExpression(item) &&
                    ts.isPropertyAccessExpression(item.expression) &&
                    item.expression.name.text === "createElement"
                ) {
                    const optionProps = item.arguments[1];
                    if (
                        optionProps &&
                        ts.isObjectLiteralExpression(optionProps)
                    ) {
                        const value = text(property(optionProps, "value")),
                            caption = text(item.arguments[2]);
                        if (value !== undefined && caption !== undefined)
                            options.push([value, caption]);
                    }
                }
            });
    const tag = text(control?.arguments[0]);
    const type =
        props && property(props, "checked")
            ? "switch"
            : props && text(property(props, "mode")) === "tags"
              ? "tags"
              : options.length || tag === "select"
                ? "select"
                : tag === "textarea"
                  ? "textarea"
                  : props && text(property(props, "type")) === "number"
                    ? "number"
                    : tag === "input"
                      ? "text"
                      : "自定义组件";
    return { line: line(legacy, node), label, type, options, condition };
}
walk(legacy, (node) => {
    if (ts.isObjectLiteralExpression(node)) {
        const href = text(property(node, "href")),
            title = text(property(node, "title"));
        if (
            href?.startsWith("/") &&
            title &&
            text(property(node, "type")) === "item"
        )
            menus.push({ title, href, line: line(legacy, node) });
    }
    if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
    ) {
        const method = node.expression.name.text,
            args = node.arguments;
        if (
            method === "set" &&
            text(args[0]) &&
            text(args[1]) &&
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
                "frontend",
            ].includes(text(args[0]))
        )
            settings.set(`${text(args[0])}.${text(args[1])}`, {
                group: text(args[0]),
                key: text(args[1]),
                ...controlInfo(node),
            });
        if (method === "formChange" && text(args[0]))
            userFields.set(text(args[0]), controlInfo(node));
    }
});
walk(current, (node) => {
    if (
        !ts.isVariableDeclaration(node) ||
        node.name.getText(current) !== "resources" ||
        !ts.isObjectLiteralExpression(node.initializer)
    )
        return;
    for (const resource of node.initializer.properties) {
        const key = resource.name.getText(current),
            fields = property(resource.initializer, "fields"),
            found = new Set();
        if (fields)
            walk(fields, (item) => {
                if (
                    ts.isCallExpression(item) &&
                    ["f", "toggle"].includes(
                        item.expression.getText(current),
                    ) &&
                    text(item.arguments[0])
                )
                    found.add(text(item.arguments[0]));
                if (
                    ts.isPropertyAssignment(item) &&
                    item.name.getText(current) === "key" &&
                    text(item.initializer)
                )
                    found.add(text(item.initializer));
                if (
                    ts.isStringLiteralLike(item) &&
                    /^(month|quarter|half_year|year|two_year|three_year|onetime|reset)_price$/.test(
                        item.text,
                    )
                )
                    found.add(item.text);
            });
        currentResources.set(key, found);
    }
});
const add = (module, item, status, note, evidence) =>
    rows.push({ module, item, status, note, evidence });
const routes = {
    "/dashboard": [
        "运营概览",
        "部分迁移",
        "保留核心概览；原今日/昨日节点及用户排行尚未恢复，统计交互需要回归。",
    ],
    "/config/system": [
        "系统设置",
        "已迁移",
        "按分类加载后端设置，并增加参数联动。",
    ],
    "/config/payment": [
        "支付方式",
        "已迁移",
        "网关表单与启用/删除已迁移；排序入口待补齐。",
    ],
    "/config/theme": [
        "主题配置",
        "按要求移除",
        "不恢复主题选择；自定义页脚 HTML 已单独保留。",
    ],
    "/server/manage": [
        "节点管理",
        "已迁移",
        "八类节点、复制、展示、参数联动已迁移；拖动排序待补齐。",
    ],
    "/server/group": ["权限组", "已迁移", "新增、编辑、删除已保留。"],
    "/server/route": ["路由规则", "已迁移", "动作、参数与默认出口条件已迁移。"],
    "/plan": [
        "套餐管理",
        "已迁移",
        "字段、周期、重置方式、展示已保留；排序入口待补齐。",
    ],
    "/order": [
        "订单管理",
        "部分迁移",
        "列表、付款标记、取消已保留；详情、分配订单和筛选待补齐。",
    ],
    "/coupon": [
        "优惠券",
        "已迁移",
        "生成、批量生成、套餐/周期限制已迁移；CSV 下载入口待补齐。",
    ],
    "/giftcard": [
        "礼品卡",
        "已迁移",
        "五种类型与条件字段已迁移；CSV 下载入口待补齐。",
    ],
    "/user": [
        "用户管理",
        "部分迁移",
        "编辑字段逐项核对；高级筛选、批量操作、邮件和 CSV 待补齐。",
    ],
    "/notice": ["公告管理", "已迁移", "新增、编辑、删除、展示已保留。"],
    "/ticket": [
        "工单中心",
        "已迁移",
        "列表、回复、关闭已统一；旧筛选与分页需要单独回归。",
    ],
    "/knowledge": [
        "知识库",
        "已迁移",
        "正文、语言、分类已保留；拖动排序及分类选项待补齐。",
    ],
    "/queue": [
        "系统状态",
        "部分迁移",
        "状态与队列概况已迁移；原队列工作负载、进程详情待补齐。",
    ],
};
for (const menu of menus) {
    const mapped = routes[menu.href];
    let status = mapped?.[1] || "待核对";
    if (status === "已迁移" && /待补齐|尚未|需要单独/.test(mapped[2]))
        status = "部分迁移";
    add(
        "原后台菜单",
        `${menu.title} (${menu.href})`,
        status,
        mapped ? `${mapped[0]}：${mapped[2]}` : "未发现明确映射",
        `${legacyPath}:${menu.line}`,
    );
}
const configFetch = read("app/Http/Controllers/V1/Admin/ConfigController.php");
const configKeys = new Set(
    [
        ...configFetch.matchAll(
            /'([a-zA-Z0-9_]+)'\s*=>\s*(?:\(int\))?config\(/g,
        ),
    ].map((m) => m[1]),
);
const rules = new Map(
    [
        ...read("app/Http/Requests/Admin/ConfigSave.php").matchAll(
            /'([a-zA-Z0-9_]+)'\s*=>\s*(?:'([^']*)'|\[([^\]]*)\])/g,
        ),
    ].map((m) => [
        m[1],
        m[2] ?? [...m[3].matchAll(/'([^']*)'/g)].map((v) => v[1]).join("|"),
    ]),
);
const compiled = ts.transpileModule(read("frontend/src/admin-fields.ts"), {
    compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
    },
}).outputText;
const { configField } = await import(
    "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
for (const field of settings.values()) {
    const removed =
        field.group === "frontend" ||
        field.key.startsWith("frontend_") ||
        field.key === "email_template";
    const now =
        field.key === "try_out_plan_id"
            ? { type: "select" }
            : configField(field.key, null, rules.get(field.key), field.key);
    let status = removed
        ? "按要求移除"
        : configKeys.has(field.key)
          ? "已保留"
          : "待核对";
    if (status === "已保留" && field.type === "tags" && now.type === "json")
        status = "交互差异";
    const details = `原控件：${field.label || field.key} / ${field.type}${field.options.length ? " [" + field.options.map(([value, label]) => value + "=" + label).join("、") + "]" : ""}${field.condition ? "；原条件：" + field.condition : ""}。当前：${now.type}${now.options ? " [" + now.options.map(([value, label]) => value + "=" + label).join("、") + "]" : ""}。`;
    add(
        "系统设置字段",
        `${field.group}.${field.key}`,
        status,
        removed
            ? "模板配置按既定要求不恢复。"
            : configKeys.has(field.key)
              ? details +
                (status === "交互差异"
                    ? "当前用 JSON 编辑数组，尚未恢复原标签选择交互。"
                    : "联动按 admin-linkage.ts 定义；自定义组件需结合浏览器确认。")
              : "旧控件字段未在当前 config/fetch 中确认。",
        `${legacyPath}:${field.line}`,
    );
}
const userKeys = [
    "email",
    "password",
    "balance",
    "commission_balance",
    "u",
    "d",
    "transfer_enable",
    "device_limit",
    "expired_at",
    "plan_id",
    "banned",
    "commission_type",
    "commission_rate",
    "discount",
    "is_admin",
    "is_staff",
    "remarks",
    "speed_limit",
    "invite_user_email",
];
for (const key of userKeys) {
    if (!userFields.has(key) && !read(legacyPath).includes(key)) continue;
    const exists = currentResources.get("users")?.has(key),
        old = userFields.get(key);
    add(
        "用户编辑字段",
        key,
        exists
            ? ["balance", "commission_balance"].includes(key)
                ? "交互差异"
                : "已保留"
            : "缺失",
        exists
            ? (["balance", "commission_balance"].includes(key)
                  ? "字段已保留，但原后台显示元，当前输入分，属于单位交互差异。"
                  : ["u", "d", "transfer_enable"].includes(key)
                    ? "与原后台一致输入 GB，提交转换为整数字节；后端保存已回归。"
                    : key === "invite_user_email"
                      ? "已迁入用户编辑；邀请人设置、解除和未提交时保留已回归。"
                      : "字段入口已存在；不代表所有边界行为已验证。") +
                  (old?.options.length
                      ? "原选项：" +
                        old.options
                            .map(([value, label]) => value + "=" + label)
                            .join("、")
                      : "")
            : "原后台字段存在，当前用户编辑表单尚未包含。",
        `${legacyPath}:${old?.line || 1}`,
    );
}
const actions = [
    ["系统设置", "config/testSendMail", "发送测试邮件"],
    ["系统设置", "config/setTelegramWebhook", "设置 Telegram Webhook"],
    ["套餐管理", "plan/sort", "套餐排序"],
    ["节点管理", "server/manage/sort", "节点排序"],
    ["支付方式", "payment/sort", "支付方式排序"],
    ["知识库", "knowledge/sort", "知识库排序"],
    ["用户管理", "user/dumpCSV", "导出用户 CSV"],
    ["用户管理", "user/sendMail", "发送用户邮件"],
    ["用户管理", "user/ban", "批量封禁"],
    ["用户管理", "user/allDel", "批量删除"],
    ["用户管理", "user/setInviteUser", "设置邀请人"],
    ["订单管理", "order/detail", "订单详情"],
    ["订单管理", "order/assign", "分配订单"],
    ["队列监控", "system/getQueueWorkload", "队列工作负载"],
    ["队列监控", "system/getQueueMasters", "队列主进程"],
];
const adminEndpoints = new Set();
for (const file of ["frontend/src/admin.tsx", "frontend/src/user.tsx"]) {
    const source = ts.createSourceFile(
        file,
        read(file),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    walk(source, (node) => {
        if (
            ts.isCallExpression(node) &&
            node.expression.getText(source) === "admin" &&
            text(node.arguments[0])
        )
            adminEndpoints.add(text(node.arguments[0]));
    });
}
for (const [module, endpoint, label] of actions) {
    const exists = adminEndpoints.has(endpoint),
        equivalent =
            endpoint === "user/setInviteUser" &&
            currentResources.get("users")?.has("invite_user_email");
    const source = read(legacyPath);
    const index = source.indexOf(endpoint);
    add(
        "操作入口",
        `${module} / ${label}`,
        equivalent
            ? "已迁移"
            : exists
              ? "已保留"
              : index >= 0
                ? "缺失"
                : "待核对",
        equivalent
            ? "邀请人设置已迁入用户编辑，通过 user/update 保存。"
            : exists
              ? "当前前端已引用该管理员接口；不代表外部服务已配置。"
              : index >= 0
                ? "原后台引用此接口，当前前端未找到操作入口。"
                : "后端保留接口；未找到原构建中的直接引用，不判定为原界面遗漏。",
        index >= 0
            ? `${legacyPath}:${legacy.getLineAndCharacterOfPosition(index).line + 1}`
            : "app/Http/Routes/V1/AdminRoute.php",
    );
}
add(
    "旧管理扩展",
    "风控、日志、客户端策略、套餐翻译",
    "已统一",
    "原独立中台已并入当前后台。需与原扩展逐页回归；本次不声称所有字段完全等价。",
    "resources/views/admin-extension.blade.php",
);
add(
    "对照限制",
    "节点高级参数与支付网关配置",
    "动态表单",
    "八类节点依照后端校验生成；支付表单依网关返回。静态清单不能证明所有嵌套参数、每个网关与外部服务均测试完成。",
    "frontend/src/node-settings.ts",
);
const report = {
    baseline: {
        file: legacyPath,
        commit: execFileSync(
            "git",
            ["log", "-1", "--format=%h", "--", legacyPath],
            { cwd: root, encoding: "utf8" },
        ).trim(),
    },
    method: "原构建文件 AST + 当前表单源码 + 后端路由/校验；浏览器已只读抽查原仪表盘、系统配置站点和邮件页、用户列表及用户编辑抽屉；其他项目以源码核对为主。操作入口清单属于重点抽查，不是全部按钮枚举；已迁移不等于行为完全一致。",
    rows,
};
fs.mkdirSync(path.join(root, "docs"), { recursive: true });
fs.writeFileSync(
    path.join(root, "docs/admin-parity.json"),
    JSON.stringify(report, null, 2) + "\n",
);
const escape = (value) =>
    String(value).replace(
        /[&<>"']/g,
        (char) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[char],
    );
const counts = Object.fromEntries(
    [...new Set(rows.map((row) => row.status))].map((status) => [
        status,
        rows.filter((row) => row.status === status).length,
    ]),
);
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>原后台逐项对照</title><style>body{font:14px/1.7 system-ui;background:#fafafa;color:#222;margin:0}main{max-width:1300px;margin:auto;padding:40px 24px}h1{font-size:30px}p{color:#666}.summary{display:flex;flex-wrap:wrap;gap:12px;margin:25px 0}.summary span{background:white;border:1px solid #ddd;border-radius:12px;padding:12px 20px}.filters{display:flex;gap:12px;position:sticky;top:0;background:#fafafa;padding:15px 0}input,select{font:inherit;padding:10px;border:1px solid #ddd;border-radius:8px}input{flex:1;min-width:0}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;border-bottom:1px solid #eee;padding:14px;vertical-align:top}th{background:#eee}td:nth-child(3){white-space:nowrap}td:last-child{font:11px/1.7 monospace;color:#777;overflow-wrap:anywhere}.missing td:nth-child(3){color:#a14b24;font-weight:bold}.removed td:nth-child(3){color:#666}@media(max-width:700px){main{padding:20px 12px}.table{overflow:auto}table{min-width:900px}}</style><main><h1>原后台逐项对照</h1><p>基准：${escape(legacyPath)} · ${escape(report.baseline.commit)}。${escape(report.method)}</p><p>本表区分菜单、字段与操作入口；没有把“页面存在”视为完整功能等价。模板配置不按原样恢复，自定义页脚继续保留。</p><div class="summary">${Object.entries(
    counts,
)
    .map(
        ([name, count]) =>
            `<span>${escape(name)} <strong>${count}</strong></span>`,
    )
    .join(
        "",
    )}</div><div class="filters"><input id="search" aria-label="搜索模块或参数" placeholder="搜索模块、字段或操作"><select id="status" aria-label="筛选状态"><option value="">全部状态</option>${Object.keys(
    counts,
)
    .map((name) => `<option>${escape(name)}</option>`)
    .join(
        "",
    )}</select></div><div class="table"><table><thead><tr><th>分类</th><th>对照项</th><th>结果</th><th>说明 / 未完成事项</th><th>依据</th></tr></thead><tbody>${rows.map((row) => `<tr class="${row.status === "缺失" ? "missing" : row.status === "按要求移除" ? "removed" : ""}" data-status="${escape(row.status)}">${["module", "item", "status", "note", "evidence"].map((key) => `<td>${escape(row[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></main><script>const search=document.getElementById('search'),status=document.getElementById('status');function filter(){for(const row of document.querySelectorAll('tbody tr'))row.hidden=!row.textContent.toLowerCase().includes(search.value.toLowerCase())||(status.value&&row.dataset.status!==status.value)}search.addEventListener('input',filter);status.addEventListener('change',filter);</script></html>`;
fs.writeFileSync(path.join(root, "docs/admin-parity.html"), html);
console.log(
    JSON.stringify(
        {
            menuItems: menus.length,
            settingsFields: settings.size,
            userFields: userKeys.length,
            rows: rows.length,
            counts,
        },
        null,
        2,
    ),
);
