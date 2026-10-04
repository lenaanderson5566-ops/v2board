// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn(), reload: vi.fn() }));
vi.mock("./api", () => ({
    ops: (s: string) => s,
    request: mocks.request,
    rows: (s: any) => s || [],
    date: String,
}));
vi.mock("./ui", () => ({
    useData: () => ({
        data: [
            { id: "one", name: "First", stale: true },
            {
                id: "two",
                name: "Second",
                version: "v1",
                notes: "<script>test</script>",
            },
        ],
        reload: mocks.reload,
    }),
    State: ({ children }: any) => <>{children}</>,
    Modal: ({ children }: any) => <div role="dialog">{children}</div>,
}));
import { AdminClientReleases } from "./AdminClientReleases";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it("continues after one project fails and restores controls", async () => {
    mocks.request
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ data: [] });
    render(<AdminClientReleases />);
    fireEvent.click(screen.getByRole("button", { name: "检查全部" }));
    await screen.findByText(/1 个项目未能更新/);
    expect(mocks.request.mock.calls.map((c) => c[1].id)).toEqual([
        "one",
        "two",
    ]);
    expect(
        screen
            .getByRole("button", { name: "检查全部" })
            .hasAttribute("disabled"),
    ).toBe(false);
    expect(mocks.reload).toHaveBeenCalled();
});
it("renders upstream release notes as text, not HTML", () => {
    render(<AdminClientReleases />);
    fireEvent.click(screen.getAllByRole("button", { name: "更新说明" })[1]);
    expect(screen.getByText("<script>test</script>")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
});
it("can stop a batch without starting the next project", async () => {
    mocks.request.mockImplementationOnce(
        (_path, _body, opts) =>
            new Promise((_resolve, reject) =>
                opts.signal.addEventListener("abort", () =>
                    reject(new Error("aborted")),
                ),
            ),
    );
    render(<AdminClientReleases />);
    fireEvent.click(screen.getByRole("button", { name: "检查全部" }));
    fireEvent.click(screen.getByRole("button", { name: "停止检查" }));
    await waitFor(() =>
        expect(screen.getByText("已停止检查，可稍后继续。")).toBeTruthy(),
    );
    expect(mocks.request).toHaveBeenCalledTimes(1);
});
