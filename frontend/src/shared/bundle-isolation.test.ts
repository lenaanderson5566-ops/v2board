import { expect, it } from "vitest";
import { boundaryViolation, userBundleIsolation } from "../../build-isolation";

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
