// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../shared/api", () => ({ request: mocks.request }));
vi.mock("../shared/i18n", () => ({ tx: (key: string) => key }));
import ClientAuthorization, { clientCallback } from "./ClientAuthorization";
import { v10Request } from "../shared/v10-api";
const id = "a".repeat(64),
    code = "b".repeat(64),
    state = "s".repeat(43);
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
beforeEach(() => {
    mocks.request.mockReset();
    vi.stubGlobal("location", {
        hash: "#/client-authorize?authorizationId=" + id,
        pathname: "/app",
        assign: vi.fn(),
    });
});
describe("client browser authorization", () => {
    it("maps authenticated reads and consent onto V10 resources", () => {
        expect(
            v10Request("user/client-authorization?authorization_id=" + id).url,
        ).toBe("/api/v10/me/client-authorizations/" + id);
        const approval = v10Request("user/client-authorization/approve", {
            authorization_id: id,
        });
        expect(approval.url).toBe(
            "/api/v10/me/client-authorizations/" + id + "/approval",
        );
        expect(approval.method).toBe("POST");
        expect(approval.body).toBe("{}");
    });
    it("accepts only dedicated callbacks with code and state", () => {
        expect(
            clientCallback(
                `http://127.0.0.1:48321/fastai-auth/callback?code=${code}&state=${state}`,
            ),
        ).toContain("127.0.0.1");
        expect(
            clientCallback(
                `ws.fastdog.fastai://oauth/callback?code=${code}&state=${state}`,
            ),
        ).toContain("ws.fastdog.fastai:");
        for (const value of [
            `https://evil.example/?code=${code}&state=${state}`,
            `http://localhost:48321/fastai-auth/callback?code=${code}&state=${state}`,
            `ws.fastdog.fastai://import/profile?code=${code}&state=${state}`,
            `http://127.0.0.1:48321/fastai-auth/callback?code=${code}&state=${state}&url=secret`,
        ])
            expect(() => clientCallback(value)).toThrow();
    });
    it("requires explicit consent, then offers a return link", async () => {
        const callback = `http://127.0.0.1:48321/fastai-auth/callback?code=${code}&state=${state}`;
        mocks.request
            .mockResolvedValueOnce({ data: { platform: "windows" } })
            .mockResolvedValueOnce({ data: { callbackUrl: callback } });
        vi.spyOn(history, "replaceState").mockImplementation(() => {});
        render(<ClientAuthorization user={{ email: "user@example.com" }} />);
        const button = await screen.findByRole("button", { name: "确认登录" });
        await waitFor(() =>
            expect((button as HTMLButtonElement).disabled).toBe(false),
        );
        expect(mocks.request).toHaveBeenCalledTimes(1);
        fireEvent.click(button);
        const link = await screen.findByRole("link", { name: "返回 FastAI" });
        expect(link.getAttribute("href")).toBe(callback);
        expect(location.assign).toHaveBeenCalledWith(callback);
        expect(mocks.request).toHaveBeenLastCalledWith(
            "user/client-authorization/approve",
            { authorization_id: id },
        );
    });
    it("does not approve expired requests", async () => {
        mocks.request.mockRejectedValue(new Error("expired"));
        render(<ClientAuthorization user={{ email: "user@example.com" }} />);
        await screen.findByRole("alert");
        expect(
            (
                screen.getByRole("button", {
                    name: "确认登录",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(true);
        expect(mocks.request).toHaveBeenCalledTimes(1);
    });
});
