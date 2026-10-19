// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({send:vi.fn(),authenticated:vi.fn(),forgotten:vi.fn()}));
vi.mock("./browser-session",()=>({browserFetch:mocks.send,markBrowserAuthenticated:mocks.authenticated,forgetBrowserSession:mocks.forgotten}));
vi.mock("./runtime-config",()=>({apiUrl:(path:string)=>path}));
vi.mock("./i18n",()=>({locale:()=>"en-US",tx:(key:string)=>key}));
import {loginPasskey,registerPasskey,passkeyRequest,passkeyError,passkeySupported} from "./passkey-api";
const binary=()=>new Uint8Array([251,255,0]).buffer;
const success=(data:unknown)=>new Response(JSON.stringify({data}),{status:200});
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal("isSecureContext",true);vi.stubGlobal("PublicKeyCredential",class{});Object.defineProperty(navigator,"credentials",{configurable:true,value:{create:vi.fn(),get:vi.fn()}});});
it("decodes registration options and sends only binary proofs after the password challenge",async()=>{
 mocks.send.mockResolvedValueOnce(success({challengeId:"opaque",publicKey:{challenge:"-_8A",rp:{id:"example.test"},user:{id:"-_8A"},authenticatorSelection:{userVerification:"required",residentKey:"required"},excludeCredentials:[{id:"-_8A",type:"public-key"}]}})).mockResolvedValueOnce(success({id:7}));
 vi.mocked(navigator.credentials.create).mockResolvedValue({type:"public-key",rawId:binary(),response:{clientDataJSON:binary(),attestationObject:binary()}} as unknown as Credential);
 expect(await registerPasskey("current-password","My device")).toEqual({id:7});
 const options=vi.mocked(navigator.credentials.create).mock.calls[0][0]!.publicKey!;
 expect(Array.from(new Uint8Array(options.challenge as ArrayBuffer))).toEqual([251,255,0]);expect(options.authenticatorSelection).toEqual({userVerification:"required",residentKey:"required"});
 expect(JSON.parse(mocks.send.mock.calls[0][1].body)).toEqual({password:"current-password",name:"My device"});
 expect(JSON.parse(mocks.send.mock.calls[1][1].body)).toEqual({challengeId:"opaque",credentialId:"-_8A",clientDataJSON:"-_8A",attestationObject:"-_8A"});
});
it("requests discoverable UV sign-in and marks only a completed browser grant",async()=>{
 mocks.send.mockResolvedValueOnce(success({challengeId:"challenge",publicKey:{challenge:"-_8A",rpId:"example.test",userVerification:"required"}})).mockResolvedValueOnce(success({authenticated:true,accountId:42}));
 vi.mocked(navigator.credentials.get).mockResolvedValue({type:"public-key",rawId:binary(),response:{clientDataJSON:binary(),authenticatorData:binary(),signature:binary(),userHandle:binary()}} as unknown as Credential);
 await loginPasskey();expect(vi.mocked(navigator.credentials.get).mock.calls[0][0]!.publicKey!.userVerification).toBe("required");
 expect(JSON.parse(mocks.send.mock.calls[1][1].body)).toEqual({challengeId:"challenge",credentialId:"-_8A",clientDataJSON:"-_8A",authenticatorData:"-_8A",signature:"-_8A",userHandle:"-_8A"});expect(mocks.authenticated).toHaveBeenCalledWith(42);
});
it("cancellation sends no assertion and leaves password sign-in available",async()=>{
 mocks.send.mockResolvedValueOnce(success({publicKey:{challenge:"-_8A"}}));
 vi.mocked(navigator.credentials.get).mockRejectedValue(new DOMException("Cancelled","NotAllowedError"));
 await expect(loginPasskey()).rejects.toMatchObject({name:"NotAllowedError"});expect(mocks.send).toHaveBeenCalledTimes(1);expect(mocks.authenticated).not.toHaveBeenCalled();expect(passkeyError(new DOMException("","NotAllowedError"))).toContain("已取消");
});
it("does not submit a non-discoverable credential without a user handle",async()=>{
 mocks.send.mockResolvedValueOnce(success({publicKey:{challenge:"-_8A"}}));vi.mocked(navigator.credentials.get).mockResolvedValue({type:"public-key",response:{userHandle:null}} as unknown as Credential);
 await expect(loginPasskey()).rejects.toThrow("请选择");expect(mocks.send).toHaveBeenCalledTimes(1);
});
it("requires secure context and browser credential support",()=>{expect(passkeySupported()).toBe(true);vi.stubGlobal("isSecureContext",false);expect(passkeySupported()).toBe(false);});
it("does not start a device prompt if the page leaves during challenge retrieval",async()=>{
 const controller=new AbortController();mocks.send.mockImplementationOnce(async()=>{controller.abort();return success({publicKey:{challenge:"-_8A"}});});await expect(loginPasskey(controller.signal)).rejects.toMatchObject({name:"AbortError"});expect(navigator.credentials.get).not.toHaveBeenCalled();expect(mocks.authenticated).not.toHaveBeenCalled();
});
it("does not submit a late device proof after cancellation",async()=>{
 const controller=new AbortController();mocks.send.mockResolvedValueOnce(success({publicKey:{challenge:"-_8A"}}));vi.mocked(navigator.credentials.get).mockImplementationOnce(async()=>{controller.abort();return {type:"public-key"} as Credential;});await expect(loginPasskey(controller.signal)).rejects.toMatchObject({name:"AbortError"});expect(mocks.send).toHaveBeenCalledTimes(1);
});
it("times out an unresponsive API instead of leaving the form permanently busy",async()=>{
 vi.useFakeTimers();try{mocks.send.mockImplementationOnce((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new DOMException("","AbortError")))));const request=expect(passkeyRequest("auth/passkeys/options",{})).rejects.toThrow("请求超时");await vi.advanceTimersByTimeAsync(15000);await request;}finally{vi.useRealTimers();}
});
it("expires stale management sessions but a rejected sign-in does not sign out an existing account",async()=>{
 mocks.send.mockResolvedValueOnce(new Response(JSON.stringify({detail:"Expired"}),{status:401}));await expect(passkeyRequest("me/security/passkeys")).rejects.toThrow("Expired");expect(mocks.forgotten).toHaveBeenCalledTimes(1);
 mocks.send.mockResolvedValueOnce(new Response(JSON.stringify({detail:"Unknown credential"}),{status:401}));await expect(passkeyRequest("auth/passkeys/sessions",{})).rejects.toThrow("Unknown credential");expect(mocks.forgotten).toHaveBeenCalledTimes(1);
});
