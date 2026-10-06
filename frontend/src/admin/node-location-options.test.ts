import { expect, it } from "vitest";
import catalog from "../../../resources/client/node-locations.json";
import { locationOptions, resolveLocation } from "./node-location-options";
it("resolves localized geographical names within their country", () => {
    for (const [code, names] of Object.entries(catalog.cities)) {
        const country = catalog.cityRegions[code as keyof typeof catalog.cityRegions];
        expect(resolveLocation(code, country)).toBe(code);
        for (const name of Object.values(names)) expect(resolveLocation(name, country)).toBe(code);
    }
    expect(locationOptions.every(option => !!option.country && !!option.label)).toBe(true);
});
it("does not resolve cloud provider codes", () => {
    expect(catalog).not.toHaveProperty("cloudProviders");
    for (const code of ["aws:us-west-1", "us-west-1", "ap-southeast-3"]) {
        expect(resolveLocation(code, "")).toBeUndefined();
    }
});
it("offers states and cities instead of directional region labels", () => {
    expect(resolveLocation("California", "US")).toBe("california");
    expect(resolveLocation("Virginia", "US")).toBe("virginia");
    expect(resolveLocation("Tokyo", "US")).toBeUndefined();
    expect(locationOptions.some(option => /北加利福尼亚|北弗吉尼亚/.test(option.label))).toBe(false);
});
