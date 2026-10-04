import { expect,it } from "vitest";
import { mirrorAssets } from "./mirror-assets";
const assets=(...names:string[])=>names.map((name,id)=>({id:id+1,name,size:12}));
it("ranks universal APKs before architecture builds and excludes other platforms",()=>{
 const r=mirrorAssets(assets("cmfa-arm64.apk","cmfa-universal.apk","cmfa-x86.apk","app.exe","debug-universal.apk"),"cmfa_android");
 expect(r.map(a=>a.id)).toEqual([2,1,3]);expect(r[0].universal).toBe(true);
});
it("does not infer universal support from missing architecture or conflicting names",()=>{
 const r=mirrorAssets(assets("app.apk","app-universal-arm64.apk"),"cmfa_android");
 expect(r.every(a=>!a.universal)).toBe(true);
});
it("filters platform archives and recognizes macOS universal installers",()=>{
 expect(mirrorAssets(assets("app-windows-x64.zip","app-linux-amd64.tar.gz","source.zip"),"clash_windows").map(a=>a.id)).toEqual([1]);
 expect(mirrorAssets(assets("app-universal.dmg"),"clash_macos")[0].architecture).toBe("通用");
});

it("recommends Apple Silicon and ordinary Windows installers",()=>{
 const a=assets("FlClash-macos-amd64.dmg","FlClash-macos-arm64.dmg");
 expect(mirrorAssets(a,"flclash_macos","apple")[0].id).toBe(2);
 expect(mirrorAssets(a,"flclash_macos","intel")[0].id).toBe(1);
 expect(mirrorAssets(assets("app-windows-x64.zip","app-x64.exe"),"clash_windows","pc")[0].id).toBe(2);
});
it("avoids guessing unknown, incompatible, and core-only packages",()=>{
 expect(mirrorAssets(assets("app-all.apk","app.apk"),"cmfa_android","phone").every(a=>!a.recommended)).toBe(true);
 expect(mirrorAssets(assets("app-x64.exe"),"clash_windows","arm")[0].recommended).toBe(false);
 expect(mirrorAssets(assets("sing-box-windows-amd64.zip"),"singbox_windows","pc")[0].recommended).toBe(false);
});
it("prefers universal over matching architecture for Android",()=>{
 expect(mirrorAssets(assets("app-arm64-v8a.apk","app-universal.apk"),"cmfa_android","phone")[0].id).toBe(2);
});

it("updates maintained architectures, skips existing files and ambiguous matches",async()=>{
 const {mirrorUpdates}=await import("./mirror-assets");
 const items=[{client:"flclash",target:"flclash_macos",name:"old-arm64.dmg",size:12,asset_id:99,status:"ready"}];
 const clients=[{id:"flclash",version:"2",assets:assets("new-arm64.dmg","new-amd64.dmg")}];
 expect(mirrorUpdates(clients,items).map(a=>a.asset_id)).toEqual([1]);
 expect(mirrorUpdates(clients,[...items,{...items[0],asset_id:1,status:"queued"}])).toEqual([]);
 expect(mirrorUpdates([{...clients[0],error:"timeout"}],items)).toEqual([]);
 expect(mirrorUpdates([{...clients[0],assets:assets("one-arm64.dmg","two-arm64.dmg")}],items)).toEqual([]);
});

it("explains each skipped architecture without duplicate history rows",async()=>{
 const {inspectMirrorUpdates}=await import("./mirror-assets");
 const old={client:"flclash",target:"flclash_macos",name:"old-arm64.dmg",size:12,asset_id:99,status:"ready"};
 const client={id:"flclash",version:"2",assets:assets("one-arm64.dmg","two-arm64.dmg")};
 const report=inspectMirrorUpdates([client],[old,{...old,asset_id:98}]);
 expect(report).toHaveLength(1);expect(report[0].reason).toContain("优先级相同");expect(report[0].candidates).toHaveLength(2);
 expect(inspectMirrorUpdates([client],[{...old,name:"unknown.dmg"}])[0].reason).toContain("架构不明确");
 expect(inspectMirrorUpdates([{...client,error:"API timeout"}],[old])[0]).toMatchObject({status:"failed",reason:"API timeout"});
 expect(inspectMirrorUpdates([client],[{...old,name:"old-universal.dmg"}])[0].reason).toContain("未找到通用包");
});
