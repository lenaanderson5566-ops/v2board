import fs from "node:fs";
import { Converter } from "opencc-js";
const zh = JSON.parse(fs.readFileSync("src/locales/zh-CN.json", "utf8"));
const en = JSON.parse(fs.readFileSync("src/locales/en-US.json", "utf8"));
for (const key of ["共", "条 · 第", "页", "{{value0}} 台设备"]) {
    delete zh[key];
    delete en[key];
}
const additions = {
    关闭: "Close",
    总览: "Home",
    我的订阅: "My subscription",
    购买订阅: "Plans",
    使用文档: "Help",
    "{{count}} 台设备": "{{count}} devices",
    界面语言: "Interface language",
    快捷导航: "Quick navigation",
    "共 {{total}} 条 · 第 {{page}} 页": "{{total}} items · Page {{page}}",
    一键导入: "Quick import",
    连接你的客户端: "Connect your client",
    "选择已安装的客户端，直接导入订阅。":
        "Choose an installed client to import your subscription.",
    "在 {{client}} 中打开": "Open in {{client}}",
    "如果客户端没有打开，请先安装客户端，或复制订阅链接手动添加。":
        "If the app did not open, install the client first or copy the link to add it manually.",
    扫码或手动添加: "Scan or add manually",
    "在另一台设备上扫描，或复制链接到客户端。":
        "Scan on another device or copy the link into your client.",
    订阅二维码: "Subscription QR code",
    "订阅链接和二维码包含访问凭据，请勿分享。":
        "Your link and QR code contain access credentials. Do not share them.",
};
Object.assign(en, additions);
for (const key of Object.keys(additions)) zh[key] = key;
const codes = ["ja-JP", "ko-KR", "vi-VN", "ru-RU", "fa-IR"];
const resources = {
    "ja-JP": {},
    "ko-KR": {},
    "vi-VN": {},
    "ru-RU": {},
    "fa-IR": {},
};
for (const line of fs
    .readFileSync("scripts/translations.tsv", "utf8")
    .trim()
    .split(/\r?\n/)) {
    const [key, ...values] = line.split("|");
    if (values.length !== 5) throw new Error("Invalid row: " + key);
    codes.forEach((code, i) => (resources[code][key] = values[i]));
}
const convert = Converter({ from: "cn", to: "tw" });
for (const [code, dict] of Object.entries({
    "zh-CN": zh,
    "zh-TW": Object.fromEntries(Object.keys(zh).map((k) => [k, convert(k)])),
    "en-US": en,
    ...resources,
})) {
    const output = Object.fromEntries(
        Object.keys(zh).map((k) => [k, dict[k] || ""]),
    );
    const deviceForms = {
        "en-US": { one: "{{count}} device", other: "{{count}} devices" },
        "ru-RU": {
            one: "{{count}} устройство",
            few: "{{count}} устройства",
            many: "{{count}} устройств",
            other: "{{count}} устройства",
        },
        "fa-IR": { one: "{{count}} دستگاه", other: "{{count}} دستگاه" },
    }[code];
    if (deviceForms)
        for (const [category, value] of Object.entries(deviceForms))
            output["{{count}} 台设备_" + category] = value;
    fs.writeFileSync(
        `src/locales/${code}.json`,
        JSON.stringify(output, null, 2) + "\n",
    );
    const missing = Object.keys(zh).filter((k) => !output[k]);
    if (missing.length) throw new Error(code + ": " + missing.join(", "));
}
const serverZh = JSON.parse(
    fs.readFileSync("../resources/lang/zh-CN.json", "utf8"),
);
const serverEn = JSON.parse(
    fs.readFileSync("../resources/lang/en-US.json", "utf8"),
);
serverZh["The current required minimum withdrawal commission is :limit"] =
    "目前最低可提現佣金為 :limit";
const serverResources = Object.fromEntries(codes.map((code) => [code, {}]));
for (const line of fs
    .readFileSync("scripts/server-translations.tsv", "utf8")
    .trim()
    .split(/\r?\n/)) {
    const [key, ...values] = line.split("|");
    if (values.length !== 5) throw new Error("Invalid server row: " + key);
    codes.forEach((code, i) => (serverResources[code][key] = values[i]));
}
const aliases = {
    "Plan period cannot be empty": "Plan cycle cannot be empty",
    "Wrong plan period": "Wrong plan cycle",
    "This payment period cannot be purchased, please choose another period":
        "This payment cycle cannot be purchased, please choose another cycle",
};
serverZh[
    "This payment cycle cannot be purchased, please choose another cycle"
] =
    serverZh[
        "This payment period cannot be purchased, please choose another period"
    ];
serverZh["Plan cycle cannot be empty"] =
    serverZh["Plan period cannot be empty"];
serverZh["Wrong plan cycle"] = serverZh["Wrong plan period"];
for (const [alias, canonical] of Object.entries(aliases)) {
    serverEn[alias] = serverEn[canonical];
    codes.forEach(
        (code) =>
            (serverResources[code][alias] = serverResources[code][canonical]),
    );
}
for (const [code, dict] of Object.entries({
    "zh-TW": Object.fromEntries(
        Object.entries(serverZh).map(([k, v]) => [k, convert(v)]),
    ),
    ...serverResources,
})) {
    const missing = Object.keys(serverEn).filter(
        (k) =>
            !dict[k] &&
            !["Plan cycle cannot be empty", "Wrong plan cycle"].includes(k),
    );
    if (missing.length)
        throw new Error(code + " server missing: " + missing.join(", "));
    fs.writeFileSync(
        `../resources/lang/${code}.json`,
        JSON.stringify(dict, null, 2) + "\n",
    );
}
fs.writeFileSync(
    "../resources/lang/en-US.json",
    JSON.stringify(serverEn, null, 4) + "\n",
);
