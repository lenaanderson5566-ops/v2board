// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    rows: [] as any[],
    credentials: [] as any[],
    request: vi.fn(),
    reload: vi.fn(),
}));
vi.mock("../shared/api", () => ({
    admin: (p: string) => "admin/" + p,
    request: mocks.request,
}));
vi.mock("../shared/ui", () => ({
    useData: (path: string) => ({
        data: path.endsWith("/credentials") ? mocks.credentials : mocks.rows,
        loading: false,
        error: "",
        reload: mocks.reload,
    }),
    State: ({ children }: any) => children,
    Panel: ({ title, children, actions }: any) => <section><h2>{title}</h2>{actions}{children}</section>,
    Modal: ({ title, children }: any) => (
        <section role="dialog" aria-label={title}>
            <h2>{title}</h2>
            {children}
        </section>
    ),
}));
import { AdminLightsail } from "./AdminLightsail";
const row = {
    id: 1,
    name: "Singapore",
    region: "ap-southeast-1",
    instance: "test-instance",
    node_type: "v2box",
    node_id: 1,
    credential_id: 7,
    status: "ready",
    phase: "idle",
    recoverable: false,
};
beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [{ ...row }];
    mocks.credentials = [{ id: 7, name: "Shared AWS", server_count: 1, active_count: 0 }];
    mocks.request.mockResolvedValue({ data: true });
});
afterEach(cleanup);
const show = () =>
    render(
        <AdminLightsail
            nodes={[{ id: 1, type: "v2box", name: "Main node" }]}
            close={vi.fn()}
        />,
    );
it("requires exact instance confirmation before submitting an IP change", async () => {
    show();
    fireEvent.click(
        screen.getByRole("button", { name: "更换 IP" }),
    );
    const button = screen.getByRole("button", { name: "确认操作" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("输入实例名称确认"), {
        target: { value: "test-instance" },
    });
    fireEvent.click(button);
    await waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith(
            "admin/server/lightsail/operate",
            { id: 1, action: "rotate", confirmInstance: "test-instance" },
        ),
    );
});
it("shows read-only AWS IP lookup independently from rotation", async () => {
    mocks.request.mockResolvedValue({
        data: { publicIp: "1.1.1.1", staticIp: true },
    });
    show();
    fireEvent.click(screen.getByRole("button", { name: "查询 IP" }));
    await screen.findByText("1.1.1.1");
    expect(mocks.request).toHaveBeenCalledWith(
        "admin/server/lightsail/inspect?id=1",
    );
});
it("preserves stored credentials when editing without showing them", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "编辑配置" }));
    expect((screen.getByLabelText("AWS 密钥") as HTMLSelectElement).value).toBe("7");
    expect(screen.queryByLabelText("AWS Secret Access Key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编辑所选密钥" }));
    expect((screen.getByLabelText("AWS Secret Access Key") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("AWS Secret Access Key") as HTMLInputElement).type).toBe("password");
});
it("allows credential repair while keeping a failed operation target fixed", () => {
    mocks.rows = [
        { ...row, status: "failed", recoverable: true, canRestore: true },
    ];
    show();
    fireEvent.click(screen.getByRole("button", { name: "编辑配置" }));
    expect(
        (screen.getByLabelText("Lightsail 实例名称") as HTMLInputElement)
            .disabled,
    ).toBe(true);
    expect(
        (screen.getByLabelText("AWS 密钥") as HTMLSelectElement)
            .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "编辑所选密钥" }));
    expect((screen.getByLabelText("AWS Secret Access Key") as HTMLInputElement).disabled).toBe(false);
});
it("unlocks failed target editing only after acknowledging abandonment", async () => {
    mocks.rows = [{ ...row, status: "failed", phase: "allocate", staticIpNames: ["old-ip", "new-ip"] }];
    show();
    fireEvent.click(screen.getByRole("button", { name: "编辑配置" }));
    const dialog = screen.getByRole("dialog", { name: "编辑 Lightsail 配置" });
    expect(within(dialog).getByText(/old-ip、new-ip/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "放弃未完成操作并解锁关联配置" }));
    const instance = screen.getByLabelText("Lightsail 实例名称") as HTMLInputElement;
    expect(instance.disabled).toBe(false);
    expect((screen.getByLabelText("关联代理服务") as HTMLSelectElement).disabled).toBe(false);
    fireEvent.change(instance, { target: { value: "replacement-instance" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("admin/server/lightsail/save", expect.objectContaining({ id: 1, instance: "replacement-instance", abandonOperation: true })));
});
it("removes failed management configuration after warning without rotating IPs", async () => {
    mocks.rows = [{ ...row, status: "failed", phase: "allocate", staticIpNames: ["pending-ip"] }];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
        show();
        fireEvent.click(screen.getByRole("button", { name: "移除配置" }));
        expect(mocks.request).not.toHaveBeenCalled();
        expect(confirm.mock.calls[0][0]).toContain("pending-ip");
        expect(confirm.mock.calls[0][0]).toContain("不删除 AWS 实例");
        confirm.mockReturnValue(true);
        fireEvent.click(screen.getByRole("button", { name: "移除配置" }));
        await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("admin/server/lightsail/drop", { id: 1, abandonOperation: true }));
    } finally { confirm.mockRestore(); }
});
it("keeps editing and removal disabled while a worker may be active", () => {
    mocks.rows = [{ ...row, status: "running", recoverable: true }];
    show();
    expect((screen.getByRole("button", { name: "编辑配置" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "移除配置" }) as HTMLButtonElement).disabled).toBe(true);
});
it("opens editing from the standalone page and removes the saved target rather than an unsaved draft", () => {
    mocks.rows = [{ ...row, status: "failed" }];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
        render(<AdminLightsail nodes={[{ id: 1, type: "v2box", name: "Main node" }]} />);
        fireEvent.click(screen.getByRole("button", { name: "编辑配置" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "放弃未完成操作并解锁关联配置" }));
        fireEvent.change(screen.getByLabelText("Lightsail 实例名称"), { target: { value: "unsaved-instance" } });
        fireEvent.click(within(screen.getByRole("dialog", { name: "编辑 Lightsail 配置" })).getByRole("button", { name: "移除配置" }));
        expect(confirm.mock.calls[0][0]).toContain("test-instance");
        expect(confirm.mock.calls[0][0]).not.toContain("unsaved-instance");
        expect(mocks.request).not.toHaveBeenCalled();
    } finally { confirm.mockRestore(); }
});
it("offers bounded recovery for stalled jobs and no second rotation", () => {
    mocks.rows = [
        { ...row, status: "queued", recoverable: true, canRestore: true },
    ];
    show();
    expect(screen.getByRole("button", { name: "继续操作" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "恢复旧 IP" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "更换 IP" })).toBeNull();
});

