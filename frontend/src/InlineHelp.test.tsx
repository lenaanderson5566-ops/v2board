// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { InlineHelp } from "./InlineHelp";
afterEach(cleanup);
it("exposes a named disclosure and lets keyboard users dismiss it", () => {
    render(<InlineHelp label="Balance rules">Available for purchases</InlineHelp>);
    const trigger = screen.getByLabelText("Balance rules");
    const details = trigger.closest("details")!;
    expect(details.open).toBe(false);
    details.open = true;
    fireEvent.keyDown(details, { key: "Escape" });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
});
