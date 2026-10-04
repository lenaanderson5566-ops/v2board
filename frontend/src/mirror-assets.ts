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

export type MirrorUpdateResult = {client:string;target:string;name:string;architecture:string;profile?:string;asset_id?:number;candidates:string[];status:string;reason:string};
export function inspectMirrorUpdates(clients: Row[], items: Row[]): MirrorUpdateResult[] {
 const result: MirrorUpdateResult[]=[];
 const seen=new Set<string>(), downloads=new Set<string>();
 for(const old of items){
  const client=clients.find(c=>c.id===old.client);
  const previous=mirrorAssets([old],old.target)[0];
  const architecture=previous?.architecture || "架构待确认";
  const key=`${old.client}:${old.target}:${architecture}`;
  if(seen.has(key))continue;seen.add(key);
  const platform=String(old.target).split("_").pop() || "";
  const profile=deviceProfiles[platform]?.find(p=>p.arch===architecture)?.id;
  const candidates=mirrorAssets(client?.assets || [],old.target,profile);
  const row:MirrorUpdateResult={client:old.client,target:old.target,name:old.name,architecture,profile,candidates:candidates.map(a=>a.name),status:"manual",reason:""};
  result.push(row);
  if(!client?.version || client.error || client.stale){row.status="failed";row.reason=client?.error || "尚未获取有效版本，请重新检查更新";continue;}
  if(!previous || architecture==="架构待确认"){row.reason="原安装包架构不明确，无法安全匹配更新";continue;}
  if(platform==="linux"){row.reason="Linux 需人工确认发行版及安装格式";continue;}
  if(String(old.target).startsWith("singbox_") && platform!=="android"){row.reason="sing-box 桌面发布包为内核程序，需人工确认";continue;}
  const matches=candidates.filter(a=>previous.universal ? a.universal : a.recommended && (a.universal || a.architecture===architecture));
  if(!matches.length){row.reason=previous.universal ? "未找到通用包，不能自动改为单一架构" : "未找到明确匹配的包；可能因架构、格式、平台命名或 512 MiB 限制被过滤";continue;}
  row.candidates=matches.map(a=>a.name);
  if(matches[1] && matches[0].rank===matches[1].rank){row.reason="多个安装包优先级相同，请手动选择";continue;}
  const a=matches[0];row.name=a.name;row.asset_id=Number(a.id);
  const existing=items.find(i=>i.client===old.client && i.target===old.target && Number(i.asset_id)===Number(a.id) && ["queued","downloading","ready"].includes(i.status));
  const downloadKey=`${old.client}:${old.target}:${a.id}`;
  if(existing){row.status="skipped";row.reason=existing.status==="ready" ? "此安装包已下载，无需重复下载" : "此安装包已排队或正在下载";}
  else if(downloads.has(downloadKey)){row.status="skipped";row.reason="已由另一设备匹配同一通用包，合并下载";}
  else{downloads.add(downloadKey);row.status="pending";row.reason="已明确匹配，等待加入下载队列";}
 }
 return result;
}
export function mirrorUpdates(clients: Row[], items: Row[]) {
 return inspectMirrorUpdates(clients,items).filter(r=>r.status==="pending").map(r=>({client:r.client,target:r.target,asset_id:r.asset_id!,name:r.name}));
}
