import { expect, it } from "vitest";
import catalog from "../../../resources/client/node-locations.json";
import { locationOptions, resolveLocation } from "./node-location-options";
it("resolves each qualified cloud region to its canonical location", () => {
    for (const [provider, info] of Object.entries(catalog.cloudProviders)) {
        for (const [region, location] of Object.entries(info.regions)) {
            expect(
                resolveLocation(
                    `${provider}:${region}`,
                    catalog.cityRegions[
                        location as keyof typeof catalog.cityRegions
                    ],
                ),
            ).toBe(location);
        }
    }
    expect(
        locationOptions.every((option) => !!option.country && !!option.label),
    ).toBe(true);
});
it("does not guess the provider of a colliding region code", () => {
    expect(resolveLocation("ap-southeast-3", "")).toBeUndefined();
    expect(resolveLocation("Alibaba Cloud ap-southeast-3", "MY")).toBe(
        "kuala-lumpur",
    );
    expect(resolveLocation("aws:us-west-1", "US")).toBe("california");
    expect(resolveLocation("aws:us-west-1", "JP")).toBeUndefined();
});

it("merges cloud areas into the enclosing state instead of using directional labels", () => {
    expect(resolveLocation("us-west-1", "US")).toBe("california");
    expect(resolveLocation("aws:us-east-1", "US")).toBe("virginia");
    expect(
        locationOptions.some((option) =>
            /北加利福尼亚|北弗吉尼亚/.test(option.label),
        ),
    ).toBe(false);
});
