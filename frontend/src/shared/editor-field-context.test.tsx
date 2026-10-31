// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("./api", () => ({
    boot: { mode: "admin" },
    request: vi.fn(),
    readRequest: vi.fn(),
}));
import { Editor, EditorFieldContext } from "./ui";
import { adminEditorField } from "../admin/admin-editor-fields";

afterEach(cleanup);
const field = {
    key: "groups",
    label: "权限组",
    type: "multiselect" as const,
    options: [["1", "组一"] as [string, string]],
};
it("uses generic fields without the backend provider", () => {
    render(
        <Editor
            fields={[field]}
            initial={{ groups: [1] }}
            onSave={async () => {}}
        />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("checkbox").textContent).toContain("组一");
});
it("retains backend controls inside the backend provider", () => {
    render(
        <EditorFieldContext.Provider value={adminEditorField}>
            <Editor
                fields={[field]}
                initial={{ groups: [1] }}
                onSave={async () => {}}
            />
        </EditorFieldContext.Provider>,
    );
    expect(screen.getByRole("combobox", { name: "权限组" })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
});

it("keeps exact seconds when saving another field beside an existing expiry", async () => {
    const { configureTimeZone, setDisplayTimeZone } = await import("./timezone");
    configureTimeZone("Asia/Kathmandu", true);
    setDisplayTimeZone("America/New_York");
    const at = Date.parse("2026-10-19T00:00:37Z") / 1000;
    const save = vi.fn().mockResolvedValue(undefined);
    try {
        render(<Editor fields={[
            { key: "name", label: "名称", type: "text" },
            { key: "expiry", label: "到期时间", type: "datetime-local" },
        ]} initial={{ name: "Original", expiry: "2026-10-19T00:00:37Z" }} onSave={save} />);
        const input = screen.getByLabelText("到期时间") as HTMLInputElement;
        expect(input.value.replace(/\.0{1,3}$/, "")).toBe("2026-10-19T05:45:37");
        expect(input.step).toBe("1");
        fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Updated" } });
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(save).toHaveBeenCalledWith({ name: "Updated", expiry: at }));
    } finally { setDisplayTimeZone(null); configureTimeZone("Asia/Shanghai", true); }
});

it("keeps an active expiry draft in business time while administrator display time changes", async () => {
    const { configureTimeZone, setAdminDisplayTimeZone, displayTimeZone } = await import("./timezone");
    configureTimeZone("Asia/Kathmandu", true);
    setAdminDisplayTimeZone("America/New_York");
    const at = Date.parse("2026-10-19T00:00:37Z") / 1000;
    const save = vi.fn().mockResolvedValue(undefined);
    const editor = <Editor fields={[
        { key: "name", label: "名称", type: "text" },
        { key: "expiry", label: "到期时间", type: "datetime-local" },
    ]} initial={{ name: "Original", expiry: at }} onSave={save} />;
    try {
        const view = render(editor);
        fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Unsaved draft" } });
        setAdminDisplayTimeZone("UTC");
        view.rerender(<>{editor}</>);
        expect(displayTimeZone()).toBe("UTC");
        expect((screen.getByLabelText("到期时间") as HTMLInputElement).value.replace(/\.0{1,3}$/, "")).toBe("2026-10-19T05:45:37");
        expect(screen.getByText(/日期时间按 Asia\/Kathmandu 输入和显示/)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(save).toHaveBeenCalledWith({ name: "Unsaved draft", expiry: at }));
    } finally { setAdminDisplayTimeZone("business"); configureTimeZone("Asia/Shanghai", true); }
});

it.each(["2026-11-01T05:30:37Z", "2026-11-01T06:30:37Z"])("retains an unchanged expiry within the DST repeated hour: %s", async (iso) => {
    const { configureTimeZone } = await import("./timezone");
    configureTimeZone("America/New_York", true);
    const save = vi.fn().mockResolvedValue(undefined);
    try {
        render(<Editor fields={[
            { key: "name", label: "名称", type: "text" },
            { key: "expiry", label: "到期时间", type: "datetime-local" },
        ]} initial={{ name: "Original", expiry: iso }} onSave={save} />);
        const input = screen.getByLabelText("到期时间") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "2026-11-01T01:30:37.000" } });
        fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Updated" } });
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(save).toHaveBeenCalledWith({ name: "Updated", expiry: Date.parse(iso) / 1000 }));
        fireEvent.change(input, { target: { value: "2026-11-01T01:31:37" } });
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        expect((await screen.findByRole("alert")).textContent).toContain("夏令时重复");
        expect(save).toHaveBeenCalledTimes(1);
    } finally { configureTimeZone("Asia/Shanghai", true); }
});
