// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,render,screen,fireEvent,waitFor} from "@testing-library/react";
const mocks=vi.hoisted(()=>({boot:{passkeyEnabled:true},login:vi.fn(),supported:vi.fn(),request:vi.fn(),register:vi.fn(),logout:vi.fn()}));
vi.mock("./api",()=>({boot:mocks.boot,logoutSession:mocks.logout}));
vi.mock("./i18n",()=>({tx:(key:string)=>key}));
vi.mock("./timezone",()=>({formatInstant:(s:string)=>s}));
vi.mock("./passkey-api",()=>({loginPasskey:mocks.login,passkeySupported:mocks.supported,passkeyError:(e:Error)=>e.message,passkeyRequest:mocks.request,registerPasskey:mocks.register}));
vi.mock("./ui",()=>({Modal:({children,title}:any)=><div role="dialog"><h2>{title}</h2>{children}</div>}));
import {PasskeyLogin} from "./PasskeyLogin";
import {PasskeySecurity} from "./PasskeySecurity";
beforeEach(()=>{vi.resetAllMocks();mocks.boot.passkeyEnabled=true;mocks.supported.mockReturnValue(true);});afterEach(cleanup);
it("hides disabled Passkey sign-in",()=>{mocks.boot.passkeyEnabled=false;render(<PasskeyLogin onMfa={vi.fn()} onComplete={vi.fn()}/>);expect(screen.queryByRole("button")).toBeNull();});
it("does not finish authentication until existing MFA completes",async()=>{
 const mfa=vi.fn(),complete=vi.fn();const challenge={mfaRequired:true,challengeId:"challenge"};mocks.login.mockResolvedValue(challenge);
 render(<PasskeyLogin onMfa={mfa} onComplete={complete}/>);fireEvent.click(screen.getByRole("button"));await waitFor(()=>expect(mfa).toHaveBeenCalledWith(challenge));expect(complete).not.toHaveBeenCalled();
});
it("finishes successful sign-in and displays recoverable failures",async()=>{
 const complete=vi.fn();mocks.login.mockRejectedValueOnce(new Error("Cancelled")).mockResolvedValueOnce({authenticated:true});render(<PasskeyLogin onMfa={vi.fn()} onComplete={complete}/>);
 fireEvent.click(screen.getByRole("button"));expect(await screen.findByRole("alert")).toHaveProperty("textContent","Cancelled");fireEvent.click(screen.getByRole("button"));await waitFor(()=>expect(complete).toHaveBeenCalledTimes(1));
});
it("disables unsupported browser sign-in with password fallback guidance",()=>{mocks.supported.mockReturnValue(false);render(<PasskeyLogin onMfa={vi.fn()} onComplete={vi.fn()}/>);expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(/请使用密码登录/)).toBeTruthy();});
it("lists disabled credentials and requires a password before removal",async()=>{
 mocks.request.mockResolvedValueOnce({enabled:false,credentials:[{id:7,name:"Device",rpId:"example.test",createdAt:"now",lastUsedAt:null}]}).mockResolvedValue(undefined);mocks.logout.mockResolvedValue(undefined);
 render(<PasskeySecurity/>);await screen.findByText("Device");expect(screen.queryByRole("button",{name:"绑定 Passkey"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"移除"}));const password=screen.getAllByLabelText("当前密码").at(-1)!;expect((password as HTMLInputElement).required).toBe(true);
 fireEvent.change(password,{target:{value:"current-password"}});fireEvent.submit(screen.getByRole("button",{name:"确认移除 Passkey"}).closest("form")!);
 await waitFor(()=>expect(mocks.logout).toHaveBeenCalled());expect(mocks.request).toHaveBeenCalledWith("me/security/passkeys/7",{password:"current-password"},"DELETE",expect.any(AbortSignal));
});
it("shows deletion failures inside the dialog and clears the entered password",async()=>{
 mocks.request.mockResolvedValueOnce({enabled:true,credentials:[{id:7,name:"Device",rpId:"example.test",createdAt:"now",lastUsedAt:null}]}).mockRejectedValueOnce(new Error("Incorrect password"));
 render(<PasskeySecurity/>);await screen.findByText("Device");fireEvent.click(screen.getByRole("button",{name:"移除"}));const input=screen.getAllByLabelText("当前密码").at(-1)!;fireEvent.change(input,{target:{value:"wrong-password"}});fireEvent.submit(screen.getByRole("button",{name:"确认移除 Passkey"}).closest("form")!);
 const error=await screen.findByRole("alert");expect(screen.getByRole("dialog").contains(error)).toBe(true);expect((input as HTMLInputElement).value).toBe("");expect(mocks.logout).not.toHaveBeenCalled();
});
it("hides disabled unused Passkey settings without a loading flash",async()=>{
 let resolve!:(value:any)=>void;mocks.request.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const view=render(<PasskeySecurity/>);expect(view.container.innerHTML).toBe("");
 resolve({enabled:false,credentials:[]});await waitFor(()=>expect(mocks.request).toHaveBeenCalled());
 expect(screen.queryByText("Passkey")).toBeNull();expect(screen.queryByRole("button")).toBeNull();
});
it("cancels a pending device request on navigation and ignores its late result",async()=>{
 let resolve!:(value:any)=>void;mocks.login.mockImplementation(()=>new Promise(r=>{resolve=r;}));const complete=vi.fn();const view=render(<PasskeyLogin onMfa={vi.fn()} onComplete={complete}/>);fireEvent.click(screen.getByRole("button"));const signal=mocks.login.mock.calls[0][0] as AbortSignal;view.unmount();expect(signal.aborted).toBe(true);resolve({authenticated:true});await Promise.resolve();expect(complete).not.toHaveBeenCalled();
});
