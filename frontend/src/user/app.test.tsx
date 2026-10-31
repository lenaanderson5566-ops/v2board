// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
const mocks=vi.hoisted(()=>({read:vi.fn(),language:vi.fn().mockResolvedValue(undefined),workspaceLanguage:vi.fn().mockResolvedValue(undefined),initialize:vi.fn(),forget:vi.fn(),workspaceLoaded:vi.fn(),gateAllowed:true,authenticated:true,brokenRoute:"",brokenHeader:false,logins:[] as Array<(account:any,options?:any)=>void>}));
vi.mock("../shared/api",()=>({boot:{mode:"user",title:"Test",landing:false},request:vi.fn(),readRequest:mocks.read,navigate:vi.fn(),clearReadCache:vi.fn(),logoutSession:vi.fn()}));
vi.mock("../shared/browser-session",()=>({initializeBrowserSession:mocks.initialize,hasBrowserSession:()=>mocks.authenticated,forgetBrowserSession:mocks.forget}));
vi.mock("../shared/i18n",()=>({tx:(key:string)=>key,locale:()=>"en-US",setLanguagePersistence:vi.fn(),applyAccountLanguage:mocks.language,prepareWorkspaceLanguage:mocks.workspaceLanguage}));
vi.mock("react-i18next",()=>({useTranslation:()=>({})}));
vi.mock("../shared/LanguagePicker",()=>({LanguagePicker:()=>null}));
vi.mock("../shared/WorkspaceSkeleton",()=>({WorkspaceSkeleton:()=> <p>Loading</p>,LandingSkeleton:()=>null}));
vi.mock("./UserAuth",()=>({UserAuth:({redirectPath,onLogin}:any)=> {mocks.logins.push(onLogin);return <><p>Sign in</p><output data-testid="login-return">{redirectPath}</output></>;}}));
vi.mock("./AnalyticsPrivacy",()=>({AnalyticsPrivacy:()=>null,AnalyticsPrivacyFooter:()=>null,PrivacyFooterLinks:()=>null}));
vi.mock("./EmbeddedBrowserNotice",()=>({BrowserAccessGate:({children}:any)=>mocks.gateAllowed ? children : <p>Browser entry</p>}));
vi.mock("./UserWorkspace",async(importOriginal)=>{
    mocks.workspaceLoaded();
    return importOriginal<typeof import("./UserWorkspace")>();
});
vi.mock("./chat-layout",()=>({installChatLayout:()=>()=>{}}));
vi.mock("./UserStatusGate",()=>({UserStatusGate:({children}:any)=>children}));
vi.mock("./AnnouncementCenter",()=>({AnnouncementCenter:()=>{if(mocks.brokenHeader)throw Error("Header chunk unavailable");return null;}}));
vi.mock("./InviteCampaign",()=>({InviteCampaign:()=>null}));
vi.mock("./AccountMenu",()=>({AccountMenu:()=>null}));
vi.mock("./user-entry",()=>({default:({current,path}:any)=> {
    if (mocks.brokenRoute === current) throw Error("Technical render failure");
    return <><p>Protected workspace</p><output data-testid="workspace-path">{path}</output><input aria-label="Page action" /></>;
}}));
import App from "./app";
import { configureTimeZone, setDisplayTimeZone } from "../shared/timezone";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { browserHandoffUrl } from "../shared/browser-access";
beforeEach(()=>{
    mocks.read.mockReset();mocks.language.mockReset().mockResolvedValue(undefined);mocks.brokenRoute="";mocks.brokenHeader=false;
    mocks.workspaceLanguage.mockReset().mockResolvedValue(undefined);
    mocks.initialize.mockReset().mockResolvedValue(undefined);mocks.forget.mockClear();mocks.authenticated=true;mocks.gateAllowed=true;
    mocks.logins=[];
    configureTimeZone("UTC"); setDisplayTimeZone(null);
    document.title="Test";
    window.location.hash="#/dashboard";window.scrollTo=vi.fn();
    vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
it("shows a recoverable startup message without exposing failed chunk URLs",()=>{
    vi.spyOn(console,"error").mockImplementation(()=>{});
    const BrokenChunk=():never=>{throw new TypeError("Failed to fetch dynamically imported module: https://example.test/assets/private-chunk.js");};
    render(<ErrorBoundary><BrokenChunk/></ErrorBoundary>);
    expect(screen.getByRole("heading",{name:"页面暂时无法加载"})).toBeTruthy();
    expect(screen.getByText("无法完成操作，请刷新页面后重试。")).toBeTruthy();
    expect(screen.getByRole("button",{name:"重新加载"})).toBeTruthy();
    expect(screen.queryByText(/private-chunk/)).toBeNull();
});
it("loads the business workspace only after the browser gate admits the page",async()=>{
    mocks.gateAllowed=false;
    mocks.read.mockResolvedValue({data:{id:42,language:"en-US",account_status:{state:"active"}}});
    const view=render(<App/>);
    expect(screen.getByText("Browser entry")).toBeTruthy();
    await act(async()=>{await Promise.resolve();});
    expect(mocks.workspaceLoaded).not.toHaveBeenCalled();
    expect(mocks.workspaceLanguage).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.gateAllowed=true;
    let finishLanguage!: () => void;
    mocks.workspaceLanguage.mockReturnValueOnce(new Promise<void>(resolve => { finishLanguage = resolve; }));
    view.rerender(<App/>);
    await waitFor(() => expect(mocks.workspaceLoaded).toHaveBeenCalledTimes(1));
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => finishLanguage());
    expect(await screen.findByText("Protected workspace", {}, {timeout:3000})).toBeTruthy();
    expect(mocks.workspaceLoaded).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceLanguage).toHaveBeenCalledTimes(1);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledTimes(1);
});
it("does not restore an expired session from an earlier account request",async()=>{
    let finish!:(value:any)=>void;mocks.read.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    render(<App/>);await waitFor(()=>expect(mocks.read).toHaveBeenCalled());
    act(()=>window.dispatchEvent(new Event("auth-expired")));
    expect(screen.getByText("Sign in")).toBeTruthy();
    await act(async()=>finish({data:{id:42,email:"old@example.test",language:"en-US",account_status:{state:"active"}}}));
    expect(screen.getByText("Sign in")).toBeTruthy();expect(screen.queryByText("Protected workspace")).toBeNull();
    expect(mocks.language).not.toHaveBeenCalled();
});
it.each([
    ["#/subscribe?token=private", "subscribe"],
    ["#/security/configuration-updates?token=private&userId=999", "security/configuration-updates"],
    ["#/security/configuration-updates/other?token=private", ""],
    ["#/knowledge?verify=private", "knowledge"],
    ["#/ticket/order/resume_123?requestKey=private", "ticket/order/resume_123"],
    ["#/plan/1?period=year_price&couponId=7&replace=old_order&pay=true", "plan/1?period=year_price&couponId=7&replace=old_order"],
    ["#/admin/users?token=private", ""],
    ["#/client-authorize?authorizationId=invalid", ""],
])("keeps only safe page context when another browser needs sign-in: %s",async(hash, expected)=>{
    mocks.authenticated=false;
    history.replaceState(null,"",new URL(browserHandoffUrl(new URL(hash,location.href).href)).hash);
    render(<App/>);
    await screen.findByText("Sign in");
    expect(screen.getByTestId("login-return").textContent).toBe(expected);
    expect(mocks.read).not.toHaveBeenCalled();
});
it("ignores initial account loading after the shell is unmounted",async()=>{
    let finish!:(value:any)=>void;mocks.read.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const view=render(<App/>);await waitFor(()=>expect(mocks.read).toHaveBeenCalled());view.unmount();
    await act(async()=>finish({data:{id:42,language:"en-US"}}));expect(mocks.language).not.toHaveBeenCalled();
});
it("retains the inline order reference after session expiry without carrying payment instructions",async()=>{
    history.replaceState(null,"","#/plan/1?period=year_price");
    mocks.read.mockResolvedValue({data:{id:42,email:"viewer@example.test",language:"en-US",account_status:{state:"new"}}});
    render(<App/>);
    await screen.findByText("Protected workspace");
    history.replaceState(null,"","#/plan/1?order=resume_123&pay=true&requestKey=secret");
    act(()=>window.dispatchEvent(new Event("auth-expired")));
    await screen.findByText("Sign in");
    expect(screen.getByTestId("login-return").textContent).toBe("plan/1?order=resume_123");
});
const signedIn = () => mocks.read.mockResolvedValue({data:{id:42,email:"viewer@example.test",language:"en-US",account_status:{state:"active"}}});
const openRoute = (route:string) => act(()=>{
    history.replaceState(null,"",`#/${route}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
});
it.each([new TypeError("Network unavailable"), Object.assign(new Error("Server failed"),{status:503})])("recovers temporary account failures without discarding the session: %s",async(problem)=>{
    mocks.read.mockRejectedValueOnce(problem).mockResolvedValue({data:{id:42,email:"viewer@example.test",language:"en-US",account_status:{state:"active"}}});
    render(<App/>);
    expect(await screen.findByText("accountLoadFailed")).toBeTruthy();
    expect(screen.queryByText("Sign in")).toBeNull();
    expect(mocks.forget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"重试"}));
    expect(await screen.findByText("Protected workspace")).toBeTruthy();
    expect(mocks.read).toHaveBeenLastCalledWith("user/info",undefined,true);
    expect(mocks.forget).not.toHaveBeenCalled();
});
it("does not show a sign-in form until failed session metadata is successfully checked",async()=>{
    mocks.initialize.mockRejectedValueOnce(new Error("Metadata unavailable"));
    render(<App/>);
    await screen.findByText("accountLoadFailed");
    expect(screen.queryByText("Sign in")).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.authenticated=false;
    fireEvent.click(screen.getByRole("button",{name:"重试"}));
    expect(await screen.findByText("Sign in")).toBeTruthy();
    expect(mocks.forget).not.toHaveBeenCalled();
});
it("falls back to the current language and retries language loading without repeating authentication",async()=>{
    signedIn();mocks.language.mockRejectedValueOnce(new Error("Language chunk unavailable")).mockResolvedValue(undefined);
    render(<App/>);
    expect(await screen.findByText("Protected workspace")).toBeTruthy();
    expect(screen.getByText("languageLoadFailed")).toBeTruthy();
    expect(mocks.forget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"重试"}));
    await waitFor(()=>expect(screen.queryByText("languageLoadFailed")).toBeNull());
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.language).toHaveBeenCalledTimes(2);
});
it("clears the session only when authentication is known to have expired",async()=>{
    mocks.read.mockRejectedValueOnce(Object.assign(new Error("Expired"),{status:401}));
    render(<App/>);
    expect(await screen.findByText("Sign in")).toBeTruthy();
    expect(mocks.forget).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("accountLoadFailed")).toBeNull();
});
it("does not accept a late login completion from before session invalidation",async()=>{
    mocks.authenticated=false;
    history.replaceState(null,"","#/login");
    render(<App/>);
    await screen.findByText("Sign in");
    const lateLogin=mocks.logins.at(-1)!;
    act(()=>window.dispatchEvent(new Event("auth-expired")));
    act(()=>lateLogin({id:42,email:"stale@example.test",language:"en-US"}));
    expect(screen.queryByText("Protected workspace")).toBeNull();
    expect(screen.getByText("Sign in")).toBeTruthy();
    act(()=>mocks.logins.at(-1)!({id:43,email:"current@example.test",language:"en-US"}));
    expect(await screen.findByText("Protected workspace")).toBeTruthy();
});
it("respects account load cooldowns without automatic retries",async()=>{
    vi.useFakeTimers();
    try {
        mocks.read.mockRejectedValueOnce(Object.assign(new Error("Limited"),{status:429,retryAfter:2}));
        render(<App/>);
        await act(async()=>{await Promise.resolve();});
        expect((screen.getByRole("button",{name:"retryIn"}) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole("button",{name:"retryIn"}));
        expect(mocks.read).toHaveBeenCalledTimes(1);
        await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
        expect((screen.getByRole("button",{name:"重试"}) as HTMLButtonElement).disabled).toBe(false);
        expect(mocks.read).toHaveBeenCalledTimes(1);
    } finally {vi.useRealTimers();}
});
it("provides a skip action without changing the application route",async()=>{
    signedIn();
    Element.prototype.scrollIntoView=vi.fn();
    render(<App/>);
    await screen.findByText("Protected workspace");
    fireEvent.click(screen.getByRole("link",{name:"skip"}));
    expect(location.hash).toBe("#/dashboard");
    expect(document.activeElement).toBe(screen.getByRole("main"));
});
it("preserves the configuration-history security route for expired subscribers", async () => {
    history.replaceState(null, "", "#/security/configuration-updates");
    mocks.read.mockResolvedValue({ data: { id: 42, language: "en-US", account_status: { state: "expired" } } });
    render(<App />);
    await screen.findByText("Protected workspace");
    expect(screen.getByTestId("workspace-path").textContent).toBe("security/configuration-updates");
    expect(mocks.read.mock.calls.some(([path]) => path.includes("access-records"))).toBe(false);
});
it("moves focus and updates the title on page navigation without interrupting same-page payment queries",async()=>{
    signedIn();
    render(<App/>);
    await screen.findByText("Protected workspace");
    openRoute("plan/1");
    expect(document.activeElement).toBe(screen.getByRole("main"));
    expect(document.title).toBe("管理订阅 · Test");
    const field=screen.getByRole("textbox");
    field.focus();
    openRoute("plan/1?order=resume_123");
    expect(document.activeElement).toBe(field);
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
});
it("keeps navigation usable after one page fails and recovers when opening another",async()=>{
    signedIn();
    vi.spyOn(console,"error").mockImplementation(()=>{});
    render(<App/>);
    await screen.findByText("Protected workspace");
    mocks.brokenRoute="knowledge";
    openRoute("knowledge");
    expect(await screen.findByText("页面暂时无法加载")).toBeTruthy();
    expect(screen.getByText("pageRecovery")).toBeTruthy();
    expect(screen.queryByText("Technical render failure")).toBeNull();
    expect(screen.getByRole("button",{name:"打开导航"})).toBeTruthy();
    openRoute("dashboard");
    expect(await screen.findByText("Protected workspace")).toBeTruthy();
});
it("returns drawer focus when dismissed and focuses content after choosing another page",async()=>{
    signedIn();
    vi.stubGlobal("matchMedia",()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
    render(<App/>);
    await screen.findByText("Protected workspace");
    const trigger=screen.getByRole("button",{name:"打开导航"});
    trigger.focus();fireEvent.click(trigger);
    const drawer=screen.getByRole("dialog",{name:"工作空间"});
    expect(drawer.id).toBe(trigger.getAttribute("aria-controls"));
    fireEvent.keyDown(window,{key:"Escape"});
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    openRoute("dashboard?updated=true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    openRoute("knowledge");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("main"));
});
it("keeps authenticated content and navigation usable when optional header controls fail",async()=>{
    signedIn();mocks.brokenHeader=true;
    vi.spyOn(console,"error").mockImplementation(()=>{});
    render(<App/>);
    expect(await screen.findByText("Protected workspace")).toBeTruthy();
    expect(await screen.findByRole("button",{name:"重新加载"})).toBeTruthy();
    expect(screen.getByRole("button",{name:"打开导航"})).toBeTruthy();
    expect(screen.queryByText("Header chunk unavailable")).toBeNull();
    expect(screen.queryByText("pageRecovery")).toBeNull();
});
it("loads and sanitizes an optional custom footer without delaying authentication",async()=>{
    const {boot}=await import("../shared/api");
    boot.footerHtml='<p>Optional footer</p><script>window.untrustedFooter=true</script><a href="javascript:alert(1)">Footer link</a>';
    mocks.authenticated=false;
    try {
        render(<App/>);
        expect(await screen.findByText("Sign in")).toBeTruthy();
        const footer=await screen.findByText("Optional footer");
        expect(footer.closest("footer")?.id).toBe("custom-footer");
        expect(document.querySelector("#custom-footer script")).toBeNull();
        expect(screen.getByText("Footer link").getAttribute("href")).toBeNull();
        cleanup();expect(document.getElementById("custom-footer")).toBeNull();
    } finally {delete boot.footerHtml;}
});

it("redraws the workspace calendar immediately when the personal zone changes without refetching", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T00:30:00Z"));
    try {
        setDisplayTimeZone("Asia/Shanghai");
        signedIn();
        render(<App />);
        await screen.findByText("Protected workspace");
        const today = document.querySelector(".today")!;
        expect(today.textContent).toContain("November 1");
        const reads = mocks.read.mock.calls.length;
        act(() => setDisplayTimeZone("Pacific/Honolulu"));
        expect(today.textContent).toContain("October 31");
        expect(mocks.read).toHaveBeenCalledTimes(reads);
        act(() => setDisplayTimeZone("Asia/Shanghai"));
        expect(today.textContent).toContain("November 1");
    } finally { vi.useRealTimers(); }
});

it("advances the visible personal calendar across midnight without fetching account data", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-01T23:59:30Z"));
    try {
        setDisplayTimeZone("UTC");
        signedIn();
        render(<App />);
        await screen.findByText("Protected workspace");
        const today = document.querySelector(".today")!;
        expect(today.textContent).toContain("November 1");
        const reads = mocks.read.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
        expect(today.textContent).toContain("November 2");
        expect(mocks.read).toHaveBeenCalledTimes(reads);
        vi.setSystemTime(new Date("2026-11-03T01:00:00Z"));
        act(() => { window.dispatchEvent(new Event("focus")); });
        expect(today.textContent).toContain("November 3");
        expect(mocks.read).toHaveBeenCalledTimes(reads);
    } finally { cleanup(); vi.useRealTimers(); }
});
