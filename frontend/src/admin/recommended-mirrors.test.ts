import { expect, it } from "vitest";
import { inspectRecommendedMirrors, recommendedMirrorTargets } from "./mirror-assets";
const target={client:"flclash",target:"flclash_windows",supported:true};
const client={id:"flclash",version:"1",assets:[{id:1,name:"app-windows-x64.exe",size:12},{id:2,name:"app-windows-arm64.exe",size:12}]};
it("maps configured clients to mirror IDs and includes unsupported official channels",()=>{
 const targets=recommendedMirrorTargets({macos:["surge","flclash"]},{"clash-verge":["clash_windows"],flclash:["flclash_macos"]});
 expect(targets).toContainEqual({client:"clash-verge",target:"clash_windows",supported:true});
 expect(targets).toContainEqual({client:"surge",target:"surge_macos",supported:false});
 expect(targets.filter(t=>t.target==="flclash_macos")).toHaveLength(1);
});
it("downloads separate architectures and skips ready or queued assets",()=>{
 expect(inspectRecommendedMirrors([client],[],[target]).map(r=>r.asset_id)).toEqual([1,2]);
 const items=[{...target,asset_id:1,status:"ready"},{...target,asset_id:2,status:"queued"}];
 expect(inspectRecommendedMirrors([client],items,[target]).every(r=>r.status==="skipped")).toBe(true);
});
it("retries failed downloads but requires manual selection for ambiguous packages",()=>{
 expect(inspectRecommendedMirrors([client],[{...target,asset_id:1,status:"failed"}],[target])[0].status).toBe("pending");
 const ambiguous={...client,assets:[...client.assets,{id:3,name:"other-windows-x64.exe",size:12}]};
 expect(inspectRecommendedMirrors([ambiguous],[],[target])[0].status).toBe("manual");
});
it("keeps Linux installers and desktop sing-box manual",()=>{
 const targets=[{client:"flclash",target:"flclash_linux",supported:true},{client:"sing-box",target:"singbox_windows",supported:true}];
 expect(inspectRecommendedMirrors([client,{id:"sing-box",version:"1"}],[],targets).every(r=>r.status==="manual")).toBe(true);
});
