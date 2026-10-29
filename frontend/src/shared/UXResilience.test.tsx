// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { useEffect, useState } from "react";
import {
    render,
    screen,
    fireEvent,
    waitFor,
    cleanup,
    act,
} from "@testing-library/react";
const uiMode = vi.hoisted(() => ({ mode: "user" }));
vi.mock("./api", () => ({
    boot: uiMode,
    storageKey: "v2board.user.auth",
    readRequest: vi.fn(),
}));
import { State, Editor, Modal, Table } from "./ui";
afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.restoreAllMocks();
    uiMode.mode = "user";
});
it("guards every dismissal route while saving and confirms unsaved changes", () => {
    const close = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const content = (busy: boolean) => (
        <Modal title="Guarded editor" close={close} guardChanges>
            <form aria-busy={busy} data-unsaved="true">
                <input aria-label="Draft" />
            </form>
        </Modal>
    );
    const view = render(content(true));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /关闭|Close/ }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(close).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    view.rerender(content(false));
    fireEvent.click(screen.getByRole("button", { name: /关闭|Close/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(close).toHaveBeenCalledTimes(1);
});
it("cycles focus around visible enabled controls rather than hidden or disabled fields", () => {
    render(
        <Modal title="Focus" close={vi.fn()} initialFocus="#hidden-field">
            <button>Last usable action</button>
            <div hidden>
                <button>Hidden parent</button>
            </div>
            <div style={{ display: "none" }}>
                <button>Hidden style</button>
            </div>
            <fieldset disabled>
                <button>Disabled group</button>
            </fieldset>
            <button tabIndex={-1}>Programmatic only</button>
            <input type="hidden" tabIndex={0} id="hidden-field" />
        </Modal>,
    );
    const first = screen.getByRole("button", { name: /关闭|Close/ });
    const last = screen.getByRole("button", { name: "Last usable action" });
    expect(document.activeElement).toBe(first);
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
});
it("only dismisses the top dialog and keeps the page locked until every dialog closes", () => {
    const outer = vi.fn(),
        inner = vi.fn();
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    document.body.style.overflow = "auto";
    const first = render(
        <Modal title="Outer" close={outer}>
            <button>Outer action</button>
        </Modal>,
    );
    const second = render(
        <Modal title="Inner" close={inner}>
            <button>Inner action</button>
        </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    expect(root.inert).toBe(true);
    first.unmount();
    expect(document.body.style.overflow).toBe("hidden");
    expect(root.inert).toBe(true);
    second.unmount();
    expect(document.body.style.overflow).toBe("auto");
    expect(root.inert).toBe(false);
    root.remove();
    document.body.style.overflow = "";
});
it("blocks repeated submissions until failure and then allows retry", async () => {
    let reject!: (error: Error) => void;
    const save = vi
        .fn()
        .mockImplementationOnce(
            () =>
                new Promise((_, fail) => {
                    reject = fail;
                }),
        )
        .mockResolvedValue(undefined);
    render(
        <Editor
            fields={[{ key: "name", label: "Name" }]}
            initial={{ name: "test" }}
            onSave={save}
        />,
    );
    const form = screen.getByRole("textbox").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(save).toHaveBeenCalledTimes(1);
    reject(new Error("Retry me"));
    await screen.findByText("Retry me");
    fireEvent.submit(form);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
});
it("keeps previous content after a refresh failure", () => {
    render(
        <State loading={false} error="offline" data={[]} retry={() => {}}>
            Existing content
        </State>,
    );
    expect(screen.getByText("Existing content")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("offline");
});
it("shows a cooldown for manual retries without replacing existing content", async () => {
    vi.useFakeTimers();
    try {
        const retry = vi.fn();
        render(
            <State
                loading={false}
                error="Limited"
                data={{ id: 1 }}
                retryAt={Date.now() + 2000}
                retry={retry}
            >
                <input aria-label="Retained choice" defaultValue="year" />
            </State>,
        );
        const field = screen.getByRole("textbox");
        expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
            true,
        );
        fireEvent.click(screen.getByRole("button"));
        expect(retry).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
        });
        expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
            false,
        );
        expect(screen.getByRole("textbox")).toBe(field);
        fireEvent.click(screen.getByRole("button"));
        expect(retry).toHaveBeenCalledTimes(1);
    } finally {
        vi.useRealTimers();
    }
});
it("preserves form drafts, focus and mounted actions through refresh and retry", () => {
    const mounted = vi.fn(),
        unmounted = vi.fn();
    function Draft() {
        const [text, setText] = useState("");
        useEffect(() => {
            mounted();
            return unmounted;
        }, []);
        return (
            <input
                aria-label="In-progress choice"
                value={text}
                onChange={(event) => setText(event.target.value)}
            />
        );
    }
    const content = (loading: boolean, error = "") => (
        <State
            data={{ id: 1 }}
            loading={loading}
            error={error}
            retry={() => {}}
        >
            <Draft />
        </State>
    );
    const view = render(content(false));
    const field = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Unfinished choice" } });
    field.focus();
    view.rerender(content(true));
    expect(screen.getByRole("status").textContent).toBeTruthy();
    expect(screen.getByRole("textbox")).toBe(field);
    expect(document.activeElement).toBe(field);
    view.rerender(content(false, "Connection unavailable"));
    expect(screen.getByRole("alert").textContent).toContain(
        "Connection unavailable",
    );
    view.rerender(content(true));
    view.rerender(content(false));
    expect(field.value).toBe("Unfinished choice");
    expect(document.activeElement).toBe(field);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
});
it("does not expose initial content before data loads or after an initial failure", () => {
    const content = (loading: boolean, error = "") => (
        <State loading={loading} error={error} data={null}>
            <p>Data-dependent action</p>
        </State>
    );
    const view = render(content(true));
    expect(screen.queryByText("Data-dependent action")).toBeNull();
    view.rerender(content(false, "Unavailable"));
    expect(screen.queryByText("Data-dependent action")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Unavailable");
});
it("restores a closed draft, retains it on failure and clears it on success", async () => {
    const save = vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(undefined);
    const form = () => (
        <Editor
            draftKey="test-ticket"
            fields={[{ key: "message", label: "Message", type: "textarea" }]}
            initial={{}}
            onSave={save}
        />
    );
    const first = render(form());
    fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "My unfinished message" },
    });
    first.unmount();
    render(form());
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
        "My unfinished message",
    );
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await screen.findByText("offline");
    expect(sessionStorage.length).toBe(1);
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(sessionStorage.length).toBe(0));
});

