// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
const mocks=vi.hoisted(()=>({read:vi.fn(),language:vi.fn().mockResolvedValue(undefined),brokenRoute:""}));
vi.mock("../shared/api",()=>({boot:{mode:"user",title:"Test",landing:false},request:vi.fn(),readRequest:mocks.read,navigate:vi.fn(),clearReadCache:vi.fn(),logoutSession:vi.fn()}));
vi.mock("../shared/browser-session",()=>({initializeBrowserSession:vi.fn().mockResolvedValue(undefined),hasBrowserSession:()=>true,forgetBrowserSession:vi.fn()}));
vi.mock("../shared/i18n",()=>({tx:(key:string)=>key,locale:()=>"en-US",setLanguagePersistence:vi.fn(),applyAccountLanguage:mocks.language}));
vi.mock("react-i18next",()=>({useTranslation:()=>({})}));
vi.mock("../shared/LanguagePicker",()=>({LanguagePicker:()=>null}));
vi.mock("../shared/WorkspaceSkeleton",()=>({WorkspaceSkeleton:()=> <p>Loading</p>,LandingSkeleton:()=>null}));
vi.mock("./UserAuth",()=>({UserAuth:({redirectPath}:any)=> <><p>Sign in</p><output data-testid="login-return">{redirectPath}</output></>}));
vi.mock("./AnalyticsPrivacy",()=>({AnalyticsPrivacy:()=>null,AnalyticsPrivacyFooter:()=>null,PrivacyFooterLinks:()=>null}));
vi.mock("./EmbeddedBrowserNotice",()=>({BrowserAccessGate:({children}:any)=>children}));
vi.mock("./chat-layout",()=>({installChatLayout:()=>()=>{}}));
vi.mock("./AccountEntry",()=>({UserStatusGate:({children}:any)=>children}));
vi.mock("./AnnouncementCenter",()=>({AnnouncementCenter:()=>null}));
vi.mock("./InviteCampaign",()=>({InviteCampaign:()=>null}));
vi.mock("./AccountMenu",()=>({AccountMenu:()=>null}));
vi.mock("./user-entry",()=>({default:({current}:any)=> {
    if (mocks.brokenRoute === current) throw Error("Technical render failure");
    return <><p>Protected workspace</p><input aria-label="Page action" /></>;
}}));
import App from "./app";
beforeEach(()=>{
    mocks.read.mockReset();mocks.language.mockClear();mocks.brokenRoute="";
    document.title="Test";
    window.location.hash="#/dashboard";window.scrollTo=vi.fn();
    vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
it("does not restore an expired session from an earlier account request",async()=>{
    let finish!:(value:any)=>void;mocks.read.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    render(<App/>);await waitFor(()=>expect(mocks.read).toHaveBeenCalled());
    act(()=>window.dispatchEvent(new Event("auth-expired")));
    expect(screen.getByText("Sign in")).toBeTruthy();
    await act(async()=>finish({data:{id:42,email:"old@example.test",language:"en-US",account_status:{state:"active"}}}));
    expect(screen.getByText("Sign in")).toBeTruthy();expect(screen.queryByText("Protected workspace")).toBeNull();
    expect(mocks.language).not.toHaveBeenCalled();
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
it("provides a skip action without changing the application route",async()=>{
    signedIn();
    Element.prototype.scrollIntoView=vi.fn();
    render(<App/>);
    await screen.findByText("Protected workspace");
    fireEvent.click(screen.getByRole("link",{name:"skip"}));
    expect(location.hash).toBe("#/dashboard");
    expect(document.activeElement).toBe(screen.getByRole("main"));
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
