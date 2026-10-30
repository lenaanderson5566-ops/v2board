import { expect, it } from "vitest";
import { boundaryViolation, loginDependencyViolation, publicStartupViolation, userBundleIsolation } from "../../build-isolation";

it("rejects dependencies across private applications and from shared into either application", () => {
    expect(
        boundaryViolation("/src/user/app.tsx", "/src/admin/AdminApp.tsx"),
    ).toBe(true);
    expect(
        boundaryViolation(
            "C:\\project\\src\\shared\\ui.tsx",
            "C:\\project\\src\\admin\\AdminApp.tsx",
        ),
    ).toBe(true);
    expect(boundaryViolation("/src/shared/ui.tsx", "/src/user/app.tsx")).toBe(
        true,
    );
    expect(
        boundaryViolation("/src/admin/AdminApp.tsx", "/src/user/app.tsx"),
    ).toBe(true);
    expect(boundaryViolation("/src/user/app.tsx", "/src/shared/ui.tsx")).toBe(
        false,
    );
    expect(
        boundaryViolation("/src/admin/AdminApp.tsx", "/src/shared/ui.tsx"),
    ).toBe(false);
});
it("rejects backend chunks reached through user page navigation", () => {
    const hook = userBundleIsolation().generateBundle as Function;
    const bundle = {
        "user.js": {
            type: "chunk",
            isEntry: true,
            fileName: "user.js",
            facadeModuleId: "/frontend/index.html",
            modules: {},
            imports: [],
            dynamicImports: ["page.js"],
        },
        "page.js": {
            type: "chunk",
            modules: { "/src/user/page.tsx": {} },
            imports: ["backend.js"],
            dynamicImports: [],
        },
        "backend.js": {
            type: "chunk",
            modules: { "/src/admin/AdminApp.tsx": {} },
            imports: [],
            dynamicImports: [],
        },
    };
    expect(() =>
        hook.call(
            {
                getModuleIds: () => [],
                getModuleInfo: () => null,
                error(message: string) {
                    throw new Error(message);
                },
            },
            {},
            bundle,
        ),
    ).toThrow(/Backend modules/);
});
it.each(["merged", "static", "startup-static", "dynamic"])("keeps the workspace out of eager entry dependencies: %s", (mode) => {
    const hook = userBundleIsolation().generateBundle as Function;
    const bundle = {
        "user.js": {type:"chunk",isEntry:true,fileName:"user.js",facadeModuleId:"/frontend/index.html",modules:{},imports:[],dynamicImports:["entry.js","render-app.js"]},
        "entry.js": {
            type:"chunk",fileName:"entry.js",
            modules:{"/src/user/app.tsx":{},...(mode === "merged" ? {"/src/user/UserWorkspace.tsx":{}} : {})},
            imports: mode === "static" ? ["workspace.js"] : [],
            dynamicImports: mode === "dynamic" ? ["workspace.js"] : [],
        },
        "workspace.js": {type:"chunk",fileName:"workspace.js",modules:{"/src/user/UserWorkspace.tsx":{}},imports:[],dynamicImports:[]},
        "render-app.js": {type:"chunk",fileName:"render-app.js",modules:{"/src/shared/render-app.tsx":{}},imports:mode === "startup-static" ? ["workspace.js"] : [],dynamicImports:[]},
    };
    const run=()=>hook.call({getModuleIds:()=>[],getModuleInfo:()=>null,error(message:string){throw new Error(message);}}, {}, bundle);
    if (mode === "dynamic") expect(run).not.toThrow();
    else expect(run).toThrow("Business workspace entered the public browser entry");
});

