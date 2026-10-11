// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("./payment-icons", () => ({ paymentIcons: [], paymentIconInitial: () => ({}), resolvePaymentIcon: () => "" }));
vi.mock("./PaymentCategoryEditor", () => ({ PaymentCategoryEditor: () => null, paymentCategoryInitial: () => ({ category: "regular" }) }));
const api = vi.hoisted(() => {
    window.V2BOARD = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async (importOriginal) => ({
    ...await importOriginal<typeof import("../shared/api")>(),
    request: api.request, readRequest: api.request,
}));
import { Nodes, ResourcePage, resources } from "./admin";
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it.each(["v2node", "v2box"])("opens, edits and saves a persisted %s node on HTTP", async (backend) => {
    vi.stubGlobal("structuredClone", undefined);
    const own = backend === "v2box" ? 22 : 11;
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("console/nodeSchema")) return { data: { name: "required", protocol: "required|in:vless", tls: "required|in:0,1,2", tls_settings: "nullable|array", network: "required|in:tcp", route_id: "nullable|array", group_id: "required|array" } };
        if (path.endsWith("server/group/fetch")) return { data: [{id: 1, name: "Test group"}] };
        if (path.endsWith("server/route/fetch")) return { data: [{id:11, remarks:"Xray only", backend:"v2node"}, {id:22, remarks:"Singbox only", backend:"v2box"}] };
        if (path.endsWith("server/manage/getNodes")) return { data: [{id:7, name:"Saved node", type:backend, protocol:"vless", tls:1, tls_settings:{server_name:"node.example", cert_mode:"http"}, network:"tcp", route_id:[own], group_id:[1]}] };
        if (path.endsWith(`/server/${backend}/save`)) return {data:true};
        throw new Error(`Unexpected endpoint: ${path}`);
    });
    render(<Nodes />);
    fireEvent.click(await screen.findByRole("button", {name:"编辑"}));
    const name = await screen.findByDisplayValue("Saved node");
    expect(screen.getByDisplayValue("node.example")).toBeTruthy();
    expect(screen.getByText(backend === "v2box" ? "Singbox only" : "Xray only")).toBeTruthy();
    expect(screen.queryByText(backend === "v2box" ? "Xray only" : "Singbox only")).toBeNull();
    fireEvent.change(name, {target:{value:"Updated node"}});
    fireEvent.click(screen.getByRole("button", {name:"保存"}));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(`test-admin/server/${backend}/save`, expect.objectContaining({id:7,name:"Updated node",route_id:[own],tls_settings:expect.objectContaining({server_name:"node.example"})})));
});
it("filters the catalog and preserves sing-box ownership when editing", async () => {
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("server/route/fetch")) return { data: path.includes("backend=v2box") ? [{id:22,backend:"v2box",remarks:"Native rule",action:"sing_box",sing_box:{route:{rules:[{action:"reject",domain_suffix:["example.test"]}]}},match:[]}] : [] };
        if (path.endsWith("server/route/save")) return {data:true};
        throw new Error(`Unexpected endpoint: ${path}`);
    });
    render(<ResourcePage resource={resources.routes} />);
    fireEvent.change(screen.getByLabelText("路由内核"), {target:{value:"v2box"}});
    fireEvent.click(await screen.findByRole("button", {name:"编辑"}));
    fireEvent.change(await screen.findByDisplayValue("Native rule"), {target:{value:"Edited native rule"}});
    fireEvent.click(screen.getByRole("button", {name:"保存"}));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith("test-admin/server/route/save", expect.objectContaining({id:22,backend:"v2box",action:"sing_box",remarks:"Edited native rule"})));
});

it.each(["v2node", "v2box"])("converts saved %s through the target save endpoint", async (source) => {
    const target = source === "v2node" ? "v2box" : "v2node";
    let converted = false;
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("console/nodeSchema")) return {data:{name:"required",protocol:"required|in:vless",route_id:"nullable|array",group_id:"required|array"}};
        if (path.endsWith("server/group/fetch")) return {data:[{id:1,name:"Group"}]};
        if (path.endsWith("server/route/fetch")) return {data:[]};
        if (path.endsWith("server/manage/getNodes")) return {data:[{id:converted ? 41 : 7,name:"Convert node",type:converted ? target : source,protocol:"vless",group_id:[1],route_id:[],install_command:converted ? "install-new-node" : undefined}]};
        if (path.endsWith(`/server/${target}/save`)) { converted = true; return {data:{id:41,type:target}}; }
        throw new Error(`Unexpected endpoint: ${path}`);
    });
    render(<Nodes />);
    fireEvent.click(await screen.findByRole("button", {name:"编辑"}));
    await screen.findByDisplayValue("Convert node");
    fireEvent.change(screen.getByLabelText("节点类型"), {target:{value:target}});
    await screen.findByDisplayValue("Convert node");
    fireEvent.click(await screen.findByRole("button", {name:"保存"}));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(`test-admin/server/${target}/save`, expect.objectContaining({source_type:source,source_id:7,route_id:[]})));
    const body = api.request.mock.calls.find(([path]) => path.endsWith(`/server/${target}/save`))![1];
    expect(body.id).toBeUndefined();
    expect(await screen.findByText("install-new-node")).toBeTruthy();
});

it("guides deployment to panel-managed DDNS", async () => {
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("console/nodeSchema")) return {data:{}};
        if (path.endsWith("server/manage/getNodes")) return {data:[{id:1,name:"Deploy node",type:"v2box",group_id:[],install_command:"bash install.sh"}]};
        return {data:[]};
    });
    render(<Nodes />);
    fireEvent.click(await screen.findByRole("button", {name:"安装命令"}));
    expect(screen.getByText(/在侧栏“Cloudflare DDNS”/)).toBeTruthy();
    expect((screen.getByLabelText("查询服务器 IP 命令") as HTMLTextAreaElement).value).toContain("node-network.py ip");
    expect((screen.getByRole("textbox", {name:"节点安装命令"}) as HTMLTextAreaElement).value).toBe("bash install.sh");
});

it("saves an AnyTLS preset through the real node form", async () => {
    api.request.mockImplementation(async (path: string) => {
        if (path.includes("console/nodeSchema")) return {data:{name:"required",protocol:"required|in:anytls",padding_scheme:"nullable"}};
        if (path.endsWith("server/manage/getNodes")) return {data:[{id:4,name:"AnyTLS node",type:"v2box",protocol:"anytls",group_id:[],padding_scheme:null}]};
        if (path.endsWith("server/v2box/save")) return {data:true};
        return {data:[]};
    });
    render(<Nodes />);
    fireEvent.click(await screen.findByRole("button", {name:"编辑"}));
    fireEvent.change(await screen.findByRole("combobox", {name:/AnyTLS 填充预设/}), {target:{value:"light"}});
    fireEvent.click(screen.getByRole("button", {name:"保存"}));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith("test-admin/server/v2box/save",expect.objectContaining({id:4,padding_scheme:JSON.stringify(["stop=4","0=30-30","1=100-250","2=400-500,c,500-800","3=9-9,300-600"])})));
    const saved = api.request.mock.calls.find(([path]) => path.endsWith("server/v2box/save"))![1];
    expect(saved.padding_preset).toBeUndefined();
});
