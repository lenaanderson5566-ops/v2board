import { nodeConfigurationProblems, nodeChangeImpact, nodeDeploymentStage } from "./node-guidance";
import { nodeSetupFields, nodeSetupPayload } from "./node-setup";
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
import { Infrastructure } from "./Infrastructure";
import { AdminDDNS } from "./AdminDDNS";
import { Nodes, ResourcePage, resources } from "./admin";
import { NodeCredentials } from "./NodeCredentials";
import { NodeDeployment } from "./NodeDeployment";
import { NodeConnectionEditor } from "./NodeConnections";
import { NodeTopology } from "./NodeTopology";
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    history.replaceState(null,"",location.pathname);
});

it("previews a shared TLS identity independently of the relay hostname", () => {
    const service={ name: "Japan", protocol:"anytls", server_port:9443, tls:1, tls_settings:{server_name:"identity.example.test"} };
    const view=render(<NodeTopology service={service} entry={{domain:"entry.example.test"}} origin={{domain:"origin.example.test"}} port={443} shared={3} />);
    expect(screen.getByText("待保存预览")).toBeTruthy();
    expect(screen.getByText("entry.example.test:443")).toBeTruthy();
    expect(screen.getByText("origin.example.test:9443")).toBeTruthy();
    expect(screen.getByText(/identity.example.test/)).toBeTruthy();
    expect(screen.getByText(/关联 3 条线路/)).toBeTruthy();
    view.rerender(<NodeTopology service={service} origin={{domain:"origin.example.test"}} port={9443} />);
    expect(screen.queryByText("入口转发")).toBeNull();
    expect(screen.getByText("直连地址")).toBeTruthy();
});

