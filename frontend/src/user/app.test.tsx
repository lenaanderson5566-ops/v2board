// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {act,cleanup,render,screen,waitFor} from "@testing-library/react";
const mocks=vi.hoisted(()=>({read:vi.fn(),language:vi.fn().mockResolvedValue(undefined)}));
vi.mock("../shared/api",()=>({boot:{mode:"user",title:"Test",landing:false},request:vi.fn(),readRequest:mocks.read,navigate:vi.fn(),clearReadCache:vi.fn(),logoutSession:vi.fn()}));
vi.mock("../shared/browser-session",()=>({initializeBrowserSession:vi.fn().mockResolvedValue(undefined),hasBrowserSession:()=>true,forgetBrowserSession:vi.fn()}));
vi.mock("../shared/i18n",()=>({tx:(key:string)=>key,locale:()=>"en-US",setLanguagePersistence:vi.fn(),applyAccountLanguage:mocks.language}));
vi.mock("react-i18next",()=>({useTranslation:()=>({})}));
vi.mock("../shared/LanguagePicker",()=>({LanguagePicker:()=>null}));
vi.mock("../shared/WorkspaceSkeleton",()=>({WorkspaceSkeleton:()=> <p>Loading</p>,LandingSkeleton:()=>null}));
vi.mock("./UserAuth",()=>({UserAuth:()=> <p>Sign in</p>}));
vi.mock("./AnalyticsPrivacy",()=>({AnalyticsPrivacy:()=>null,AnalyticsPrivacyFooter:()=>null,PrivacyFooterLinks:()=>null}));
vi.mock("./EmbeddedBrowserNotice",()=>({BrowserAccessGate:({children}:any)=>children}));
vi.mock("./chat-layout",()=>({installChatLayout:()=>()=>{}}));
vi.mock("./AccountEntry",()=>({UserStatusGate:({children}:any)=>children}));
vi.mock("./AnnouncementCenter",()=>({AnnouncementCenter:()=>null}));
vi.mock("./InviteCampaign",()=>({InviteCampaign:()=>null}));
vi.mock("./AccountMenu",()=>({AccountMenu:()=>null}));
vi.mock("./user-entry",()=>({default:()=> <p>Protected workspace</p>}));
import App from "./app";
beforeEach(()=>{
    mocks.read.mockReset();mocks.language.mockClear();
    window.location.hash="#/dashboard";window.scrollTo=vi.fn();
    vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
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
