import catalog from "../../../resources/client/node-locations.json";

export const locationOptions = Object.entries(catalog.cities).map(
    ([code, names]) => {
        const references = Object.entries(catalog.cloudProviders).flatMap(
            ([provider, info]) =>
                Object.entries(info.regions)
                    .filter(([, location]) => location === code)
                    .map(([region]) => ({
                        label: `${info.name} ${region}`,
                        aliases: [
                            `${provider}:${region}`,
                            `${provider} ${region}`,
                            `${info.name} ${region}`,
                            region,
                        ],
                    })),
        );
        const aliases = [
            code,
            ...Object.values(names),
            ...references.flatMap((reference) => reference.aliases),
        ];
        return {
            code,
            country:
                catalog.cityRegions[code as keyof typeof catalog.cityRegions],
            label: names["zh-CN"],
            references: references.map((reference) => reference.label),
            aliases,
            search: aliases.join(" ").toLowerCase(),
        };
    },
);
export function optionsForCountry(country: unknown) {
    const region = String(country ?? "").toUpperCase();
    return locationOptions.filter(
        (option) => !region || option.country === region,
    );
}
export function resolveLocation(
    text: string,
    country: unknown,
): string | undefined {
    const query = text.trim().toLowerCase();
    const candidates = optionsForCountry(country).filter((option) =>
        option.aliases.some((alias) => alias.toLowerCase() === query),
    );
    return candidates.length === 1 ? candidates[0].code : undefined;
}
