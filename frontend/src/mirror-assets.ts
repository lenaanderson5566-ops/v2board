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
