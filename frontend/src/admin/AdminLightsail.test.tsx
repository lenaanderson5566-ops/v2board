// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
    rows: [] as any[],
    request: vi.fn(),
    reload: vi.fn(),
}));
vi.mock("../shared/api", () => ({
    admin: (p: string) => "admin/" + p,
    request: mocks.request,
}));
vi.mock("../shared/ui", () => ({
    useData: () => ({
        data: mocks.rows,
        loading: false,
        error: "",
        reload: mocks.reload,
    }),
    State: ({ children }: any) => children,
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
    status: "ready",
    phase: "idle",
    recoverable: false,
};
beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [{ ...row }];
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
    expect(
        (screen.getByLabelText("AWS Secret Access Key") as HTMLInputElement)
            .value,
    ).toBe("");
    expect(
        (screen.getByLabelText("AWS Secret Access Key") as HTMLInputElement)
            .type,
    ).toBe("password");
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
        (screen.getByLabelText("AWS Secret Access Key") as HTMLInputElement)
            .disabled,
    ).toBe(false);
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