it.each([
    "/frontend/src/shared/markdown.ts",
    "C:\\project\\frontend\\src\\shared\\ui\\Editor.tsx",
    "/frontend/src/shared/ui/Table.tsx",
    "/frontend/src/shared/style.css?used",
    "/frontend/src/shared/console.css",
    "/frontend/src/user/user-experience.css",
    "/frontend/src/user/product.css",
    "/frontend/src/locales/zh-CN.json",
    "/frontend/src/locales/en-US.json",
])("rejects a heavy dependency imported statically by startup: %s", dependency => {
    expect(publicStartupViolation(dependency)).toBe(true);
    const hook = userBundleIsolation().generateBundle as Function;
    const bundle = { "user.js": {type:"chunk",isEntry:true,fileName:"user.js",facadeModuleId:"/frontend/index.html",modules:{},imports:[],dynamicImports:[]} };
    const run = (dynamic: boolean) => hook.call({
        getModuleIds: () => ["/frontend/src/user/app.tsx", dependency],
        getModuleInfo: (id: string) => id === "/frontend/src/user/app.tsx"
            ? { importedIds: dynamic ? [] : [dependency], dynamicallyImportedIds: dynamic ? [dependency] : [] }
            : { importedIds: [], dynamicallyImportedIds: [] },
        error(message: string) { throw new Error(message); },
    }, {}, bundle);
    expect(() => run(false)).toThrow("Heavy dependency entered the public startup");
    expect(() => run(true)).not.toThrow();
});

it("rejects an eager shared output chunk containing a full catalog", () => {
    const hook = userBundleIsolation().generateBundle as Function;
    const bundle = {
        "user.js": {type:"chunk",isEntry:true,fileName:"user.js",facadeModuleId:"/frontend/index.html",modules:{},imports:[],dynamicImports:["entry.js"]},
        "entry.js": {type:"chunk",fileName:"entry.js",modules:{"/src/user/app.tsx":{}},imports:["common.js"],dynamicImports:[]},
        "common.js": {type:"chunk",fileName:"common.js",modules:{"/src/locales/en-US.json":{}},imports:[],dynamicImports:[]},
    };
    expect(() => hook.call({getModuleIds:()=>[],getModuleInfo:()=>null,error(message:string){throw new Error(message);}}, {}, bundle))
        .toThrow("Heavy dependency entered the public startup chunk");
    expect(publicStartupViolation("\0virtual:startup-catalogs")).toBe(false);
    expect(publicStartupViolation("/frontend/src/user/entry.css")).toBe(false);
});

it.each([
    "/src/user/AnnouncementCenter.tsx", "/src/user/AccountMenu.tsx",
    "/src/user/InviteCampaign.tsx", "/src/user/UserStatusGate.tsx",
    "/src/shared/markdown.ts", "/src/shared/ui/Editor.tsx",
    "/node_modules/dompurify/dist/purify.es.mjs",
])("keeps authenticated dependencies out of the login source and shared output: %s", dependency => {
    const hook = userBundleIsolation().generateBundle as Function;
    const entry = {type:"chunk",isEntry:true,fileName:"user.js",facadeModuleId:"/frontend/index.html",modules:{},imports:[],dynamicImports:[]};
    const workspace = {type:"chunk",fileName:"workspace.js",modules:{"/src/user/UserWorkspace.tsx":{}},imports:[],dynamicImports:[]};
    const context = {
        getModuleIds: () => ["/src/user/UserWorkspace.tsx", dependency],
        getModuleInfo: (id: string) => ({ importedIds: id.endsWith("UserWorkspace.tsx") ? [dependency] : [], dynamicallyImportedIds: [] }),
        error(message:string) { throw new Error(message); },
    };
    expect(loginDependencyViolation(dependency)).toBe(true);
    expect(() => hook.call(context, {}, {"user.js":entry,"workspace.js":workspace})).toThrow("Heavy dependency entered the login view");
    const chunkContext = {getModuleIds:()=>[],getModuleInfo:()=>null,error:context.error};
    const shared = {type:"chunk",fileName:"shared.js",modules:{[dependency]:{}},imports:[],dynamicImports:[]};
    expect(() => hook.call(chunkContext, {}, {"user.js":entry,"workspace.js":{...workspace,imports:["shared.js"]},"shared.js":shared}))
        .toThrow("Heavy dependency entered the login chunk");
    expect(() => hook.call(chunkContext, {}, {"user.js":entry,"workspace.js":{...workspace,dynamicImports:["shared.js"]},"shared.js":shared}))
        .not.toThrow();
});