it("requires saved configuration and explicit connection confirmation before publishing", async () => {
    const node={id:20,type:"v2box",service_id:1,name:"Relay",host:"old.example.test",port:443};
    const service={id:1,type:"v2box",name:"Japan",protocol:"anytls",server_port:9443,tls:1,group_id:[1],tls_settings:{server_name:"identity.example.test"}};
    const draft={name:"Relay",service_id:1,entry_id:3,entry_port:443,group_id:[1],show:1};
    const plan={entry_id:3,entry_family:"ipv4",origin_family:"ipv4",origin_domain:"origin.example.test",origin_port:9443,protocol:"anytls",port:443,dns_ready:true,proof:"a".repeat(64)};
    api.request.mockImplementation(async (path:string) => {
        if(path.includes("ddns/fetch")) return {data:{servers:[],assignments:[{id:2,node_type:"v2box",node_id:1,domain:"origin.example.test"},{id:3,purpose:"entry",enabled:true,domain:"entry.example.test"}]}};
        if(path.includes("connections/fetch")) return {data:{id:5,revision:2,draft,plan,published:{host:node.host},current:{host:node.host,port:443}}};
        if(path.includes("connections/publish")) throw new Error("配置或解析状态已变化");
        return {data:true};
    });
    render(<NodeConnectionEditor node={node} nodes={[service,node]} close={()=>{}} onSaved={()=>{}} />);
    const publish=await screen.findByRole("button",{name:"确认并发布线路"});
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", {name:/已使用上述地址/}));
    expect((publish as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(publish);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent","配置或解析状态已变化");
    expect(screen.getByText(/当前发布地址：old.example.test:443/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("入口端口"),{target:{value:"8443"}});
    expect(screen.queryByRole("button",{name:"确认并发布线路"})).toBeNull();
    expect(screen.getByText("待保存预览")).toBeTruthy();
    expect(api.request.mock.calls.filter(([p])=>String(p).includes("connections/publish"))).toHaveLength(1);
});
it("refreshes deployment state until the current configuration is applied, then stops", async () => {
    let ready=false;
    api.request.mockImplementation(async (path:string)=>path.includes("manage/runtime") ? {data:{runtimeStatus:ready?"online":"unknown",applicationState:ready?"applied":"unconfirmed"}} : path.includes("ddns/fetch") ? {data:{assignments:[]}} : {data:{keys:ready?[{status:"active",lastUsedAt:"2026-10-23T00:00:00Z"}]:[]}});
    vi.useFakeTimers();
    vi.spyOn(document,"visibilityState","get").mockReturnValue("visible");
    let view!:ReturnType<typeof render>;
    await act(async()=>{view=render(<NodeDeployment node={{id:1,type:"v2box",name:"Node"}} close={()=>{}}/>);});
    expect(screen.getByText("独立凭据尚未认证")).toBeTruthy();
    ready=true;
    await act(()=>vi.advanceTimersByTimeAsync(15000));
    expect(screen.getByText("服务运行正常")).toBeTruthy();
    expect(screen.getByText("独立凭据已认证")).toBeTruthy();
    const calls=api.request.mock.calls.length;
    await act(()=>vi.advanceTimersByTimeAsync(60000));
    expect(api.request).toHaveBeenCalledTimes(calls);
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
        if(path.endsWith("server/ddns/fetch")) return {data:{assignments:[],servers:[],credentials:[]}};
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
        render(<Nodes/>);
        fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
        fireEvent.click(screen.getByRole("button",{name:"协议与证书"}));
        await screen.findByText(/此处维护协议、监听和证书/);
        expect(screen.queryByDisplayValue("Saved node")).toBeNull();
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
        fireEvent.click(screen.getByRole("button", { name: "保存节点配置" }));
        await waitFor(() =>
            expect(api.request).toHaveBeenCalledWith(
                `test-admin/server/${backend}/save`,
                expect.objectContaining({
                    id: 7,
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
        if(path.endsWith("server/ddns/fetch")) return {data:{assignments:[],servers:[],credentials:[]}};
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
        if(path.endsWith("server/ddns/fetch")) return {data:{assignments:[],servers:[],credentials:[]}};
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
        render(<Nodes/>);
        fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
        fireEvent.click(screen.getByRole("button",{name:"协议与证书"}));
        await screen.findByText(/此处维护协议、监听和证书/);
        fireEvent.click(screen.getByRole("button", { name: "转换节点类型…" }));
        vi.spyOn(window, "confirm").mockReturnValue(true);
        fireEvent.change(screen.getByLabelText("节点类型"), {
            target: { value: target },
        });
        await screen.findByText(/此处维护协议、监听和证书/);
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
    render(<Nodes/>);
    fireEvent.click(await screen.findByRole("button",{name:"编辑"}));
    fireEvent.click(screen.getByRole("button",{name:"部署与状态"}));
    expect(screen.queryByRole("heading", { name: "自动 IP 上报" })).toBeNull();
    expect(screen.getByText("运维命令与说明")).toBeTruthy();
    expect(screen.getByText("v2box update")).toBeTruthy();
    expect(screen.getByText("v2box uninstall --stop-network")).toBeTruthy();
    expect(screen.queryByLabelText("查询服务器 IP 命令")).toBeNull();
    fireEvent.click(screen.getByText("高级：手动安装"));
    expect(
        (
            screen.getByRole("textbox", {
                name: "节点安装命令",
            }) as HTMLTextAreaElement
        ).value,
    ).toBe("bash install.sh");
    expect(screen.queryByRole("tab", { name: "域名与解析" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "连接与域名" }));
    expect(await screen.findByText("请先在 域名与解析 中添加并验证根域名。")).toBeTruthy();
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
    render(<Nodes/>);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button",{name:"协议与证书"}));
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
    render(<Nodes/>);
    await screen.findByText("Budget restricted");
    fireEvent.change(screen.getByRole("combobox", { name: "筛选节点类型" }), {
        target: { value: "v2box" },
    });
    expect(screen.queryByText("Legacy healthy")).toBeNull();
    fireEvent.click(screen.getByLabelText("仅显示额度受限服务"));
    expect(screen.getByText("Budget restricted")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("搜索节点"), {
        target: { value: "nomatch" },
    });
    expect(screen.queryByText("Budget restricted")).toBeNull();
});

it("keeps infrastructure management separate from the node list", async () => {
    render(<Nodes />);
    expect(await screen.findByLabelText("搜索节点")).toBeTruthy();
    expect(screen.getByRole("link", {name:"服务器管理"}).getAttribute("href")).toBe("#/servers");
    expect(screen.getByRole("link", {name:"域名与解析"}).getAttribute("href")).toBe("#/node-domains");
    expect(api.request.mock.calls.some(([path])=>String(path).includes("ddns/events"))).toBe(false);
    expect(screen.queryByText("Cloudflare 凭据")).toBeNull();
});
it("loads server pages independently without node-list or domain-event queries", async () => {
    const view=render(<Infrastructure />);
    expect(await screen.findByRole("button",{name:"添加服务器"})).toBeTruthy();
    expect(api.request.mock.calls.some(([path])=>String(path).includes("getNodes") || String(path).includes("ddns/events"))).toBe(false);
    view.rerender(<Infrastructure section="server-lightsail" />);
    expect(await screen.findByText("Lightsail 公网 IP 管理")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<Infrastructure />);
    expect(await screen.findByRole("button",{name:"添加服务器"})).toBeTruthy();
    expect(screen.queryByRole("tab",{name:"流量额度"})).toBeNull();
    expect(screen.queryByText("Lightsail 公网 IP 管理")).toBeNull();
});
it("keeps server actions out of domain credential management", async () => {
    render(<AdminDDNS />);
    expect(await screen.findByText("Cloudflare 凭据")).toBeTruthy();
    expect(screen.queryByRole("button",{name:"添加服务器"})).toBeNull();
});

it("creates one-use deployment without a password and copies no permanent credential", async () => {
    const writeText=vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
    api.request.mockImplementation(async (path:string)=> path.endsWith("/deployment") ? {data:{command:"one-use-command",expiresAt:new Date(Date.now()+600000).toISOString()}} : {data:{keys:[],migrated:false}});
    render(<NodeDeployment node={{id:1,type:"v2box",name:"A",install_command:"manual-install",upgrade_command:"wget install-script && sh install-v2box.sh --install v1.0.5"}} close={()=>{}}/>);
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
    expect((screen.getByLabelText("节点升级命令") as HTMLTextAreaElement).value).toContain("v1.0.5");
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

it("links reused lines to their owning service without offering child deployment", async () => {
    api.request.mockImplementation(async(path:string)=>path.endsWith("dictionary/fetch")?adminPageFixture(path):path.endsWith("server/manage/getNodes")?{data:[{id:1,name:"Parent",type:"v2box",group_id:[]},{id:2,name:"Child",type:"v2box",service_id:1,group_id:[]}]}:{data:[]});
    render(<Nodes/>);await screen.findByRole("button",{name:"Child"});
    expect(screen.queryByRole("button",{name:"代理服务接入"})).toBeNull();
    expect(screen.queryByRole("button",{name:"部署与接入"})).toBeNull();
    expect(screen.getAllByRole("button",{name:"Parent"})).toHaveLength(2);
    expect(api.request.mock.calls.some(([path])=>String(path).includes("server/credentials"))).toBe(false);
});

it("shows runtime dots in services without subscription visibility controls", async () => {
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("server/manage/getNodes")) return {data:[
            {id:1,name:"Green",type:"v2box",runtime_status:"online",show:1,group_id:[]},
            {id:2,name:"Red",type:"v2box",runtime_status:"offline",show:0,group_id:[]},
            {id:3,name:"Unknown",type:"v2box",show:0,group_id:[]}
        ]};
        return adminPageFixture(path);
    });
    render(<Nodes/>);
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
    fireEvent.click(await screen.findByRole("button",{name:"更多操作"}));
    const button = await screen.findByRole("button",{name:"复制节点"});
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
    render(<Nodes/>);
    await screen.findByRole("button", { name: "异常节点甲" });
    fireEvent.click(screen.getByLabelText("仅显示异常服务"));
    expect(screen.queryByRole("button", { name: "维护节点乙" })).toBeNull();
    expect(screen.queryByRole("button", { name: "正常节点丙" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "异常节点甲" }));
    expect(
        await screen.findByRole("dialog", { name: "节点详情 · 异常节点甲" }),
    ).toBeTruthy();
    expect(await screen.findByText("内核配置校验失败")).toBeTruthy();
});


it("creates a direct node and its domain in one save without a separate server form", async () => {
    let saved = false;
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("dictionary/fetch")) return adminPageFixture(path);
        if (path.includes("console/nodeSchema")) return { data: {name:"required",host:"required",port:"required",server_port:"required",protocol:"required|in:vless",tls:"required|in:0,1,2",network:"required|in:tcp",group_id:"nullable|array",rate:"required"} };
        if (path.endsWith("server/ddns/fetch")) return { data: {credentials:[{id:9,root_domain:"example.test",next_run:0}],servers:[{id:5,name:"Existing machine",enabled:true,family:"ipv4"}],assignments:[]} };
        if (path.endsWith("server/manage/getNodes")) return {data:saved ? [{id:99,type:"v2box",name:"Japan",host:"jp.example.test",port:443,protocol:"vless"}] : []};
        if (path.endsWith("server/v2box/save")) { saved=true;return {data:{id:99,type:"v2box"}}; }
        if (path.endsWith("server/group/fetch")) return {data:[{id:1,name:"Default group"}]};
        if (path.endsWith("server/route/fetch")) return {data:[]};
        if (path.includes("credentials/fetch")) return {data:{keys:[]}};
        return {data:{}};
    });
    render(<Nodes />);
    fireEvent.click(await screen.findByRole("button",{name:"新增节点"}));
    await screen.findByRole("combobox",{name:/^根域名/});
    expect(screen.queryByRole("textbox",{name:"连接主机"})).toBeNull();
    expect(screen.getAllByRole("spinbutton",{name:"监听端口"})).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox",{name:/节点名称/}),{target:{value:"Japan"}});
    fireEvent.change(screen.getByRole("combobox",{name:/^根域名/}),{target:{value:"9"}});
    fireEvent.change(screen.getByRole("textbox",{name:/^子域名前缀/}),{target:{value:"jp"}});
    fireEvent.click(within(screen.getByRole("group",{name:"权限组"})).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button",{name:"保存节点配置"}));
    await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/server/v2box/save",expect.objectContaining({server_port:443,deployment_setup:{credential_id:9,prefix:"jp",family:"ipv4",server_id:null}})));
    expect(api.request.mock.calls.some(([path])=>String(path).endsWith("domains/bind") || String(path).endsWith("network/save"))).toBe(false);
    await screen.findByText("新节点安装");
    expect(api.request.mock.calls.some(([path])=>String(path).endsWith("credentials/deployment"))).toBe(false);
});

it("creates a relay node in one save with separate ingress and origin fields", async () => {
    let saved = false;
    api.request.mockImplementation(async (path: string) => {
        if (path.endsWith("dictionary/fetch")) return adminPageFixture(path);
        if (path.includes("console/nodeSchema")) return { data: {name:"required",host:"required",port:"required",server_port:"required",protocol:"required|in:vless",tls:"required|in:0,1,2",network:"required|in:tcp",group_id:"nullable|array",rate:"required"} };
        if (path.endsWith("server/ddns/fetch")) return { data: {credentials:[{id:9,root_domain:"example.test",next_run:0}],servers:[{id:5,name:"Existing machine",enabled:true,family:"ipv4"}],assignments:[{id:17,purpose:"entry",domain:"entry.example.test",enabled:true,server_id:5}]} };
        if (path.endsWith("server/manage/getNodes")) return {data:saved ? [{id:99,type:"v2box",name:"Japan",host:"jp.example.test",port:443,protocol:"vless"}] : []};
        if (path.endsWith("server/v2box/save")) { saved=true;return {data:{id:99,type:"v2box"}}; }
        if (path.endsWith("server/group/fetch")) return {data:[{id:1,name:"Default group"}]};
        if (path.endsWith("server/route/fetch")) return {data:[]};
        if (path.includes("credentials/fetch")) return {data:{keys:[]}};
        return {data:{}};
    });
    render(<Nodes />);
    fireEvent.click(await screen.findByRole("button",{name:"新增节点"}));
    await screen.findByRole("combobox",{name:/^根域名/});
    expect(screen.queryByRole("textbox",{name:"连接主机"})).toBeNull();
    fireEvent.change(screen.getByRole("combobox",{name:/^接入方式/}),{target:{value:"relay"}});
    expect(screen.getByRole("spinbutton",{name:/^监听端口/})).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox",{name:/^入口域名/}),{target:{value:"17"}});
    fireEvent.change(screen.getByRole("spinbutton",{name:/^入口端口/}),{target:{value:"8443"}});
    fireEvent.change(screen.getByRole("textbox",{name:/节点名称/}),{target:{value:"Japan"}});
    fireEvent.change(screen.getByRole("combobox",{name:/^回源根域名/}),{target:{value:"9"}});
    fireEvent.change(screen.getByRole("textbox",{name:/^子域名前缀/}),{target:{value:"jp"}});
    fireEvent.click(within(screen.getByRole("group",{name:"权限组"})).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button",{name:"保存节点配置"}));
    await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/server/v2box/save",expect.objectContaining({server_port:443,deployment_setup:{credential_id:9,prefix:"jp",family:"ipv4",server_id:null,entry_id:17,entry_port:8443}})));
    expect(api.request.mock.calls.some(([path])=>String(path).endsWith("domains/bind") || String(path).endsWith("network/save"))).toBe(false);
    await screen.findByText("新节点安装");
    expect(api.request.mock.calls.some(([path])=>String(path).endsWith("credentials/deployment"))).toBe(false);
});

it("keeps manual addresses and Reality SNI available while offering server reuse", () => {
    const fields=[{key:"host",label:"连接主机"},{key:"port",label:"连接端口"},{key:"server_port",label:"监听端口"},{key:"tls_settings.server_name",label:"SNI"}];
    const network={credentials:[{id:1,root_domain:"example.test",next_run:0}],servers:[{id:5,name:"Shared",enabled:true,family:"ipv4"},{id:6,name:"Wrong family",enabled:true,family:"ipv6"}]};
    const managed=nodeSetupFields(fields,{setup_mode:"managed",setup_family:"ipv4",tls:1},network);
    expect(managed.map(f=>f.key)).not.toContain("host");
    expect(managed.map(f=>f.key)).not.toContain("tls_settings.server_name");
    expect(managed.find(f=>f.key==="setup_server_id")?.options?.map(o=>o[0])).toEqual(["","5"]);
    expect(nodeSetupFields(fields,{setup_mode:"managed",tls:2},network).map(f=>f.key)).toContain("tls_settings.server_name");
    expect(nodeSetupFields(fields,{setup_mode:"manual"},network).map(f=>f.key)).toContain("host");
    expect(nodeSetupPayload({setup_mode:"manual"})).toBeUndefined();
    expect(nodeSetupPayload({setup_mode:"managed",setup_credential_id:"1",setup_server_id:"5",setup_family:"ipv4"})).toEqual({credential_id:1,server_id:5,family:"ipv4",prefix:""});
});

it("collects actionable configuration errors and keeps secret values out of impact summaries",()=>{
    const problems=nodeConfigurationProblems({name:"",group_id:[],server_port:80,protocol:"anytls",network:"ws",tls:1,setup_mode:"managed",setup_prefix:"bad.prefix","tls_settings.cert_mode":"dns"},"v2box");
    expect(problems.map(p=>p.key)).toEqual(expect.arrayContaining(["name","group_id","setup_credential_id","setup_prefix","network","tls_settings.provider","tls_settings.dns_env"]));
    const original={protocol:"vless",server_port:443,route_id:[1],tls:1,tls_settings:{cert_mode:"http",server_name:"node.example.test",dns_env:"secret-before"}};
    expect(nodeChangeImpact(original,{...original,server_port:"443",route_id:["1"],tls_settings:{...original.tls_settings,allow_insecure:0,fingerprint:"chrome"}})).toEqual([]);
    const impact=nodeChangeImpact(original,{...original,server_port:9443,tls_settings:{...original.tls_settings,dns_env:"secret-after"}});
    expect(impact).toEqual(["监听","TLS 与证书"]);
    expect(JSON.stringify(impact)).not.toContain("secret");
});
it("distinguishes configuration errors, DNS progress and confirmed runtime",()=>{
    const node={id:1,type:"v2box",host:"new.example.test",tls:1};
    expect(nodeDeploymentStage(node,{applicationState:"failed"},undefined,true)).toMatchObject({title:"配置应用失败",target:"logs",terminal:true});
    expect(nodeDeploymentStage(node,{runtimeStatus:"online",applicationState:"unconfirmed"},undefined,true).title).toBe("等待配置应用确认");
    expect(nodeDeploymentStage(node,{runtimeStatus:"online",applicationState:"applied"},undefined,true).title).toBe("服务运行正常");
    expect(nodeDeploymentStage(node,{}, {enabled:true,managed:true,family:"ipv4",status:"awaiting_report"},false).title).toBe("等待服务器 IP 上报");
    expect(nodeDeploymentStage(node,{runtimeStatus:"offline"},undefined,true)).toMatchObject({title:"节点通信中断",terminal:true});
    expect(nodeDeploymentStage(node,{runtimeStatus:"online",applicationState:"applied"},{managed:false,family:"ipv4"},true).title).toBe("服务运行正常");
    expect(nodeDeploymentStage(node,{runtimeStatus:"online",applicationState:"applied"},{managed:true,enabled:false,family:"ipv4"},true)).toMatchObject({target:"domain",terminal:true});
    expect(nodeDeploymentStage({...node,type:"v2node"},{runtimeStatus:"online",configurationState:"provided"},undefined,true).title).toBe("节点已接入，待实际验证");
    expect(nodeDeploymentStage(node,{runtimeStatus:"online",receiptSupported:false},undefined,true).target).toBe("upgrade");
});
it("pauses deployment polling after five minutes and stops while hidden",async()=>{
    api.request.mockImplementation(async(path:string)=>path.includes("manage/runtime")?{data:{runtimeStatus:"unknown",applicationState:"unconfirmed"}}:{data:{keys:[],assignments:[]}});
    vi.useFakeTimers();
    const visible=vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
    await act(async()=>{render(<NodeDeployment node={{id:1,type:"v2box",name:"Node"}} close={()=>{}}/>);});
    const calls=api.request.mock.calls.length;
    await act(()=>vi.advanceTimersByTimeAsync(30000));
    expect(api.request).toHaveBeenCalledTimes(calls);
    visible.mockReturnValue("visible");
    await act(()=>vi.advanceTimersByTimeAsync(300000));
    expect(screen.getByText(/已暂停自动检查/)).toBeTruthy();
    const pausedCalls=api.request.mock.calls.length;
    await act(()=>vi.advanceTimersByTimeAsync(60000));
    expect(api.request).toHaveBeenCalledTimes(pausedCalls);
});

it("keeps sensitive node changes in the form when confirmation is cancelled",async()=>{
    const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    api.request.mockImplementation(async(path:string)=>{
        if(path.endsWith("dictionary/fetch")) return adminPageFixture(path);
        if(path.includes("nodeSchema")) return {data:{name:"required",protocol:"required|in:vless",server_port:"required",tls:"required|in:0,1,2",network:"required|in:tcp"}};
        if(path.endsWith("getNodes")) return {data:[{id:7,type:"v2box",name:"Primary",protocol:"vless",server_port:443,tls:0,network:"tcp"},{id:8,type:"v2box",service_id:7,name:"Relay",protocol:"vless"}]};
        if(path.endsWith("group/fetch") || path.endsWith("route/fetch")) return {data:[]};
        return {data:{servers:[],assignments:[]}};
    });
    render(<Nodes/>);
    fireEvent.click((await screen.findAllByRole("button",{name:"编辑"}))[0]);
    fireEvent.click(screen.getByRole("button",{name:"协议与证书"}));
    const port=await screen.findByRole("spinbutton",{name:/监听端口/});
    fireEvent.change(port,{target:{value:"9443"}});
    expect(screen.getByLabelText("变更影响").textContent).toContain("1 条关联线路");
    fireEvent.click(screen.getByRole("button",{name:"保存节点配置"}));
    await screen.findByText("已取消保存，修改仍保留在表单中。");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("监听"));
    expect(api.request.mock.calls.some(([path])=>String(path).endsWith("v2box/save"))).toBe(false);
    expect(port).toHaveProperty("value","9443");
});

function unifiedCreationFixture(empty=false) {
    let saved: Record<string, any> | null=null;
    const services=empty?[]:[{id:1,type:"v2box",name:"Box service",protocol:"anytls",server_port:9443,group_id:[7]},{id:1,type:"v2node",name:"Xray service",protocol:"vless",server_port:8443,group_id:[7]}];
    api.request.mockImplementation(async(path:string,body?:Record<string, any>)=>{
        if(path.endsWith("dictionary/fetch"))return adminPageFixture(path);
        if(path.endsWith("server/manage/getNodes"))return {data:[...services,...(saved?[{id:99,type:saved.type,service_id:saved.service_id,name:saved.name,group_id:saved.group_id}]:[])]};
        if(path.endsWith("server/group/fetch"))return {data:[{id:7,name:"Subscribers"}]};
        if(path.includes("console/nodeSchema"))return {data:{name:"required",host:"required",port:"required",server_port:"required",protocol:"required|in:vless,anytls",tls:"required|in:0,1",group_id:"nullable|array"}};
        if(path.endsWith("server/ddns/fetch"))return {data:{servers:[],credentials:[],assignments:[{id:2,node_type:"v2box",node_id:1,domain:"box.example.test"},{id:3,node_type:"v2node",node_id:1,domain:"xray.example.test"}]}};
        if(path.endsWith("connections/save")){saved=body || {};return {data:{id:99}};}
        if(path.includes("connections/fetch"))return {data:{id:99,revision:1,draft:saved,plan:{dns_ready:false},published:null}};
        return {data:[]};
    });
}
it("keeps node creation canonical and links service operations back to it",async()=>{
    unifiedCreationFixture();const view=render(<Nodes/>);
    expect(screen.queryByRole("button",{name:"复用服务新增线路"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"新增节点"}));
    expect(screen.getByRole("button",{name:"为现有节点添加连接线路"}).closest("details")?.open).toBe(false);
    expect(screen.getByText("高级：共用现有节点的服务").closest("details")?.open).toBe(false);
    expect(await screen.findByRole("combobox",{name:"节点类型"})).toBeTruthy();
    expect(screen.queryByRole("button",{name:"新增代理服务"})).toBeNull();
    view.unmount();render(<Nodes/>);
    expect(screen.getByRole("button",{name:"新增节点"})).toBeTruthy();
    expect(screen.queryByRole("link",{name:"前往新增节点"})).toBeNull();
});
it.each(["v2box","v2node"])("creates a reused %s route in one drawer without deploying another service",async backend=>{
    unifiedCreationFixture();render(<Nodes/>);
    await screen.findByText("Box service");
    fireEvent.click(screen.getByRole("button",{name:"新增节点"}));
    fireEvent.click(screen.getByText("高级：共用现有节点的服务"));fireEvent.click(screen.getByRole("button",{name:"为现有节点添加连接线路"}));
    const serviceSelect=await screen.findByRole("combobox",{name:"代理服务"});
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByLabelText("节点类型")).toBeNull();expect(screen.queryByLabelText("服务内核")).toBeNull();
    expect(screen.queryByRole("button",{name:"保存节点配置"})).toBeNull();
    fireEvent.change(serviceSelect,{target:{value:`${backend}:1`}});
    fireEvent.change(screen.getByLabelText("节点名称"),{target:{value:"Additional route"}});
    fireEvent.click(screen.getByRole("button",{name:"保存待发布配置"}));
    await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/server/connections/save",expect.objectContaining({type:backend,service_id:1,name:"Additional route",group_id:[7]})));
    await screen.findByText(/当前发布地址：尚未发布/);
    expect(screen.queryByRole("button",{name:"独立部署新节点"})).toBeNull();
    expect(screen.getByRole("button",{name:"协议与证书"})).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(api.request.mock.calls.some(([path])=>String(path).endsWith("server/v2box/save") || String(path).endsWith("server/v2node/save") || String(path).includes("credentials/deployment") || String(path).endsWith("connections/publish"))).toBe(false);
});
it("protects the reused route draft when switching creation methods",async()=>{
    unifiedCreationFixture();const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);render(<Nodes/>);
    fireEvent.click(screen.getByRole("button",{name:"新增节点"}));fireEvent.click(screen.getByText("高级：共用现有节点的服务"));fireEvent.click(screen.getByRole("button",{name:"为现有节点添加连接线路"}));
    fireEvent.change(await screen.findByLabelText("节点名称"),{target:{value:"Unsaved route"}});
    fireEvent.click(screen.getByRole("button",{name:"独立部署新节点"}));
    expect(confirm).toHaveBeenCalled();expect(screen.getByLabelText("节点名称")).toHaveProperty("value","Unsaved route");
    confirm.mockReturnValue(true);fireEvent.click(screen.getByRole("button",{name:"独立部署新节点"}));
    expect(await screen.findByRole("combobox",{name:"节点类型"})).toBeTruthy();expect(screen.getByLabelText("节点名称")).toHaveProperty("value","");
});
it("explains when no existing service can be reused and keeps saving disabled",async()=>{
    unifiedCreationFixture(true);render(<Nodes/>);fireEvent.click(screen.getByRole("button",{name:"新增节点"}));fireEvent.click(screen.getByText("高级：共用现有节点的服务"));fireEvent.click(screen.getByRole("button",{name:"为现有节点添加连接线路"}));
    expect(await screen.findByText("暂无可共用服务的节点，请选择“独立部署新节点”。")).toBeTruthy();
    expect(screen.getByRole("button",{name:"保存待发布配置"})).toHaveProperty("disabled",true);
});

it("does not silently save a direct route when relay has no usable entry",async()=>{
    unifiedCreationFixture();render(<Nodes/>);await screen.findByText("Box service");
    fireEvent.click(screen.getByRole("button",{name:"新增节点"}));fireEvent.click(screen.getByText("高级：共用现有节点的服务"));fireEvent.click(screen.getByRole("button",{name:"为现有节点添加连接线路"}));
    fireEvent.change(await screen.findByLabelText("代理服务"),{target:{value:"v2box:1"}});
    fireEvent.change(screen.getByLabelText("节点名称"),{target:{value:"Relay"}});
    fireEvent.change(screen.getByLabelText("连接方式"),{target:{value:"relay"}});
    expect(screen.getByRole("button",{name:"保存待发布配置"})).toHaveProperty("disabled",true);
    expect(screen.getByText(/中添加可用的入口域名/)).toBeTruthy();
    expect(api.request.mock.calls.some(([path])=>String(path).endsWith("connections/save"))).toBe(false);
});

it("preflights relay TLS, entry availability and separate physical servers",()=>{
    const network={servers:[{id:5,enabled:true,family:"ipv4"}],assignments:[{id:17,purpose:"entry",enabled:true,server_id:5,domain:"entry.example.test"}]};
    const values={setup_mode:"managed",setup_access_mode:"relay",setup_credential_id:1,setup_entry_id:17,setup_entry_port:8443,setup_server_id:5,setup_family:"ipv4",tls:1,"tls_settings.cert_mode":"http"};
    expect(nodeConfigurationProblems(values,"v2box",network).map(p=>p.key)).toEqual(expect.arrayContaining(["setup_server_id","tls_settings.cert_mode"]));
    const fields=nodeSetupFields([],{...values,setup_server_id:""},network);
    expect(fields.find(f=>f.key==="setup_server_id")?.options?.map(([id])=>id)).toEqual([""]);
    expect(nodeSetupPayload({...values,setup_access_mode:"direct"})).not.toHaveProperty("entry_id");
    expect(nodeConfigurationProblems({...values,setup_entry_id:"",setup_entry_port:70000},"v2box",network).map(p=>p.key)).toEqual(expect.arrayContaining(["setup_entry_id","setup_entry_port"]));
    expect(nodeSetupFields([],values,network,"v2node").map(f=>f.key)).not.toContain("setup_access_mode");
});

it("keeps a ready proxy service distinct from an unverified forwarding path",()=>{
    const now=Date.now()/1000;
    const binding={managed:true,enabled:true,entry_id:7,entry_ready:true,domain:"origin.example.test",connection_domain:"entry.example.test",published_domain:"entry.example.test",entry_port:443,published_port:443,family:"ipv4",ipv4:"8.8.8.8",ipv4_seen_at:now,last_success:now,status:"healthy"};
    const stage=nodeDeploymentStage({type:"v2box"},{runtimeStatus:"online",applicationState:"applied"},binding,true);
    expect(stage.title).toBe("代理服务已就绪，待验证入口转发");expect(stage.target).toBe("domain");
    expect(nodeDeploymentStage({type:"v2box"},{runtimeStatus:"online",applicationState:"applied"},{...binding,relay_verified_at:now},true).title).toBe("服务运行正常");
});

it("opens domain and forwarding settings directly from an ingress action",async()=>{
    api.request.mockResolvedValue({data:{credentials:[],assignments:[],keys:[]}});
    render(<NodeDeployment node={{id:1,type:"v2box",name:"Relay",_focusDomain:true}} close={()=>{}}/>);
    expect(await screen.findByText("设置节点域名")).toBeTruthy();
    expect(screen.queryByRole("button",{name:"生成一键部署命令"})).toBeNull();
    expect(api.request.mock.calls.some(([path])=>String(path).endsWith("credentials/deployment"))).toBe(false);
});

function responsibilityFixture(){
    api.request.mockImplementation(async(path:string)=>path.endsWith("server/manage/getNodes")?{data:[
        {id:1,type:"v2box",name:"Box service",protocol:"anytls",server_port:9443,host:"box.example.test",port:443,show:1,group_id:[1],runtime_status:"online",online:5},
        {id:1,type:"v2node",name:"Xray service",protocol:"vless",server_port:8443,host:"xray.example.test",port:443,show:0,group_id:[1]},
        {id:2,type:"v2box",service_id:1,name:"Shared route",host:"entry.example.test",port:8443,show:1,group_id:[1],runtime_status:"online",online:5}
    ]}:String(path).includes("server/credentials")?{data:{keys:[]}}:path.endsWith("server/group/fetch")?{data:[{id:1,name:"Basic"}]}:path.endsWith("dictionary/fetch")?adminPageFixture(path):{data:[]});
}
it("uses one node list with line, shared service and deployment sections",async()=>{
    responsibilityFixture();render(<Nodes/>);await screen.findByRole("button",{name:"Shared route"});
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(screen.getAllByRole("button",{name:"编辑"})).toHaveLength(3);
    expect(screen.getByRole("columnheader",{name:"运行状态"})).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button",{name:"更多操作"})[0]);
    expect(screen.getByRole("button",{name:"删除节点"})).toHaveProperty("disabled",true);
    fireEvent.click(screen.getAllByRole("button",{name:"编辑"})[2]);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button",{name:"协议与证书"}));
    expect(await screen.findByText("代理服务关联节点（2 个）")).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("节点服务：V2Box / sing-box")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"部署与状态"}));
    expect(await screen.findByText(/V2BOX · 节点 #1/)).toBeTruthy();
    expect(api.request.mock.calls.some(([path])=>String(path).includes("server/credentials?type=v2box&id=2"))).toBe(false);
});
it("opens backend-specific service configuration from the unified node URL",async()=>{
    responsibilityFixture();history.replaceState(null,"",`${location.pathname}#/nodes?service=v2node%3A1`);
    render(<Nodes/>);expect(await screen.findByText("节点服务：V2Node / Xray")).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("button",{name:"节点信息"})).toBeTruthy();
});
it("preserves node column choices in the unified list",async()=>{
    responsibilityFixture();localStorage.setItem("admin.nodes.columns.v1",JSON.stringify(["name","show"]));
    render(<Nodes/>);await screen.findByRole("button",{name:"Shared route"});
    expect(screen.queryByRole("columnheader",{name:"权限组"})).toBeNull();
    expect(localStorage.getItem("admin.nodes.columns.v1")).toBe(JSON.stringify(["name","show"]));
});

