import catalog from "../../../resources/client/node-locations.json";

import type { NodeCatalog } from "./node-dictionary";
export const buildLocationOptions = (source: Pick<NodeCatalog,"cities"|"cityRegions"|"locationKinds">) => Object.entries(source.cities).map(
    ([code, names]) => {
        const aliases = [code, ...Object.values(names)];
        return {
            code,
            country:
                source.cityRegions[code],
            label: names["zh-CN"],
            kind: source.locationKinds[code],
            aliases,
            search: aliases.join(" ").toLowerCase(),
        };
    },
);
export const locationOptions=buildLocationOptions(catalog);
export function optionsForCountry(country: unknown, options=locationOptions) {
    const region = String(country ?? "").toUpperCase();
    return options.filter(
        (option) => !region || option.country === region,
    );
}
export function resolveLocation(
    text: string,
    country: unknown,
    options=locationOptions,
): string | undefined {
    const query = text.trim().toLowerCase();
    const candidates = optionsForCountry(country,options).filter((option) =>
        option.aliases.some((alias) => alias.toLowerCase() === query),
    );
    return candidates.length === 1 ? candidates[0].code : undefined;
}
