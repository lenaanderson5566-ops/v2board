// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("FASTAI", { mode: "admin", adminPath: "test-admin" }); });
import { AdminPager } from "./AdminPager";
import { Pager } from "../shared/ui";

afterEach(cleanup);

const input = () => screen.getByRole("textbox", { name: "跳转页码" }) as HTMLInputElement;
const jump = () => screen.getByRole("button", { name: "跳转" });

it("accepts a page by Enter or button and never fetches solely from typing", () => {
    const onChange = vi.fn();
    const { rerender } = render(<AdminPager page={1} size={10} total={51} onChange={onChange} />);
    fireEvent.change(input(), { target: { value: "6" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onChange.mock.calls).toEqual([[6]]);
    rerender(<AdminPager page={6} size={10} total={51} onChange={onChange} />);
    expect(input().value).toBe("");
    fireEvent.change(input(), { target: { value: "6" } });
    fireEvent.click(jump());
    expect(onChange.mock.calls).toEqual([[6]]);
    fireEvent.change(input(), { target: { value: "2" } });
    fireEvent.click(jump());
    expect(onChange.mock.calls).toEqual([[6], [2]]);
});

it("rejects invalid values and blocks requests until known results are available", () => {
    const onChange = vi.fn();
    const { rerender } = render(<AdminPager page={2} total={80} onChange={onChange} preserveFocus />);
    for (const value of ["0", "-1", "1.2", "1e2", "abc", "5"]) {
        fireEvent.change(input(), { target: { value } });
        fireEvent.click(jump());
        expect(input().getAttribute("aria-invalid")).toBe("true");
        expect(input().getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    }
    const box = input();
    box.focus();
    rerender(<AdminPager page={2} total={0} loading totalUnavailable onChange={onChange} preserveFocus />);
    expect(document.activeElement).toBe(box);
    expect(box.readOnly).toBe(true);
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(jump());
    rerender(<AdminPager page={2} total={0} totalUnavailable onChange={onChange} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
});

it("requests the last available page once when a settled result shrinks", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StrictMode><AdminPager page={4} total={21} onChange={onChange} /></StrictMode>);
    expect(onChange.mock.calls).toEqual([[2]]);
    rerender(<AdminPager page={2} total={0} onChange={onChange} />);
    expect(onChange.mock.calls).toEqual([[2], [1]]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("共 0 条")).toBeTruthy();
});

it("handles a provider page count independently of record totals and leaves the shared pager compact", () => {
    const onChange = vi.fn();
    const { rerender } = render(<AdminPager page={2} pageCount={5} onChange={onChange} />);
    expect(within(screen.getByRole("navigation")).getByText("2 / 5")).toBeTruthy();
    fireEvent.change(input(), { target: { value: "4" } });
    fireEvent.click(jump());
    expect(onChange).toHaveBeenCalledWith(4);
    rerender(<AdminPager page={1} pageCount={0} onChange={onChange} />);
    expect(screen.getByText("暂无可浏览的页面")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    rerender(<Pager page={2} total={100} onChange={onChange} />);
    expect(screen.queryByRole("textbox")).toBeNull();
});
