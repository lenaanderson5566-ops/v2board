// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