import { DefaultNodeLineEditor } from "./DefaultNodeLineEditor";
function defaultEditorFixture(sharedLines=0){
    api.request.mockImplementation(async(path:string)=>String(path).includes("connections/default")?{data:{values:{name:"Default JP",group_id:[1],rate:1,region_code:null,city_code:null,display_label:null,tags:[]},revision:"a".repeat(64),sharedLines}}:{data:[]});
}
it("updates default line metadata through a narrow PATCH without submitting service settings",async()=>{
    defaultEditorFixture();const close=vi.fn();render(<DefaultNodeLineEditor node={{type:"v2box",id:3,name:"Default JP"}} groups={[{id:1,name:"Basic"}]} close={close} onSaved={()=>{}}/>);
    fireEvent.change(await screen.findByLabelText("节点名称"),{target:{value:"JP Premium"}});
    fireEvent.change(screen.getByLabelText(/^计费倍率/),{target:{value:"1.5"}});
    for(const name of [/TLS/,/协议/,/监听端口/])expect(screen.queryByRole("combobox",{name})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"保存节点信息"}));
    await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/server/connections/default",expect.objectContaining({id:3,type:"v2box",name:"JP Premium",rate:1.5,group_id:[1],revision:"a".repeat(64)}),{method:"PATCH"}));
    const body=api.request.mock.calls.find(([,body])=>body?.revision)?.[1];for(const key of ["protocol","tls_settings","server_port","host","port","service_id"])expect(body).not.toHaveProperty(key);
    expect(close).toHaveBeenCalled();
});
it("keeps default line inputs after stale revision rejection and cancels shared multiplier changes",async()=>{
    defaultEditorFixture(2);const original=api.request.getMockImplementation()!;
    api.request.mockImplementation(async(path:string,body?:any)=>body?.revision?Promise.reject(new Error("默认线路已被其他管理员修改")):original(path,body));
    const confirmation=vi.spyOn(window,"confirm").mockReturnValue(false);
    render(<DefaultNodeLineEditor node={{type:"v2box",id:3,name:"Default JP"}} groups={[{id:1,name:"Basic"}]} close={()=>{}} onSaved={()=>{}}/>);
    fireEvent.change(await screen.findByLabelText(/^计费倍率/),{target:{value:"2"}});fireEvent.click(screen.getByRole("button",{name:"保存节点信息"}));
    await screen.findByText("已取消保存，修改仍保留在表单中。");
    expect(api.request.mock.calls.some(([,body])=>body?.revision)).toBe(false);
    confirmation.mockReturnValue(true);fireEvent.click(screen.getByRole("button",{name:"保存节点信息"}));
    await screen.findByText("默认线路已被其他管理员修改");expect(screen.getByLabelText(/^计费倍率/)).toHaveProperty("value","2");
});

