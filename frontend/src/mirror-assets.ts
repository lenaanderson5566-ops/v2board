import type { Row } from "./api";
export const deviceProfiles: Record<string, {id:string; label:string; arch:string}[]> = {
 android:[{id:"phone",label:"安卓手机",arch:"ARM64"},{id:"legacy",label:"旧款安卓手机",arch:"ARM32"}],
 macos:[{id:"apple",label:"Mac · Apple M 系列",arch:"ARM64"},{id:"intel",label:"Mac · Intel",arch:"x64"}],
 windows:[{id:"pc",label:"Windows · Intel / AMD 电脑",arch:"x64"},{id:"arm",label:"Windows · ARM",arch:"ARM64"}],
 linux:[{id:"x64",label:"Linux · x64（手动确认发行版）",arch:"x64"},{id:"arm",label:"Linux · ARM64（手动确认发行版）",arch:"ARM64"}],
};
export function mirrorAssets(assets: Row[], target: string, profile?: string) {
 const platform=target.split("_").pop() || "";
 const desired=deviceProfiles[platform]?.find(p=>p.id===profile)?.arch;
 return assets.flatMap(asset=>{
  const name=String(asset.name || "").toLowerCase();
  if (!target || !asset.size || asset.size>536870912 || /(?:debug|symbols|sources?|checksum)/.test(name)) return [];
  const ext = platform==="android" ? /\.apk$/ : platform==="windows" ? /\.(exe|msi|zip)$/ : platform==="macos" ? /\.(dmg|pkg|zip)$/ : /\.(deb|rpm|appimage|tar\.gz|zip)$/;
  if (!ext.test(name)) return [];
  // Archives are ambiguous unless their filename identifies the platform.
  if (/\.(zip|tar\.gz)$/.test(name) && !(platform==="windows" ? /windows|win32|win64/ : platform==="macos" ? /macos|darwin|osx/ : /linux/).test(name)) return [];
  const specific=/arm64|aarch64|armv7|armeabi|x86|amd64|x64|i686|i386/.test(name);
  const universal=!specific && /(?:^|[._-])(universal)(?:[._-]|$)/.test(name);
  const architecture=universal ? "通用" : /arm64|aarch64/.test(name) ? "ARM64" : /armv7|armeabi/.test(name) ? "ARM32" : /x86_64|amd64|x64/.test(name) ? "x64" : /x86|i686|i386/.test(name) ? "x86" : "架构待确认";
  const compatible=universal || architecture===desired;
  const recommended=compatible && platform!=="linux" && !(target.startsWith("singbox_") && platform!=="android");
  const rank=(recommended ? 100 : 0)+(universal ? 20 : 0)+(/\.(exe|msi|dmg|pkg|apk)$/.test(name) ? 10 : 0);
  return [{recommended, rank, ...asset, id: asset.id, name: String(asset.name), size: Number(asset.size), universal, architecture}];
 }).sort((a,b)=>b.rank-a.rank || String(a.name).localeCompare(String(b.name)));
}

// Update only device architectures already maintained by the administrator.
export function mirrorUpdates(clients: Row[], items: Row[]) {
 const result: {client:string;target:string;asset_id:number;name:string}[]=[];
 const seen=new Set<string>();
 for(const old of items){
  const client=clients.find(c=>c.id===old.client);
  if(!client?.version || client.error || client.stale)continue;
  const previous=mirrorAssets([old],old.target)[0];
  if(!previous || previous.architecture==="架构待确认")continue;
  const profiles=deviceProfiles[String(old.target).split("_").pop() || ""] || [];
  const profile=profiles.find(p=>p.arch===previous.architecture);
  const candidates=mirrorAssets(client.assets || [],old.target,profile?.id);
  const eligible=candidates.filter(a=>a.recommended && (a.universal || a.architecture===previous.architecture));
  // Universal packages can only be automatically replaced with another universal package.
  const matches=previous.universal ? candidates.filter(a=>a.universal && !String(old.target).endsWith("_linux") && !(String(old.target).startsWith("singbox_") && !String(old.target).endsWith("_android"))) : eligible;
  if(!matches.length || (matches[1] && matches[0].rank===matches[1].rank))continue;
  const a=matches[0], key=`${old.client}:${old.target}:${a.id}`;
  if(seen.has(key) || items.some(i=>i.client===old.client && i.target===old.target && Number(i.asset_id)===Number(a.id) && ["queued","downloading","ready"].includes(i.status)))continue;
  seen.add(key);result.push({client:old.client,target:old.target,asset_id:Number(a.id),name:a.name});
 }
 return result;
}
