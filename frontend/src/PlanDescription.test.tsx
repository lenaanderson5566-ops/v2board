// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("./i18n", () => ({ tx: (key: string) => key }));
vi.mock("./ui", () => ({
    Html: ({ value }: { value: unknown }) => (
        <div data-testid="legacy-description">{String(value)}</div>
    ),
}));
import { parsePlanFeatures, PlanDescription } from "./PlanDescription";
afterEach(cleanup);
const features = [
    { feature: "每月 50GB 流量", support: true },
    { feature: "智能算法加速", support: false },
];
describe("plan descriptions", () => {
    it("renders legacy JSON strings as supported and unsupported feature rows", () => {
        render(<PlanDescription content={JSON.stringify(features)} />);
        expect(screen.getByText(features[0].feature)).toBeTruthy();
        expect(screen.getByText(features[1].feature)).toBeTruthy();
        expect(screen.getByRole("img", { name: "支持" })).toBeTruthy();
        expect(screen.getByRole("img", { name: "不支持" })).toBeTruthy();
        expect(screen.queryByTestId("legacy-description")).toBeNull();
    });
    it("accepts decoded arrays and preserves false values encoded by older editors", () => {
        expect(parsePlanFeatures(features)).toEqual(features);
        for (const support of [false, 0, "0", "false"])
            expect(
                parsePlanFeatures([{ feature: "test", support }])?.[0].support,
            ).toBe(false);
    });
    it("keeps HTML, plain text and malformed JSON on the existing renderer", () => {
        for (const content of [
            "<p>套餐说明</p>",
            "套餐说明",
            "[{",
            '[{"feature":"test","support":"unknown"}]',
        ])
            expect(parsePlanFeatures(content)).toBeNull();
        render(<PlanDescription content="<p>套餐说明</p>" />);
        expect(screen.getByTestId("legacy-description").textContent).toBe(
            "<p>套餐说明</p>",
        );
    });
    it("treats feature labels as text and does not execute embedded markup", () => {
        const { container } = render(
            <PlanDescription
                content={[
                    {
                        feature: '<img src=x onerror="alert(1)">',
                        support: true,
                    },
                ]}
            />,
        );
        expect(container.querySelector("img")).toBeNull();
        expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeTruthy();
    });
});
