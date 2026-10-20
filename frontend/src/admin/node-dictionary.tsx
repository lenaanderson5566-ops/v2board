import { createContext, useContext, type ReactNode } from "react";
import countries from "../../../resources/client/node-countries.json";
import locations from "../../../resources/client/node-locations.json";
import { admin } from "../shared/api";
import { useData } from "../shared/ui";
export type NodeCatalog = { regions:Record<string,Record<string,string>>;cities:Record<string,Record<string,string>>;cityRegions:Record<string,string>;locationKinds:Record<string,string> };
export type DictionaryData = {catalog:NodeCatalog;defaults:Pick<NodeCatalog,"regions"|"cities">;versions:Record<string,number>;overrides:Record<string,Record<string,string>>;languages:string[]};
const defaults:NodeCatalog={...locations,regions:countries};
const Context=createContext<NodeCatalog>(defaults);
export const useNodeCatalog=()=>useContext(Context);
export function NodeDictionaryProvider({children}:{children:ReactNode}) {
    const data=useData<DictionaryData>(admin("dictionary/fetch"));
    return <Context.Provider value={data.data?.catalog || defaults}>{data.error && <p role="alert">节点字典加载失败，暂显示内置名称。<button onClick={data.reload}>重试</button></p>}{children}</Context.Provider>;
}
