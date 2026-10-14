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
import { AdminRegionSelect } from "./admin-region-select";
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

it("searches geographic names without cloud code aliases", () => {
    const change = vi.fn();
    render(<AdminCitySelect label="位置" value="" region="US" onChange={change} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "California" } });
    expect(change).toHaveBeenLastCalledWith("california");
    expect(screen.getByRole("option", { name: /加利福尼亚州/ })).toBeTruthy();
    expect(screen.queryByText(/AWS/)).toBeNull();
    fireEvent.change(input, { target: { value: "us-west-1" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
});

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
