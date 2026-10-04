import type { Row } from "./api";
export function mirrorAssets(assets: Row[], target: string) {
 const platform=target.split("_").pop();
 return assets.flatMap(asset=>{
  const name=String(asset.name || "").toLowerCase();
  if (!target || !asset.size || asset.size>536870912 || /(?:debug|symbols|sources?|checksum)/.test(name)) return [];
  const ext = platform==="android" ? /\.apk$/ : platform==="windows" ? /\.(exe|msi|zip)$/ : platform==="macos" ? /\.(dmg|pkg|zip)$/ : /\.(deb|rpm|appimage|tar\.gz|zip)$/;
  if (!ext.test(name)) return [];
  // Archives are ambiguous unless their filename identifies the platform.
  if (/\.(zip|tar\.gz)$/.test(name) && !(platform==="windows" ? /windows|win32|win64/ : platform==="macos" ? /macos|darwin|osx/ : /linux/).test(name)) return [];
  const specific=/arm64|aarch64|armv7|armeabi|x86|amd64|x64|i686|i386/.test(name);
  const universal=!specific && /(?:^|[._-])(universal|all|noarch)(?:[._-]|$)/.test(name);
  const architecture=universal ? "通用" : /arm64|aarch64/.test(name) ? "ARM64" : /armv7|armeabi/.test(name) ? "ARM32" : /x86_64|amd64|x64/.test(name) ? "x64" : /x86|i686|i386/.test(name) ? "x86" : "架构待确认";
  return [{...asset, id: asset.id, name: String(asset.name), size: Number(asset.size), universal, architecture}];
 }).sort((a,b)=>Number(b.universal)-Number(a.universal) || String(a.name).localeCompare(String(b.name)));
}
