// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { readListView, saveListView } from "./list-view-state";
afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
});
it("restores a view without mixing different resources", () => {
    saveListView("orders", { page: 3, search: "example" });
    expect(readListView("orders")).toEqual({ page: 3, search: "example" });
    expect(readListView("logs")).toEqual({});
});
it("handles corrupt and blocked browser storage", () => {
    sessionStorage.setItem("admin.list.orders", "invalid");
    expect(readListView("orders")).toEqual({});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
    });
    expect(() => saveListView("orders", { page: 1 })).not.toThrow();
});
