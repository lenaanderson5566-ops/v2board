// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import {
    render,
    screen,
    fireEvent,
    waitFor,
    cleanup,
} from "@testing-library/react";
vi.mock("./api", () => ({
    boot: { mode: "user" },
    storageKey: "v2board.user.auth",
    readRequest: vi.fn(),
}));
import { State, Editor, Modal } from "./ui";
afterEach(() => {
    cleanup();
    sessionStorage.clear();
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
