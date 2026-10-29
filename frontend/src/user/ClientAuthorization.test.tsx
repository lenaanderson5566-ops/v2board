// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    act,
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
        mocks.request.mockRejectedValue(Object.assign(new Error("expired"), { code: "CLIENT_AUTH_EXPIRED", status: 410 }));
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

it("rechecks temporary read failures in place without approving automatically", async () => {
    mocks.request.mockRejectedValueOnce(Object.assign(new Error("Unavailable"), { status: 503 }))
        .mockResolvedValue({ data: { platform: "windows" } });
    render(<ClientAuthorization user={{email:"user@example.test"}} />);
    const retry = await screen.findByRole("button", {name:"authorizationRecheck"});
    expect(mocks.request).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await waitFor(()=>expect(screen.getByRole("button", {name:"确认登录"})).toHaveProperty("disabled",false));
    expect(mocks.request.mock.calls.map(([path])=>path)).toEqual([
        "user/client-authorization?authorization_id="+id,
        "user/client-authorization?authorization_id="+id,
    ]);
    expect(location.assign).not.toHaveBeenCalled();
});

it("requires a fresh pending-state read and explicit consent after an unknown approval result", async () => {
    const callback = `http://127.0.0.1:48321/fastai-auth/callback?code=${code}&state=${state}`;
    mocks.request.mockResolvedValueOnce({data:{platform:"windows"}})
        .mockRejectedValueOnce(new TypeError("Connection lost"))
        .mockResolvedValueOnce({data:{platform:"windows"}})
        .mockResolvedValueOnce({data:{callbackUrl:callback}});
    vi.spyOn(history,"replaceState").mockImplementation(()=>{});
    render(<ClientAuthorization user={{email:"user@example.test"}} />);
    await waitFor(()=>expect(screen.getByRole("button",{name:"确认登录"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button",{name:"确认登录"}));
    fireEvent.click(await screen.findByRole("button",{name:"authorizationRecheck"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"确认登录"})).toHaveProperty("disabled",false));
    expect(mocks.request.mock.calls.filter(([path])=>path.endsWith("/approve"))).toHaveLength(1);
    expect(location.assign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"确认登录"}));
    await screen.findByRole("link",{name:"返回 FastAI"});
    expect(mocks.request.mock.calls.filter(([path])=>path.endsWith("/approve"))).toHaveLength(2);
    expect(location.assign).toHaveBeenCalledTimes(1);
});

it("does not retry approval if rechecking finds the request was consumed or expired", async () => {
    mocks.request.mockResolvedValueOnce({data:{platform:"windows"}})
        .mockRejectedValueOnce(new TypeError("Connection lost"))
        .mockRejectedValueOnce(Object.assign(new Error("Gone"),{code:"CLIENT_AUTH_EXPIRED",status:410}));
    render(<ClientAuthorization user={{email:"user@example.test"}} />);
    await waitFor(()=>expect(screen.getByRole("button",{name:"确认登录"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button",{name:"确认登录"}));
    fireEvent.click(await screen.findByRole("button",{name:"authorizationRecheck"}));
    await screen.findByText("authorizationUnavailable");
    expect(screen.queryByRole("button",{name:"authorizationRecheck"})).toBeNull();
    expect(screen.getByRole("button",{name:"确认登录"})).toHaveProperty("disabled",true);
    expect(mocks.request.mock.calls.filter(([path])=>path.endsWith("/approve"))).toHaveLength(1);
    expect(location.assign).not.toHaveBeenCalled();
});

it("honors a server cooldown without automatic queries or approval", async () => {
    vi.useFakeTimers();
    try {
        mocks.request.mockRejectedValueOnce(Object.assign(new Error("Limited"),{status:429,retryAfter:2}))
            .mockResolvedValue({data:{platform:"windows"}});
        render(<ClientAuthorization user={{email:"user@example.test"}} />);
        await act(async()=>{await Promise.resolve();});
        const retry=screen.getByRole("button",{name:"retryIn"});
        expect(retry).toHaveProperty("disabled",true);
        fireEvent.click(retry);
        expect(mocks.request).toHaveBeenCalledTimes(1);
        await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
        expect(mocks.request).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button",{name:"authorizationRecheck"}));
        await act(async()=>{await Promise.resolve();});
        expect(mocks.request).toHaveBeenCalledTimes(2);
        expect(mocks.request.mock.calls.filter(([path])=>path.endsWith("/approve"))).toHaveLength(0);
    } finally {vi.useRealTimers();}
});

it("does not offer recovery through an unsafe approval callback", async () => {
    mocks.request.mockResolvedValueOnce({data:{platform:"windows"}})
        .mockResolvedValueOnce({data:{callbackUrl:`https://evil.example/?code=${code}&state=${state}`}});
    render(<ClientAuthorization user={{email:"user@example.test"}} />);
    await waitFor(()=>expect(screen.getByRole("button",{name:"确认登录"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button",{name:"确认登录"}));
    await screen.findByText("授权响应无效，请返回 App 重试。");
    expect(screen.queryByRole("link",{name:"返回 FastAI"})).toBeNull();
    expect(screen.queryByRole("button",{name:"authorizationRecheck"})).toBeNull();
    expect(location.assign).not.toHaveBeenCalled();
});

it("ignores an approval response after its view is unmounted", async () => {
    let finish!:(value:any)=>void;
    mocks.request.mockResolvedValueOnce({data:{platform:"windows"}})
        .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const view=render(<ClientAuthorization user={{email:"user@example.test"}} />);
    await waitFor(()=>expect(screen.getByRole("button",{name:"确认登录"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button",{name:"确认登录"}));
    view.unmount();
    await act(async()=>finish({data:{callbackUrl:`http://127.0.0.1:48321/fastai-auth/callback?code=${code}&state=${state}`}}));
    expect(location.assign).not.toHaveBeenCalled();
});

it("loads a new authorization when the hash changes without reusing old consent",async()=>{
    const next="c".repeat(64);
    mocks.request.mockResolvedValue({data:{platform:"windows"}});
    render(<ClientAuthorization user={{email:"user@example.test"}}/>);
    await waitFor(()=>expect(screen.getByRole("button",{name:"确认登录"})).toHaveProperty("disabled",false));
    act(()=>{location.hash="#/client-authorize?authorizationId="+next;window.dispatchEvent(new Event("hashchange"));});
    await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("user/client-authorization?authorization_id="+next));
    expect(mocks.request.mock.calls.filter(([path])=>path.endsWith("/approve"))).toHaveLength(0);
});
it("ignores an old approval callback when a new authorization is opened",async()=>{
    let finish!:(value:any)=>void;
    mocks.request.mockResolvedValueOnce({data:{platform:"windows"}}).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({data:{platform:"ios"}});
    render(<ClientAuthorization user={{email:"user@example.test"}}/>);
    await waitFor(()=>expect(screen.getByRole("button",{name:"确认登录"})).toHaveProperty("disabled",false));
    fireEvent.click(screen.getByRole("button",{name:"确认登录"}));
    act(()=>{location.hash="#/client-authorize?authorizationId="+"c".repeat(64);window.dispatchEvent(new Event("hashchange"));});
    await act(async()=>finish({data:{callbackUrl:`http://127.0.0.1:48321/fastai-auth/callback?code=${code}&state=${state}`}}));
    expect(location.assign).not.toHaveBeenCalled();
    expect(screen.queryByRole("link",{name:"返回 FastAI"})).toBeNull();
});