it("pauses background polling when hidden and removes timers after unmount", () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    mocks.rows = [{...row,status:"running"}];
    const view = render(<AdminLightsail nodes={[]} close={vi.fn()}/>);
    try {
        vi.advanceTimersByTime(10000);
        expect(mocks.reload).not.toHaveBeenCalled();
        visibility.mockReturnValue("visible");
        vi.advanceTimersByTime(5000);
        expect(mocks.reload).toHaveBeenCalledTimes(1);
        view.unmount();
        vi.advanceTimersByTime(10000);
        expect(mocks.reload).toHaveBeenCalledTimes(1);
    } finally { view.unmount();visibility.mockRestore();vi.useRealTimers(); }
});
it("binds another server to an existing credential without submitting secret copies", async () => {
    mocks.credentials[0].server_count = 2;
    show();
    fireEvent.click(screen.getByRole("button", { name: "添加服务器" }));
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "Second server" } });
    fireEvent.change(screen.getByLabelText("Lightsail 实例名称"), { target: { value: "another-instance" } });
    fireEvent.change(screen.getByLabelText("关联代理服务"), { target: { value: "v2box:1" } });
    fireEvent.change(screen.getByLabelText("AWS 密钥"), { target: { value: "7" } });
    expect(screen.getByRole("option", { name: "Shared AWS · 2 台服务器" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("admin/server/lightsail/save", expect.objectContaining({ instance: "another-instance", credential_id: 7 })));
    const body = mocks.request.mock.calls.find(([path]) => path.endsWith("/save"))![1];
    expect(body).not.toHaveProperty("accessKey"); expect(body).not.toHaveProperty("secretKey");
});
it("manages a shared credential separately and warns about all affected servers", async () => {
    mocks.credentials[0].server_count = 2;
    show();
    fireEvent.click(screen.getByText("AWS 密钥管理"));
    expect((screen.getByRole("button", { name: "移除密钥 Shared AWS" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "编辑密钥 Shared AWS" }));
    fireEvent.change(screen.getByLabelText("AWS Access Key ID"), { target: { value: "fake-key" } });
    fireEvent.change(screen.getByLabelText("AWS Secret Access Key"), { target: { value: "fake-secret" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "确认更新这份密钥绑定的全部 2 台服务器的凭据" }));
    fireEvent.click(screen.getByRole("button", { name: "保存 AWS 密钥" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("admin/server/lightsail/credentials/save", expect.objectContaining({ id: 7, confirmSharedUpdate: true, secretKey: "fake-secret" })));
});
it("preserves an unfinished server draft when creating a reusable credential inline", async () => {
    mocks.request.mockImplementation(async () => {
        mocks.credentials.push({ id: 9, name: "New account", server_count: 0, active_count: 0 });
        return { data: { id: 9 } };
    });
    show();
    fireEvent.click(screen.getByRole("button", { name: "添加服务器" }));
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "Unsaved server" } });
    const server = screen.getByRole("dialog", { name: "添加 Lightsail 服务器" });
    fireEvent.click(within(server).getByRole("button", { name: "添加 AWS 密钥" }));
    fireEvent.change(screen.getByLabelText("密钥名称"), { target: { value: "New account" } });
    fireEvent.change(screen.getByLabelText("AWS Access Key ID"), { target: { value: "fake-key" } });
    fireEvent.change(screen.getByLabelText("AWS Secret Access Key"), { target: { value: "fake-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 AWS 密钥" }));
    await waitFor(() => expect((screen.getByLabelText("AWS 密钥") as HTMLSelectElement).value).toBe("9"));
    expect(screen.getByLabelText("显示名称")).toHaveProperty("value", "Unsaved server");
    expect(screen.queryByRole("dialog", { name: "添加 AWS 密钥" })).toBeNull();
});
