vi.mock("./AdminMailCampaigns",()=>({AdminMailCampaigns:()=>null}));
vi.mock("./MailHealth",()=>({MailHealth:()=>null}));
import { mailCredentialField } from "./mail-settings";
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const api = vi.hoisted(() => {
    window.V2BOARD = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async original => ({
    ...(await original<typeof import("../shared/api")>()), request: api.request, readRequest: api.request,
}));
import { AdminMailLogs } from "./AdminMailLogs";
import { configField } from "./admin-fields";
import { settingsFields } from "./admin-linkage";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("queries exact email, provider and status without issuing a send", async () => {
    api.request.mockResolvedValue({ data: [], total: 0 });
    render(<AdminMailLogs />);
    await screen.findByText("暂无匹配邮件日志");
    fireEvent.change(screen.getByLabelText("收件邮箱（精确查询）"), {target:{value:"person@example.test"}});
    fireEvent.change(screen.getByLabelText("发送通道"), {target:{value:"mailgun"}});
    fireEvent.change(screen.getByLabelText("状态"), {target:{value:"uncertain"}});
    fireEvent.click(screen.getByRole("button", {name:"查询"}));
    await waitFor(() => expect(api.request.mock.calls.some(([path]) => path.includes("email=person%40example.test") && path.includes("provider=mailgun") && path.includes("status=uncertain") && path.includes("current=1"))).toBe(true));
    expect(api.request.mock.calls.every(([path, body]) => path.includes("mail-logs/fetch") && body === undefined)).toBe(true);
    fireEvent.click(screen.getByRole("button", {name:"重置"}));
    await waitFor(() => expect(api.request.mock.calls.at(-1)?.[0]).toBe("test-admin/mail-logs/fetch?current=1&page_size=20"));
});
it("labels provider acceptance accurately and escapes provider message IDs", async () => {
    api.request.mockResolvedValue({ data:[{id:1,email:"p***@example.test",template:"test",provider:"mailgun",status:"accepted",message_id:"<img src=x onerror=alert(1)>",created_at:1700000000,duration_ms:20}],total:1 });
    const {container}=render(<AdminMailLogs />);
    await screen.findByRole("cell",{name:/服务商已接受/});
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/不代表已送达收件箱/)).toBeTruthy();
});
it("disables refresh while loading and displays fetch errors", async () => {
    let reject!: (e: Error) => void;
    api.request.mockImplementation(() => new Promise((_, r) => {reject=r;}));
    render(<AdminMailLogs />);
    expect((screen.getByRole("button",{name:"刷新"}) as HTMLButtonElement).disabled).toBe(true);
    reject(new Error("MAIL_LOG_UNAVAILABLE"));
    await screen.findByText("MAIL_LOG_UNAVAILABLE");
    expect((screen.getByRole("button",{name:"刷新"}) as HTMLButtonElement).disabled).toBe(false);
});
it("rejects reversed date filters before requesting", async () => {
    api.request.mockResolvedValue({data:[],total:0}); render(<AdminMailLogs />);
    await screen.findByText("暂无匹配邮件日志");
    const before=api.request.mock.calls.length;
    fireEvent.change(screen.getByLabelText(/开始时间/),{target:{value:"2026-10-14T12:00"}});
    fireEvent.change(screen.getByLabelText(/结束时间/),{target:{value:"2026-10-13T12:00"}});
    fireEvent.click(screen.getByRole("button",{name:"查询"}));
    expect(screen.getByRole("alert").textContent).toContain("结束时间不能早于开始时间");
    expect(api.request.mock.calls).toHaveLength(before);
});
it("masks API keys and shows only the selected transport fields", () => {
    expect(configField("email_mailgun_api_key","","string","Key").type).toBe("password");
    const fields=["email_provider","email_host","email_password","email_mailgun_domain","email_mailgun_api_key"].map(key=>({key,label:key}));
    expect(settingsFields(fields,{email_provider:"mailgun"}).map(f=>f.key)).toEqual(["email_provider","email_mailgun_domain","email_mailgun_api_key"]);
    expect(settingsFields(fields,{email_provider:"smtp"}).map(f=>f.key)).toEqual(["email_provider","email_host","email_password"]);
});

it("keeps SES and Resend secrets private and shows only their settings", () => {
    for (const key of ["email_ses_access_key", "email_ses_secret_key", "email_resend_api_key"]) expect(configField(key,"","string",key).type).toBe("password");
    const fields=["email_host","email_ses_auth","email_ses_access_key","email_resend_api_key"].map(key=>({key,label:key}));
    expect(settingsFields(fields,{email_provider:"ses",email_ses_auth:"role"}).map(f=>f.key)).toEqual(["email_ses_auth"]);
    expect(settingsFields(fields,{email_provider:"ses",email_ses_auth:"key"}).map(f=>f.key)).toEqual(["email_ses_auth","email_ses_access_key"]);
    expect(settingsFields(fields,{email_provider:"resend"}).map(f=>f.key)).toEqual(["email_resend_api_key"]);
});

it("uses a placeholder for saved credentials without submitting stars", () => {
    const field=mailCredentialField({key:"email_password",label:"密码",type:"password"},{email_smtp_key_configured:true});
    expect(field.placeholder).toContain("********");
    expect(field.hint).toContain("留空保留");
    expect(field).not.toHaveProperty("value");
    expect(mailCredentialField({key:"email_resend_api_key",label:"Key"},{}).placeholder).toContain("未设置");
});

it("shows only the selected announcement provider and masks its saved secrets", () => {
    const field=configField("email_announcement_resend_api_key","","string","Key");
    expect(field.type).toBe("password");
    expect(mailCredentialField(field,{email_announcement_resend_key_configured:true}).placeholder).toContain("********");
    const fields=["email_announcement_separate","email_announcement_provider","email_announcement_host","email_announcement_resend_api_key"].map(key=>({key,label:key}));
    expect(settingsFields(fields,{email_announcement_separate:0}).map(f=>f.key)).toEqual(["email_announcement_separate"]);
    expect(settingsFields(fields,{email_announcement_separate:1,email_announcement_provider:"resend"}).map(f=>f.key)).toEqual(["email_announcement_separate","email_announcement_provider","email_announcement_resend_api_key"]);
});
