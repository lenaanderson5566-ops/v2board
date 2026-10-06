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
import { State, Editor } from "./ui";
afterEach(() => {
    cleanup();
    sessionStorage.clear();
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
