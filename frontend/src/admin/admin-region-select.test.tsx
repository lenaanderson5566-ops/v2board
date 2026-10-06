// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
vi.mock("../shared/api", () => ({
    boot: { mode: "admin" },
    request: vi.fn(),
    readRequest: vi.fn(),
}));
import { Editor, EditorFieldContext } from "../shared/ui";
import { adminEditorField } from "./admin-editor-fields";
import { AdminRegionSelect } from "./admin-region-select";
afterEach(cleanup);
it.each(["美国", "United States", "us", "  uS  "])(
    "finds a country by %s and selects its code",
    (query) => {
        const change = vi.fn();
        render(
            <AdminRegionSelect
                label="国家 / 地区"
                value="JP"
                onChange={change}
            />,
        );
        const input = screen.getByRole("combobox");
        fireEvent.change(input, { target: { value: query } });
        if (query.trim().toLowerCase() === "us")
            expect(screen.getAllByRole("option")).toHaveLength(1);
        fireEvent.click(screen.getByRole("option", { name: "美国（US）" }));
        expect(change).toHaveBeenCalledWith("US");
        expect(screen.queryByRole("listbox")).toBeNull();
    },
);
it("does not save unselected search text, and escape restores the selection", () => {
    const change = vi.fn();
    render(
        <AdminRegionSelect label="国家 / 地区" value="JP" onChange={change} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "not-a-country" } });
    expect(screen.getByText("未找到匹配的国家 / 地区")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toContain("日本");
});
it("supports keyboard selection and clearing", () => {
    const change = vi.fn();
    render(
        <AdminRegionSelect label="国家 / 地区" value="JP" onChange={change} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "United" } });
    const options = screen.getAllByRole("option");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(change).toHaveBeenCalledWith(
        options[1].textContent!.match(/（([A-Z]{2})）/)![1],
    );
    fireEvent.click(screen.getByRole("button", { name: "清空 国家 / 地区" }));
    expect(change).toHaveBeenLastCalledWith("");
});
it("submits the country code through the node editor and clears to null", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
        <EditorFieldContext.Provider value={adminEditorField}>
            <Editor
                fields={[
                    {
                        key: "region_code",
                        label: "国家 / 地区",
                        type: "select",
                        nullable: true,
                        options: [
                            ["", "保留原节点名称"],
                            ["US", "美国"],
                        ],
                    },
                ]}
                initial={{ region_code: "JP" }}
                onSave={save}
            />
        </EditorFieldContext.Provider>,
    );
    fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "United States" },
    });
    fireEvent.click(screen.getByRole("option", { name: "美国（US）" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
        expect(save).toHaveBeenCalledWith({ region_code: "US" }),
    );
    await waitFor(() =>
        expect(
            (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
                .disabled,
        ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "清空 国家 / 地区" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
        expect(save).toHaveBeenLastCalledWith({ region_code: null }),
    );
});