it("guards unsaved line and service changes when switching editor sections",async()=>{
    responsibilityFixture();const base=api.request.getMockImplementation()!;
    api.request.mockImplementation(async(path:string,body?:any)=>String(path).includes("connections/default")?{data:{values:{name:"Box service",group_id:[1],rate:1,tags:[]},revision:"b".repeat(64),sharedLines:1}}:String(path).includes("console/nodeSchema")?{data:{name:"required",protocol:"required|in:anytls",server_port:"required",group_id:"array"}}:base(path,body));
    const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    render(<Nodes/>);fireEvent.click((await screen.findAllByRole("button",{name:"编辑"}))[0]);
    fireEvent.change(await screen.findByLabelText("节点名称"),{target:{value:"Unsaved line"}});
    fireEvent.click(screen.getByRole("button",{name:"协议与证书"}));
    expect(screen.getByLabelText("节点名称")).toHaveProperty("value","Unsaved line");
    expect(api.request.mock.calls.some(([,body])=>body?.revision)).toBe(false);
    confirm.mockReturnValue(true);fireEvent.click(screen.getByRole("button",{name:"协议与证书"}));
    const port=await screen.findByRole("spinbutton",{name:/监听端口/});
    fireEvent.change(port,{target:{value:"9444"}});
    confirm.mockReturnValue(false);fireEvent.click(screen.getByRole("button",{name:"节点信息"}));
    expect(port).toHaveProperty("value","9444");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(api.request.mock.calls.some(([path])=>String(path).endsWith("v2box/save"))).toBe(false);
});

