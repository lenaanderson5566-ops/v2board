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
