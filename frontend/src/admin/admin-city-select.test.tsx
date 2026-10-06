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
import { linkNode } from "./admin-linkage";
import { AdminCitySelect } from "./admin-city-select";
afterEach(cleanup);
it("limits city references to the selected country", () => {
    const { rerender } = render(
        <AdminCitySelect
            label="城市"
            value=""
            region="US"
            onChange={() => {}}
        />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /弗吉尼亚州/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /东京/ })).toBeNull();
    rerender(
        <AdminCitySelect
            label="城市"
            value=""
            region="JP"
            onChange={() => {}}
        />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /东京/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /弗吉尼亚州/ })).toBeNull();
});
it.each(["圣何塞", "San Jose", "SAN-JOSE"])(
    "stores the stable city code for %s",
    (text) => {
        const change = vi.fn();
        render(
            <AdminCitySelect
                label="城市"
                value=""
                region="US"
                onChange={change}
            />,
        );
        fireEvent.change(screen.getByRole("combobox"), {
            target: { value: text },
        });
        expect(change).toHaveBeenCalledWith("san-jose");
    },
);
it("allows an unlisted English city and preserves existing custom cities", () => {
    const change = vi.fn();
    render(
        <AdminCitySelect
            label="城市"
            value="boston"
            region="US"
            onChange={change}
        />,
    );
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe(
        "boston",
    );
    expect(screen.getByText(/未收录位置翻译/)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "West Des Moines" },
    });
    expect(change).toHaveBeenCalledWith("West Des Moines");
    expect(
        linkNode("region_code", "JP", { city_code: "boston" }).city_code,
    ).toBe("boston");
});
it("clears a known city when changing to another country", () => {
    expect(
        linkNode("region_code", "JP", { city_code: "san-jose" }).city_code,
    ).toBe("");
    expect(
        linkNode("region_code", "US", { city_code: "san-jose" }).city_code,
    ).toBe("san-jose");
});
it("renders a Chinese city label but saves the city identifier in the node editor", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
        <EditorFieldContext.Provider value={adminEditorField}>
            <Editor
                fields={[{ key: "city_code", label: "城市" }]}
                initial={{ region_code: "US", city_code: "san-jose" }}
                onSave={save}
            />
        </EditorFieldContext.Provider>,
    );
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe(
        "圣何塞",
    );
    fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "纽约" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
        expect(save).toHaveBeenCalledWith({
            region_code: "US",
            city_code: "new-york",
        }),
    );
});

it("finds qualified cloud codes and allows explicit selection for ambiguous codes", () => {
    const change = vi.fn();
    render(
        <AdminCitySelect label="位置" value="" region="" onChange={change} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "aws:us-west-1" } });
    expect(change).toHaveBeenLastCalledWith("california");
    fireEvent.change(input, { target: { value: "ap-southeast-3" } });
    expect(screen.getByRole("option", { name: /雅加达/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /吉隆坡/ }));
    expect(change).toHaveBeenLastCalledWith("kuala-lumpur");
});
