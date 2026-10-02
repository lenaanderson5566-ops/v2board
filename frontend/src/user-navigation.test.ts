import { expect, it } from "vitest";
import { userNavigation } from "./user-navigation";
it("prioritizes setup and usage during a valid subscription", () => {
    expect(userNavigation("active").map((item) => item.label)).toEqual([
        "使用情况",
        "配置中心",
        "账单",
        "帮助中心",
    ]);
    expect(userNavigation("active").some((item) => item.key === "plan")).toBe(
        false,
    );
});
it("prioritizes purchase or renewal without exposing setup to inactive users", () => {
    expect(userNavigation("new")[1].label).toBe("购买订阅");
    expect(userNavigation("expired")[1].label).toBe("续订套餐");
    expect(
        userNavigation("expired").some((item) => item.key === "subscribe"),
    ).toBe(false);
    expect(userNavigation("banned")).toEqual([]);
});