import { nodeLineFields } from "./node-line-fields";
import { nodeServiceFields } from "./node-setup";
it.each(["managed","manual"])("keeps %s creation fields aligned with the line and service editors",mode=>{
    const line=nodeLineFields([{id:1,name:"Basic"}],{regions:{JP:{"zh-CN":"日本"}},cities:{},cityRegions:{},locationKinds:{}});
    const service=[{key:"protocol",label:"协议"},{key:"server_port",label:"old port"},{key:"tls",label:"TLS"}];
    const source=[...line,...service,{key:"host",label:"old host"},{key:"port",label:"old port"}];
    const fields=nodeSetupFields(source,{setup_mode:mode,tls:0},{},"v2box",line);
    expect(fields.slice(0,line.length).map(f=>[f.key,f.label])).toEqual(line.map(f=>[f.key,f.label]));
    expect(fields.filter(f=>f.key==="server_port")).toHaveLength(1);
    expect(fields.find(f=>f.key==="server_port")?.label).toBe(nodeServiceFields(service).find(f=>f.key==="server_port")?.label);
    expect(fields.findIndex(f=>f.section==="节点信息")).toBeLessThan(fields.findIndex(f=>f.section==="协议与证书"));
    expect(fields.findIndex(f=>f.section==="连接与域名")).toBeLessThan(fields.findIndex(f=>f.section==="协议与证书"));
    expect(new Set(fields.map(f=>f.key)).size).toBe(fields.length);
    expect(fields.some(f=>f.key==="host")).toBe(mode==="manual");
});