it("identifies and focuses an invalid admin field while preserving the rest of the draft", async () => {
    uiMode.mode = "admin";
    const save = vi.fn().mockResolvedValue(undefined);
    render(
        <Editor
            fields={[
                { key: "name", label: "Record name" },
                {
                    key: "config",
                    label: "Configuration",
                    type: "json",
                    hint: "Use a JSON object",
                },
            ]}
            initial={{ name: "Keep this draft", config: "{" }}
            onSave={save}
        />,
    );
    fireEvent.submit(
        screen.getByRole("textbox", { name: "Record name" }).closest("form")!,
    );
    const field = screen.getByRole("textbox", {
        name: "Configuration",
    }) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
    expect(screen.getByRole("alert").textContent).toContain("Configuration");
    expect(save).not.toHaveBeenCalled();
    expect(
        (
            screen.getByRole("textbox", {
                name: "Record name",
            }) as HTMLInputElement
        ).value,
    ).toBe("Keep this draft");
    fireEvent.change(field, { target: { value: '{"enabled":true}' } });
    expect(field.hasAttribute("aria-invalid")).toBe(false);
    fireEvent.submit(field.closest("form")!);
    await waitFor(() =>
        expect(save).toHaveBeenCalledExactlyOnceWith({
            name: "Keep this draft",
            config: { enabled: true },
        }),
    );
});
it("associates required multiselect failures with the option group and focuses an available choice", async () => {
    uiMode.mode = "admin";
    const save = vi.fn();
    render(
        <Editor
            fields={[
                {
                    key: "groups",
                    label: "Required groups",
                    type: "multiselect",
                    required: true,
                    options: [["1", "Primary group"]],
                },
            ]}
            initial={{ groups: [] }}
            onSave={save}
        />,
    );
    const group = screen.getByRole("group", { name: "Required groups" });
    fireEvent.submit(group.closest("form")!);
    const choice = screen.getByRole("checkbox", { name: /Primary group/ });
    await waitFor(() => expect(document.activeElement).toBe(choice));
    expect(group.getAttribute("aria-invalid")).toBe("true");
    expect(
        document.getElementById(group.getAttribute("aria-describedby")!)
            ?.textContent,
    ).toContain("Required groups");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(choice);
    expect(group.hasAttribute("aria-invalid")).toBe(false);
});
it("focuses admin server errors without clearing inputs or automatically resubmitting", async () => {
    uiMode.mode = "admin";
    const save = vi
        .fn()
        .mockRejectedValueOnce(Error("Server unavailable"))
        .mockResolvedValue(undefined);
    render(
        <Editor
            fields={[{ key: "name", label: "Draft name" }]}
            initial={{ name: "Draft" }}
            onSave={save}
        />,
    );
    const field = screen.getByRole("textbox", {
        name: "Draft name",
    }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Changed draft" } });
    fireEvent.submit(field.closest("form")!);
    const error = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(error));
    expect(field.value).toBe("Changed draft");
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
});
it("also observes Retry-After in retained admin views", async () => {
    uiMode.mode = "admin";
    vi.useFakeTimers();
    try {
        const retry = vi.fn();
        render(
            <State
                data={[]}
                loading={false}
                error="Limited"
                retryAt={Date.now() + 2000}
                retry={retry}
            >
                <input aria-label="Retained admin draft" defaultValue="Keep" />
            </State>,
        );
        const input = screen.getByRole("textbox");
        expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
            true,
        );
        fireEvent.click(screen.getByRole("button"));
        expect(retry).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
        });
        expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
            false,
        );
        expect(screen.getByRole("textbox")).toBe(input);
    } finally {
        vi.useRealTimers();
    }
});
it("allows keyboard row ordering and prevents overlapping reorder writes", async () => {
    uiMode.mode = "admin";
    let resolve!: () => void;
    const save = vi.fn().mockImplementation(
        () =>
            new Promise<void>((done) => {
                resolve = done;
            }),
    );
    function Ordered() {
        const [rows, setRows] = useState([
            { id: 1, name: "Alpha" },
            { id: 2, name: "Beta" },
        ]);
        return (
            <Table
                data={rows}
                columns={[["name", "Name"]]}
                onReorder={async (next) => {
                    await save(next);
                    setRows(next as typeof rows);
                }}
            />
        );
    }
    render(<Ordered />);
    const handle = screen.getByRole("button", { name: /Alpha/ });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].map((row: any) => row.id)).toEqual([2, 1]);
    await act(async () => {
        resolve();
    });
    expect(screen.getAllByRole("row")[1].textContent).toContain("Beta");
    expect(document.activeElement).toBe(handle);
});
it("retains the original order and exposes a failed keyboard reorder for explicit retry", async () => {
    uiMode.mode = "admin";
    const save = vi
        .fn()
        .mockRejectedValueOnce(Error("Reorder unavailable"))
        .mockResolvedValue(undefined);
    render(
        <Table
            data={[
                { id: 1, name: "Alpha" },
                { id: 2, name: "Beta" },
            ]}
            columns={[["name", "Name"]]}
            onReorder={save}
        />,
    );
    const handle = screen.getByRole("button", { name: /Alpha/ });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    await screen.findByText("Reorder unavailable");
    expect(screen.getAllByRole("row")[1].textContent).toContain("Alpha");
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
});
