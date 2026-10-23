import { adminPageFixture } from "./test-support/page-fixtures";
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    act,
    fireEvent,
    render,
    screen,
    within,
    waitFor,
} from "@testing-library/react";
vi.mock("./payment-icons", () => ({
    paymentIcons: [],
    paymentIconInitial: () => ({}),
    resolvePaymentIcon: () => "",
}));
vi.mock("./PaymentCategoryEditor", () => ({
    PaymentCategoryEditor: () => null,
    paymentCategoryInitial: () => ({ category: "regular" }),
}));
const api = vi.hoisted(() => {
    window.V2BOARD = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../shared/api")>()),
    request: api.request,
    readRequest: api.request,
}));
import { Nodes, ResourcePage, resources } from "./admin";
import { NodeCredentials } from "./NodeCredentials";
import { NodeDeployment } from "./NodeDeployment";
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
});
it("updates deployment authentication automatically and stops once authenticated", async () => {
    api.request.mockResolvedValue({ data: { keys: [] } });
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<NodeDeployment node={{ id: 1, type: "v2box", name: "Node" }} close={() => {}} />); });
    expect(screen.getByText("独立凭据尚未认证")).toBeTruthy();
    api.request.mockResolvedValue({ data: { keys: [{ status: "active", lastUsedAt: "2026-10-23T00:00:00Z" }] } });
    const calls = api.request.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(screen.getByText("独立凭据已认证")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(api.request).toHaveBeenCalledTimes(calls + 1);
    view.unmount();
});
it("shows a newly generated credential only once without requesting an administrator password", async () => {
    vi.spyOn(window,"confirm").mockReturnValue(true);
    const close=vi.fn();
    api.request.mockImplementation(async (path:string) => path.endsWith("/issue")
        ? {data:{secret:"nk_test-once"}}
        : {data:{migrated:false,legacyEnabled:true,keys:[],legacyNodes:[{type:"v2box",id:1,name:"A"}]}});
    const view=render(<NodeCredentials node={{type:"v2box",id:1,name:"A"}} close={close}/>);
    const button=await screen.findByRole("button",{name:"生成 / 手动轮换密钥"});
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(await screen.findByLabelText("新节点密钥")).toHaveProperty("value","nk_test-once");
    expect(screen.queryByLabelText("凭据操作管理员密码")).toBeNull();
    expect(api.request).toHaveBeenCalledWith(expect.stringContaining("/issue"),expect.objectContaining({type:"v2box",id:1,credentialId:undefined}));
    view.unmount();
    render(<NodeCredentials node={{type:"v2box",id:1,name:"A"}} close={close}/>);
    expect(screen.queryByLabelText("新节点密钥")).toBeNull();
});
it("blocks a second rotation and preserves revoked state on failed requests", async () => {
    vi.spyOn(window,"confirm").mockReturnValue(true);
    api.request.mockImplementation(async (path:string) => {
        if(path.endsWith("/revoke")) throw new Error("拒绝操作");
        return {data:{migrated:true,legacyEnabled:false,keys:[{id:"key1",fingerprint:"abc",status:"retiring",createdAt:1}]}};
    });
    render(<NodeCredentials node={{type:"v2box",id:1,name:"A"}} close={()=>{}}/>);
    const revoke=await screen.findByRole("button",{name:"撤销 abc"});
    expect((screen.getByRole("button",{name:"生成 / 手动轮换密钥"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(revoke);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent","拒绝操作");
    expect(screen.getByText("宽限期")).toBeTruthy();
});
it("shows group names across numeric/string IDs and remembers selected node columns", async () => {
    api.request.mockImplementation(async (path: string) => {
        if(path.endsWith("dictionary/fetch")) return adminPageFixture(path);
        if (path.endsWith("server/group/fetch"))
            return {
                data: [
                    { id: 1, name: "普通权限组" },
                    { id: "2", name: "高级权限组" },
                ],
            };
        if (path.endsWith("server/manage/getNodes"))
            return {
                data: [
                    {
                        id: 1,
                        name: "Node A",
                        type: "v2node",
                        group_id: ["1", 2, 99],
                    },
                    {
                        id: 2,
                        name: "Node B",
                        type: "v2box",
                        group_id: [1, "2"],
                    },
                ],
            };
        return { data: {} };
    });
    const view = render(<Nodes />);
    expect(
        await screen.findByText("普通权限组 / 高级权限组 / 未知权限组（99）"),
    ).toBeTruthy();
    expect(screen.getByText("普通权限组 / 高级权限组")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    fireEvent.click(
        within(screen.getByLabelText("可选显示列")).getByRole("button", {
            name: "权限组",
        }),
    );
    expect(screen.queryByRole("columnheader", { name: "权限组" })).toBeNull();
    expect(screen.queryByText("普通权限组 / 高级权限组")).toBeNull();
    expect(screen.getAllByRole("button", { name: "编辑" })).toHaveLength(2);
    view.unmount();
    render(<Nodes />);
    await screen.findByText("Node A");
    expect(screen.queryByRole("columnheader", { name: "权限组" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    expect(
        (
            within(screen.getByLabelText("可选显示列")).getByRole("button", {
                name: "权限组",
            })
        ).getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "恢复默认展示" }));
    expect(screen.getByRole("columnheader", { name: "权限组" })).toBeTruthy();
    expect(screen.getByText("普通权限组 / 高级权限组")).toBeTruthy();
});
it.each(["v2node", "v2box"])(
    "opens, edits and saves a persisted %s node on HTTP",
    async (backend) => {
        vi.stubGlobal("structuredClone", undefined);
        const own = backend === "v2box" ? 22 : 11;
        api.request.mockImplementation(async (path: string) => {
        if(path.endsWith("dictionary/fetch")) return adminPageFixture(path);
            if (path.includes("console/nodeSchema"))
                return {
                    data: {
                        name: "required",
                        protocol: "required|in:vless",
                        tls: "required|in:0,1,2",
                        tls_settings: "nullable|array",
                        network: "required|in:tcp",
                        route_id: "nullable|array",
                        group_id: "required|array",
                    },
                };
            if (path.endsWith("server/group/fetch"))
                return { data: [{ id: 1, name: "Test group" }] };
            if (path.endsWith("server/route/fetch"))
                return {
                    data: [
                        { id: 11, remarks: "Xray only", backend: "v2node" },
                        { id: 22, remarks: "Singbox only", backend: "v2box" },
                    ],
                };
            if (path.endsWith("server/manage/getNodes"))
                return {
                    data: [
                        {
                            id: 7,
                            name: "Saved node",
                            type: backend,
                            protocol: "vless",
                            tls: 1,
                            tls_settings: {
                                server_name: "node.example",
                                cert_mode: "http",
                            },
                            network: "tcp",
                            route_id: [own],
                            group_id: [1],
                        },
                    ],
                };
            if (path.endsWith(`/server/${backend}/save`)) return { data: true };
            throw new Error(`Unexpected endpoint: ${path}`);
        });
        render(<Nodes />);
        fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
        const name = await screen.findByDisplayValue("Saved node");
        expect(screen.getByDisplayValue("node.example")).toBeTruthy();
        expect(
            screen.getByText(
                backend === "v2box" ? "Singbox only" : "Xray only",
            ),
        ).toBeTruthy();
        expect(
            screen.queryByText(
                backend === "v2box" ? "Xray only" : "Singbox only",
            ),
        ).toBeNull();
        fireEvent.change(name, { target: { value: "Updated node" } });
        fireEvent.click(screen.getByRole("button", { name: "保存节点配置" }));
        await waitFor(() =>
            expect(api.request).toHaveBeenCalledWith(
                `test-admin/server/${backend}/save`,
                expect.objectContaining({
                    id: 7,
                    name: "Updated node",
                    route_id: [own],
                    tls_settings: expect.objectContaining({
                        server_name: "node.example",
                    }),
                }),
            ),
        );
    },
);
it("filters the catalog and preserves sing-box ownership when editing", async () => {
    api.request.mockImplementation(async (path: string) => {
        if(path.endsWith("dictionary/fetch")) return adminPageFixture(path);
        if (path.includes("server/route/fetch"))
            return {
                data: path.includes("backend=v2box")
                    ? [
                          {
                              id: 22,
                              backend: "v2box",
                              remarks: "Native rule",
                              action: "sing_box",
                              sing_box: {
                                  route: {
                                      rules: [
                                          {
                                              action: "reject",
                                              domain_suffix: ["example.test"],
                                          },
                                      ],
                                  },
                              },
                              match: [],
                          },
                      ]
                    : [],
            };
        if (path.endsWith("server/route/save")) return { data: true };
        throw new Error(`Unexpected endpoint: ${path}`);
    });
    render(<ResourcePage resource={resources.routes} />);
    fireEvent.change(screen.getByLabelText("路由内核"), {
        target: { value: "v2box" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByDisplayValue("Native rule"), {
        target: { value: "Edited native rule" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/server/route/save",
            expect.objectContaining({
                id: 22,
                backend: "v2box",
                action: "sing_box",
                remarks: "Edited native rule",
            }),
        ),
    );
});

it.each(["v2node", "v2box"])(
    "converts saved %s through the target save endpoint",
    async (source) => {
        const target = source === "v2node" ? "v2box" : "v2node";
        let converted = false;
        api.request.mockImplementation(async (path: string) => {
        if(path.endsWith("dictionary/fetch")) return adminPageFixture(path);
            if (path.includes("console/nodeSchema"))
                return {
                    data: {
                        name: "required",
                        protocol: "required|in:vless",
                        route_id: "nullable|array",
                        group_id: "required|array",
                    },
                };
            if (path.endsWith("server/group/fetch"))
                return { data: [{ id: 1, name: "Group" }] };
            if (path.endsWith("server/route/fetch")) return { data: [] };
            if (path.endsWith("server/manage/getNodes"))
                return {
                    data: [
                        {
                            id: converted ? 41 : 7,
                            name: "Convert node",
                            type: converted ? target : source,
                            protocol: "vless",
                            group_id: [1],
                            route_id: [],
                            install_command: converted
                                ? "install-new-node"
                                : undefined,
                        },
                    ],
                };
            if (path.endsWith(`/server/${target}/save`)) {
                converted = true;
                return { data: { id: 41, type: target } };
            }
            throw new Error(`Unexpected endpoint: ${path}`);
        });
        render(<Nodes />);
        fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
        await screen.findByDisplayValue("Convert node");
        fireEvent.click(screen.getByRole("button", { name: "转换节点类型…" }));
        vi.spyOn(window, "confirm").mockReturnValue(true);
        fireEvent.change(screen.getByLabelText("节点类型"), {
            target: { value: target },
        });
        await screen.findByDisplayValue("Convert node");
        fireEvent.click(
            await screen.findByRole("button", { name: "确认转换并保存" }),
        );
        await waitFor(() =>
            expect(api.request).toHaveBeenCalledWith(
                `test-admin/server/${target}/save`,
                expect.objectContaining({
                    source_type: source,
                    source_id: 7,
                    route_id: [],
                }),
            ),
        );
        const body = api.request.mock.calls.find(([path]) =>
            path.endsWith(`/server/${target}/save`),
        )![1];
        expect(body.id).toBeUndefined();
        expect(await screen.findByText("install-new-node")).toBeTruthy();
    },
);

it("guides deployment to panel-managed DDNS", async () => {
    api.request.mockImplementation(async (path: string) => {
        if(path.endsWith("dictionary/fetch")) return adminPageFixture(path);
        if (path.includes("server/credentials?")) return { data: { keys: [] } };
        if (path.endsWith("server/ddns/fetch")) return { data: { credentials: [], assignments: [] } };
        if (path.includes("console/nodeSchema")) return { data: {} };
        if (path.endsWith("server/manage/getNodes"))
            return {
                data: [
                    {
                        id: 1,
                        name: "Deploy node",
                        type: "v2box",
                        group_id: [],
                        install_command: "bash install.sh",
                    },
                ],
            };
        return { data: [] };
    });
    render(<Nodes />);
    fireEvent.click(await screen.findByRole("button", { name: "部署与接入" }));
    expect(screen.getByRole("heading", { name: "自动 IP 上报" })).toBeTruthy();
    expect(screen.queryByLabelText("查询服务器 IP 命令")).toBeNull();
    fireEvent.click(screen.getByText("高级：手动安装"));
    expect(
        (
            screen.getByRole("textbox", {
                name: "节点安装命令",
            }) as HTMLTextAreaElement
        ).value,
    ).toBe("bash install.sh");
    fireEvent.click(screen.getByRole("button", { name: "管理域名与 IP 上报" }));
    expect(await screen.findByText("请先在 Cloudflare DDNS 中添加并验证根域名。")).toBeTruthy();
    expect(api.request.mock.calls.some(([path]) => path.endsWith("credentials/deployment"))).toBe(false);
});

it("saves an AnyTLS preset through the real node form", async () => {
    api.request.mockImplementation(async (path: string) => {
        if(path.endsWith("dictionary/fetch")) return adminPageFixture(path);
        if (path.includes("console/nodeSchema"))
            return {
                data: {
                    name: "required",
                    protocol: "required|in:anytls",
                    padding_scheme: "nullable",
                },
            };
        if (path.endsWith("server/manage/getNodes"))
            return {
                data: [
                    {
                        id: 4,
                        name: "AnyTLS node",
                        type: "v2box",
                        protocol: "anytls",
                        group_id: [],
                        padding_scheme: null,
                    },
                ],
            };
        if (path.endsWith("server/v2box/save")) return { data: true };
        return { data: [] };
    });
    render(<Nodes />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.change(
        await screen.findByRole("combobox", { name: /AnyTLS 填充预设/ }),
        { target: { value: "light" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存节点配置" }));
    await waitFor(() =>
        expect(api.request).toHaveBeenCalledWith(
            "test-admin/server/v2box/save",
            expect.objectContaining({
                id: 4,
                padding_scheme: JSON.stringify([
                    "stop=4",
                    "0=30-30",
                    "1=100-250",
                    "2=400-500,c,500-800",
                    "3=9-9,300-600",
                ]),
            }),
        ),
    );
    const saved = api.request.mock.calls.find(([path]) =>
        path.endsWith("server/v2box/save"),
    )![1];
    expect(saved.padding_preset).toBeUndefined();
});

it("filters nodes by name, backend and exhausted server budget", async () => {
    api.request.mockImplementation(async (path: string) => ({
        data: path.endsWith("server/manage/getNodes")
            ? [
                  {
                      id: 31,
                      name: "Budget restricted",
                      type: "v2box",
                      host: "blocked.example",
                      traffic_budget: {
                          usedBytes: 100,
                          limitBytes: 100,
                          blocked: true,
                      },
                      group_id: [],
                  },
                  {
                      id: 32,
                      name: "Legacy healthy",
                      type: "v2node",
                      host: "healthy.example",
                      group_id: [],
                  },
              ]
            : path.includes("console/nodeSchema")
              ? {}
              : [],
    }));
    render(<Nodes />);
    await screen.findByText("Budget restricted");
    fireEvent.change(screen.getByRole("combobox", { name: "筛选节点类型" }), {
        target: { value: "v2box" },
    });
    expect(screen.queryByText("Legacy healthy")).toBeNull();
    fireEvent.click(screen.getByLabelText("仅显示额度受限节点"));
    expect(screen.getByText("Budget restricted")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("搜索节点"), {
        target: { value: "nomatch" },
    });
    expect(screen.queryByText("Budget restricted")).toBeNull();
});

it("opens DDNS inside node management and returns to the node list", async () => {
    render(<Nodes />);
    fireEvent.click(screen.getByRole("button", { name: "Cloudflare DDNS" }));
    expect(await screen.findByText("Cloudflare 凭据")).toBeTruthy();
    expect(screen.queryByLabelText("搜索节点")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "节点列表" }));
    expect(await screen.findByLabelText("搜索节点")).toBeTruthy();
});

it("manages Lightsail and traffic in peer pages without an outer dialog", async () => {
    render(<Nodes />);
    fireEvent.click(screen.getByRole("button", { name: "Lightsail IP" }));
    expect(await screen.findByText("Lightsail 公网 IP 管理")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
        screen
            .getByRole("button", { name: "Lightsail IP" })
            .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "服务器流量" }));
    expect(
        await screen.findByRole("button", { name: "添加服务器额度" }),
    ).toBeTruthy();
    expect(screen.queryByText("Lightsail 公网 IP 管理")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "节点列表" }));
    expect(await screen.findByLabelText("搜索节点")).toBeTruthy();
});

it("creates one-use deployment without a password and copies no permanent credential", async () => {
    const writeText=vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
    api.request.mockImplementation(async (path:string)=> path.endsWith("/deployment") ? {data:{command:"one-use-command",expiresAt:new Date(Date.now()+600000).toISOString()}} : {data:{keys:[],migrated:false}});
    render(<NodeDeployment node={{id:1,type:"v2box",name:"A",install_command:"manual-install",upgrade_command:"wget install-script && sh install-v2box.sh --install v1.0.3"}} close={()=>{}}/>);
    const create=await screen.findByRole("button",{name:"生成一键部署命令"});
    await waitFor(()=>expect((create as HTMLButtonElement).disabled).toBe(false));
    expect(api.request.mock.calls.some(([path])=>path.endsWith("/deployment"))).toBe(false);
    fireEvent.click(create);
    expect(await screen.findByLabelText("一键部署命令")).toHaveProperty("value","one-use-command");
    expect(screen.queryByLabelText("部署操作管理员密码")).toBeNull();
    expect(api.request).toHaveBeenCalledWith(expect.stringContaining("/deployment"),{type:"v2box",id:1});
    fireEvent.click(screen.getByRole("button",{name:"复制部署命令"}));
    await waitFor(()=>expect(writeText).toHaveBeenCalledWith("one-use-command"));
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button",{name:"已有节点升级"}));
    expect((screen.getByLabelText("节点升级命令") as HTMLTextAreaElement).value).toContain("v1.0.3");
    expect(api.request.mock.calls.filter(([path])=>path.endsWith("/deployment"))).toHaveLength(1);
});
it("keeps deployment retryable on error and groups credentials in the same drawer", async () => {
    api.request.mockImplementation(async(path:string)=>{if(path.endsWith("/deployment"))throw new Error("授权失败");return {data:{keys:[],legacyEnabled:false}};});
    render(<NodeDeployment node={{id:1,type:"v2box",name:"A"}} close={()=>{}}/>);
    await waitFor(()=>expect((screen.getByRole("button",{name:"生成一键部署命令"}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button",{name:"生成一键部署命令"}));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent","授权失败");
    expect(screen.queryByLabelText("一键部署命令")).toBeNull();
    fireEvent.mouseDown(screen.getByRole("tab",{name:"凭据管理"}),{button:0,ctrlKey:false});
    expect(await screen.findByRole("button",{name:"生成 / 手动轮换密钥"})).toBeTruthy();
    expect(screen.queryByLabelText("凭据操作管理员密码")).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
});

it("routes child deployment to its parent without issuing a child credential", async () => {
    api.request.mockImplementation(async(path:string)=>{
        if(path.endsWith("dictionary/fetch"))return adminPageFixture(path);
        if(path.endsWith("server/manage/getNodes"))return {data:[{id:1,name:"Parent",type:"v2box",group_id:[]},{id:2,name:"Child",type:"v2box",parent_id:1,group_id:[]}]};
        if(path.includes("server/credentials"))return {data:{keys:[]}};
        return {data:[]};
    });
    render(<Nodes/>);
    fireEvent.click(await screen.findByRole("button",{name:"父节点接入"}));
    expect(await screen.findByText("Parent · 部署与接入")).toBeTruthy();
    expect(api.request.mock.calls.some(([path])=>path.includes("server/credentials") && path.includes("id=1"))).toBe(true);
    expect(screen.queryByRole("button",{name:"安装命令"})).toBeNull();
});

it("uses accessible runtime dots and keeps only the visibility switch", async () => {
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("server/manage/getNodes")) return {data:[
            {id:1,name:"Green",type:"v2box",runtime_status:"online",show:1,group_id:[]},
            {id:2,name:"Red",type:"v2box",runtime_status:"offline",show:0,group_id:[]},
            {id:3,name:"Unknown",type:"v2box",show:0,group_id:[]}
        ]};
        return adminPageFixture(path);
    });
    render(<Nodes />);
    const online = await screen.findByRole("button",{name:"Green：在线，查看运行详情"});
    expect(online.getAttribute("data-state")).toBe("online");
    expect(screen.getByRole("button",{name:"Red：离线，查看运行详情"}).getAttribute("data-state")).toBe("offline");
    expect(screen.getByRole("button",{name:"Unknown：暂无通信记录，查看运行详情"}).getAttribute("data-state")).toBe("unknown");
    expect(screen.queryByRole("button",{name:"切换展示"})).toBeNull();
    expect(screen.getByRole("switch",{name:"Green 显示"})).toBeTruthy();
    fireEvent.click(online);
    expect(await screen.findByRole("dialog")).toBeTruthy();
});

it("prevents duplicate node copies and restores actions after a failed request", async () => {
    let reject!: (reason: Error) => void;
    api.request.mockImplementation((path: string) => {
        if (path.endsWith("/copy")) return new Promise((_, fail) => {reject=fail;});
        if (path.includes("getNodes")) return Promise.resolve({data:[{id:1,name:"Test node",type:"v2box",group_id:[],route_id:[]}]});
        return Promise.resolve(adminPageFixture(path));
    });
    render(<Nodes/>);
    const button = await screen.findByRole("button",{name:"复制"});
    fireEvent.click(button);fireEvent.click(button);
    expect(api.request.mock.calls.filter(([p]) => p.endsWith("/copy"))).toHaveLength(1);
    reject(new Error("复制失败，请重试"));
    await screen.findByText("复制失败，请重试");
    expect((button as HTMLButtonElement).disabled).toBe(false);
});

it("filters actionable nodes separately from maintenance and opens unified details", async () => {
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("dictionary/fetch")) return adminPageFixture(path);
        if (path.endsWith("server/manage/getNodes"))
            return {
                data: [
                    {
                        id: 1,
                        name: "异常节点甲",
                        type: "v2box",
                        issues: ["configuration_failed"],
                        runtime_status: "online",
                    },
                    {
                        id: 2,
                        name: "维护节点乙",
                        type: "v2box",
                        issues: [],
                        maintenance: { active: true },
                    },
                    { id: 3, name: "正常节点丙", type: "v2box", issues: [] },
                ],
            };
        if (path.includes("server/manage/runtime"))
            return {
                data: {
                    configurationState: "provided",
                    applicationState: "failed",
                    errorCode: "core",
                    receiptSupported: true,
                },
            };
        return { data: [] };
    });
    render(<Nodes />);
    await screen.findByRole("button", { name: "异常节点甲" });
    fireEvent.click(screen.getByLabelText("仅显示异常节点"));
    expect(screen.queryByRole("button", { name: "维护节点乙" })).toBeNull();
    expect(screen.queryByRole("button", { name: "正常节点丙" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "异常节点甲" }));
    expect(
        await screen.findByRole("dialog", { name: "节点详情 · 异常节点甲" }),
    ).toBeTruthy();
    expect(await screen.findByText("内核配置校验失败")).toBeTruthy();
});