import { nodeDomainProgress } from "./node-domain-progress";
import { ManualNodeAddress } from "./ManualNodeAddress";
it("allows editing a manually created address without resubmitting service configuration",async()=>{
    let saved=false;
    api.request.mockImplementation(async(_path:string,body?:any)=>{if(body){saved=true;return {data:true};}return {data:{values:{host:saved?"changed.example.test":"manual.example.test",port:saved?"8443":"443"},revision:saved?"d".repeat(64):"c".repeat(64),managed:false,serverName:"identity.example.test"}};});
    vi.spyOn(window,"confirm").mockReturnValue(true);
    render(<ManualNodeAddress node={{type:"v2box",id:7}}/>);
    fireEvent.change(await screen.findByLabelText("连接地址"),{target:{value:"changed.example.test"}});
    fireEvent.change(screen.getByLabelText(/^连接端口/),{target:{value:"8443"}});
    fireEvent.click(screen.getByRole("button",{name:"保存连接地址"}));
    await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/server/connections/address",{type:"v2box",id:7,revision:"c".repeat(64),host:"changed.example.test",port:"8443",confirm:true},{method:"PATCH"}));
    expect(screen.getByText("TLS SNI：identity.example.test")).toBeTruthy();
    expect(screen.queryByLabelText("协议")).toBeNull();
});
it("retains manual address input after conflicts and cancellation",async()=>{
    api.request.mockImplementation(async(_path:string,body?:any)=>{if(body)throw new Error("连接配置已变化");return {data:{values:{host:"manual.example.test",port:"443"},revision:"c".repeat(64),managed:false}};});
    const confirmation=vi.spyOn(window,"confirm").mockReturnValue(false);
    render(<ManualNodeAddress node={{type:"v2box",id:7}}/>);
    fireEvent.change(await screen.findByLabelText("连接地址"),{target:{value:"unsaved.example.test"}});
    fireEvent.click(screen.getByRole("button",{name:"保存连接地址"}));await screen.findByText("已取消保存，修改仍保留在表单中。");
    expect(api.request.mock.calls.some(([,body])=>body?.confirm)).toBe(false);
    confirmation.mockReturnValue(true);fireEvent.click(screen.getByRole("button",{name:"保存连接地址"}));
    await screen.findByText("连接配置已变化");expect(screen.getByLabelText("连接地址")).toHaveProperty("value","unsaved.example.test");
});
it("opens deployment immediately for a saved manual node without forcing domain configuration",async()=>{
    api.request.mockResolvedValue({data:{keys:[],assignments:[],servers:[]}});
    render(<NodeDeployment node={{type:"v2box",id:7,name:"Manual",_new:true,_domainConfigured:false}} close={()=>{}}/>);
    expect(await screen.findByText("新节点安装")).toBeTruthy();
    expect(screen.queryByText("设置节点域名")).toBeNull();
    expect(api.request.mock.calls.some(([path])=>String(path).includes("connections/address"))).toBe(false);
});
it("reports managed direct port drift and rejects automatic ACME for new manual addresses",()=>{
    const ready={enabled:true,managed:true,family:"ipv4",ipv4:"8.8.8.8",ipv4_seen_at:Date.now()/1000,last_success:Date.now()/1000,status:"healthy",domain:"node.example.test",published_domain:"node.example.test",published_port:443};
    const progress=nodeDomainProgress(ready,{host:"node.example.test",port:443,server_port:9443,tls:0});
    expect(progress.active).toBe(false);expect(progress.canActivate).toBe(true);expect(progress.description).toContain("监听端口已修改");
    expect(nodeDomainProgress({...ready,published_port:9443},{host:"node.example.test",port:443,server_port:9443,tls:0}).active).toBe(true);
    expect(nodeConfigurationProblems({setup_mode:"manual",tls:1,"tls_settings.cert_mode":"http","tls_settings.server_name":"identity.example.test"},"v2box").some(p=>p.key==="setup_mode")).toBe(true);
});

