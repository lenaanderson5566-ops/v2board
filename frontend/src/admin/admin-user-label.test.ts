import { expect, it } from "vitest";
import { adminUserLabel } from "./admin-user-label";
it("shows ID and email together, including unavailable accounts", () => {
    expect(adminUserLabel({ user_id: 7, email: "user@example.com" })).toBe(
        "ID: 7 · user@example.com",
    );
    expect(adminUserLabel({ user_id: 7 })).toBe("ID: 7 · 邮箱不可用");
    expect(adminUserLabel({ user_id: 7, email: "null" })).toBe(
        "ID: 7 · 邮箱不可用",
    );
});