it("keeps managed TLS identity in domain settings while Reality remains independently editable",async()=>{
    api.request.mockImplementation(async(path:string)=>String(path).includes("dictionary/fetch")?adminPageFixture(path):String(path).includes("getNodes")?{data:[{id:1,type:"v2box",name:"Managed",protocol:"vless",tls:1,network:"tcp",host:"managed.example.test",port:443,server_port:443,group_id:[1],tls_settings:{cert_mode:"http",server_name:"managed.example.test"}}]}:String(path).includes("nodeSchema")?{data:{name:"required",protocol:"required|in:vless",tls:"required|in:0,1,2",network:"required|in:tcp",server_port:"required",tls_settings:"array"}}:String(path).includes("ddns/fetch")?{data:{assignments:[{id:8,node_type:"v2box",node_id:1,managed:true}],servers:[],credentials:[]}}:{data:[]});
    history.replaceState(null,"",`${location.pathname}#/nodes?service=v2box%3A1`);
    render(<Nodes/>);await screen.findByText(/普通 TLS 的 SNI 随托管连接域名维护/);
    expect(await screen.findByRole("combobox",{name:"证书模式"})).toBeTruthy();
    expect(screen.queryByLabelText("TLS 身份域名（SNI）")).toBeNull();
    fireEvent.change(screen.getByRole("combobox",{name:/^TLS/}),{target:{value:"2"}});
    expect(await screen.findByLabelText("TLS 身份域名（SNI）")).toBeTruthy();
});

it("guides a managed listener change to endpoint verification without issuing another deployment grant",async()=>{
    let port=443;
    api.request.mockImplementation(async(path:string,body?:any)=>{
        if(String(path).endsWith("v2box/save")){port=Number(body.server_port);return {data:true};}
        if(String(path).includes("dictionary/fetch"))return adminPageFixture(path);
        if(String(path).includes("getNodes"))return {data:[{id:1,type:"v2box",name:"Port change",protocol:"vless",tls:0,network:"tcp",host:"port.example.test",port:443,server_port:port,group_id:[]}]};
        if(String(path).includes("nodeSchema"))return {data:{name:"required",protocol:"required|in:vless",tls:"required|in:0,1,2",network:"required|in:tcp",server_port:"required"}};
        if(String(path).includes("ddns/fetch"))return {data:{assignments:[{id:8,node_type:"v2box",node_id:1,managed:true,enabled:true,domain:"port.example.test",published_domain:"port.example.test",published_port:443,family:"ipv4",ipv4:"8.8.8.8",ipv4_seen_at:Date.now()/1000,last_success:Date.now()/1000,status:"healthy"}],servers:[],credentials:[]}};
        if(String(path).includes("credentials"))return {data:{keys:[]}};
        return {data:[]};
    });
    vi.spyOn(window,"confirm").mockReturnValue(true);history.replaceState(null,"",`${location.pathname}#/nodes?service=v2box%3A1`);
    render(<Nodes/>);fireEvent.change(await screen.findByRole("spinbutton",{name:/监听端口/}),{target:{value:"9443"}});
    fireEvent.click(screen.getByRole("button",{name:"保存节点配置"}));
    await screen.findByText(/监听端口已保存。等待节点应用后/);
    expect(await screen.findByText(/监听端口已修改。请确认节点应用新配置/)).toBeTruthy();
    expect(screen.getByRole("tab",{name:"域名与解析"}).getAttribute("aria-selected")).toBe("true");
    expect(api.request.mock.calls.some(([path])=>String(path).includes("credentials/deployment"))).toBe(false);
});

it("does not mark an unverified new address complete merely because the creation hostname matches",()=>{
    const ready={enabled:true,managed:true,family:"ipv4",ipv4:"8.8.8.8",ipv4_seen_at:Date.now()/1000,last_success:Date.now()/1000,status:"healthy",domain:"node.example.test",published_domain:"node.example.test",published_port:null};
    const node={type:"v2box",host:"node.example.test",port:443,server_port:443,tls:1,_new:true};
    const progress=nodeDomainProgress(ready,node);
    expect(progress.active).toBe(false);expect(progress.needsUpgrade).toBe(false);expect(progress.title).toBe("下一步：执行一键安装");
    const stage=nodeDeploymentStage(node,{runtimeStatus:"online",applicationState:"applied"},ready,true);
    expect(stage.target).toBe("domain");expect(stage.terminal).toBe(false);
});

it("disables manual-only source services before a reused draft can become unpublishable",async()=>{
    unifiedCreationFixture();const base=api.request.getMockImplementation()!;
    api.request.mockImplementation(async(path:string,body?:any)=>path.endsWith("server/ddns/fetch")?{data:{servers:[{id:5,enabled:true}],assignments:[{node_type:"v2box",node_id:1,server_id:5,status:"manual",managed:false,enabled:false},{node_type:"v2node",node_id:1,server_id:5,managed:true,enabled:true}]}}:base(path,body));
    render(<Nodes/>);await screen.findByText("Box service");fireEvent.click(screen.getByRole("button",{name:"新增节点"}));fireEvent.click(screen.getByText("高级：共用现有节点的服务"));fireEvent.click(screen.getByRole("button",{name:"为现有节点添加连接线路"}));
    const choice=await screen.findByRole("combobox",{name:"代理服务"});
    expect(screen.getByRole("option",{name:/Box service.*需启用/})).toHaveProperty("disabled",true);
    fireEvent.change(choice,{target:{value:"v2box:1"}});fireEvent.change(screen.getByLabelText("节点名称"),{target:{value:"Cannot publish"}});
    expect(screen.getByRole("button",{name:"保存待发布配置"})).toHaveProperty("disabled",true);
    expect(screen.getByText(/请先在关联代理服务的部署设置中启用服务器与自动域名管理/)).toBeTruthy();
    expect(api.request.mock.calls.some(([path])=>String(path).endsWith("connections/save"))).toBe(false);
});
it("guards the server-management link while a reused node draft is unsaved",async()=>{
    unifiedCreationFixture();vi.spyOn(window,"confirm").mockReturnValue(false);render(<Nodes/>);
    await screen.findByText("Box service");fireEvent.click(screen.getByRole("button",{name:"新增节点"}));fireEvent.click(screen.getByText("高级：共用现有节点的服务"));fireEvent.click(screen.getByRole("button",{name:"为现有节点添加连接线路"}));
    fireEvent.change(await screen.findByRole("combobox",{name:"代理服务"}),{target:{value:"v2box:1"}});
    fireEvent.change(screen.getByLabelText("节点名称"),{target:{value:"Keep draft"}});
    fireEvent.change(screen.getByLabelText("连接方式"),{target:{value:"relay"}});
    const link=within(screen.getByRole("dialog")).getByRole("link",{name:"服务器管理"});
    expect(fireEvent.click(link)).toBe(false);expect(screen.getByLabelText("节点名称")).toHaveProperty("value","Keep draft");
});

it("keeps four editor sections in one drawer and lists all nodes affected by a shared service",async()=>{
 responsibilityFixture();render(<Nodes/>);fireEvent.click((await screen.findAllByRole("button",{name:"编辑"}))[0]);
 for(const name of ["节点信息","连接与域名","协议与证书","部署与状态"])expect(screen.getByRole("button",{name})).toBeTruthy();
 const summary=screen.getByText("代理服务关联节点（2 个）");fireEvent.click(summary);
 expect(summary.closest("details")?.textContent).toContain("Box service（当前节点）");expect(summary.closest("details")?.textContent).toContain("Shared route");
 fireEvent.click(screen.getByRole("button",{name:"连接与域名"}));
 expect(screen.getAllByRole("dialog")).toHaveLength(1);expect(screen.queryByRole("button",{name:"生成一键部署命令"})).toBeNull();
 expect(api.request.mock.calls.some(([path,body])=>body && String(path).includes("credentials/deployment"))).toBe(false);
});
it("defaults a new shared-service node to the exit region while preserving its independent name and manual region selection",async()=>{
 unifiedCreationFixture();const original=api.request.getMockImplementation()!;
 api.request.mockImplementation(async(path:string,...args:any[])=>{const result=await original(path,...args);return path.endsWith("manage/getNodes")?{...result,data:result.data.map((n:any)=>({...n,region_code:"JP",city_code:"JP-13"}))}:result;});
 render(<Nodes/>);fireEvent.click(screen.getByRole("button",{name:"新增节点"}));fireEvent.click(screen.getByText("高级：共用现有节点的服务"));fireEvent.click(screen.getByRole("button",{name:"为现有节点添加连接线路"}));
 fireEvent.change(await screen.findByLabelText("节点名称"),{target:{value:"Japan via Hong Kong"}});
 fireEvent.change(screen.getByLabelText("代理服务"),{target:{value:"v2box:1"}});
 expect(screen.getByLabelText("国家 / 地区")).toHaveProperty("value","JP");expect(screen.getByLabelText(/^州、省或城市/)).toHaveProperty("value","JP-13");
 expect(screen.getByLabelText("节点名称")).toHaveProperty("value","Japan via Hong Kong");
 fireEvent.change(screen.getByLabelText("国家 / 地区"),{target:{value:"US"}});
 fireEvent.change(screen.getByLabelText("代理服务"),{target:{value:"v2node:1"}});
 expect(screen.getByLabelText("国家 / 地区")).toHaveProperty("value","US");expect(screen.getByLabelText("节点名称")).toHaveProperty("value","Japan via Hong Kong");
 fireEvent.change(screen.getByLabelText("国家 / 地区"),{target:{value:""}});
 fireEvent.change(screen.getByLabelText("代理服务"),{target:{value:"v2box:1"}});
 expect(screen.getByLabelText("国家 / 地区")).toHaveProperty("value","");expect(screen.getByLabelText("州、省或城市")).toHaveProperty("value","");
 fireEvent.change(screen.getByLabelText("代理服务"),{target:{value:""}});
 expect(screen.getByLabelText("节点名称")).toHaveProperty("value","Japan via Hong Kong");expect(within(screen.getByRole("group",{name:"权限组"})).queryAllByRole("checkbox")).toHaveLength(0);
 expect(api.request.mock.calls.some(([,body])=>body)).toBe(false);
});

it.each(["line","path"] as const)("separates shared node %s fields while retaining the full saved relationship",async view=>{
 const source={id:1,type:"v2box",name:"Japan service",protocol:"anytls",server_port:9443,group_id:[1]};
 const draft={name:"Japan via HK",service_id:1,entry_id:3,entry_port:443,group_id:[1],show:1,region_code:"JP",city_code:null,tags:[]};
 api.request.mockImplementation(async(path:string)=>path.includes("ddns/fetch")?{data:{servers:[{id:9,enabled:true}],assignments:[{id:2,node_type:"v2box",node_id:1,server_id:9,enabled:true,managed:true,domain:"origin.test"},{id:3,purpose:"entry",enabled:true,domain:"entry.test"}]}}:path.includes("connections/fetch")?{data:{id:5,revision:2,draft,plan:{dns_ready:false}}}:{data:{id:5}});
 render(<NodeConnectionEditor view={view} node={{id:5,type:"v2box",service_id:1,name:draft.name}} nodes={[source]} close={()=>{}} onSaved={()=>{}}/>);
 await screen.findByRole("button",{name:"保存待发布配置"});
 if(view==="line"){
  expect(screen.queryByLabelText("连接方式")).toBeNull();expect(screen.queryByLabelText("代理服务")).toBeNull();
  fireEvent.change(screen.getByLabelText("节点名称"),{target:{value:"Japan premium"}});
 }else{
  expect(screen.queryByLabelText("节点名称")).toBeNull();expect(screen.queryByLabelText("国家 / 地区")).toBeNull();
  fireEvent.change(screen.getByLabelText("入口端口"),{target:{value:"8443"}});
 }
 fireEvent.click(screen.getByRole("button",{name:"保存待发布配置"}));
 await waitFor(()=>expect(api.request).toHaveBeenCalledWith("test-admin/server/connections/save",expect.objectContaining({name:view==="line"?"Japan premium":draft.name,service_id:1,entry_id:3,entry_port:view==="path"?8443:443,region_code:"JP",revision:2})));
 expect(api.request.mock.calls.some(([path])=>String(path).endsWith("v2box/save") || String(path).includes("credentials/deployment"))).toBe(false);
});

it("excludes paused root credentials and ignores stale relay selections in direct server choices", () => {
 const fields=nodeSetupFields([{key:"protocol",label:"协议"}],{setup_mode:"managed",setup_access_mode:"direct",setup_entry_id:9,setup_family:"ipv4"},{credentials:[{id:1,root_domain:"active.test",next_run:0},{id:2,root_domain:"paused.test",next_run:-1}],assignments:[{id:9,purpose:"entry",enabled:true,server_id:5}],servers:[{id:5,name:"Server",enabled:true,family:"ipv4"}]});
 expect(fields.find(f=>f.key==="setup_credential_id")?.options?.map(o=>o[0])).toEqual(["","1"]);
 expect(fields.find(f=>f.key==="setup_server_id")?.options?.map(o=>o[0])).toEqual(["","5"]);
});

it("does not present old applied status as success while newer settings are pending or invalid",()=>{
 for(const [configurationState,title] of [["pending","设置已保存，等待节点获取"],["invalid","当前配置无法下发"]]) {
  const stage=nodeDeploymentStage({type:"v2box"},{configurationState,applicationState:"applied",runtimeStatus:"online"},undefined,true);
  expect(stage.title).toBe(title);
 }
});
