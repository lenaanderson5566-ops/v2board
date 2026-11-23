vi.mock("./AdminMailCampaigns",()=>({AdminMailCampaigns:()=>null}));
vi.mock("./MailHealth",()=>({MailHealth:()=>null}));
import { mailCredentialField } from "./mail-settings";
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const api = vi.hoisted(() => {
    window.FASTAI = { mode: "admin", adminPath: "test-admin" } as any;
    return { request: vi.fn() };
});
vi.mock("../shared/api", async original => ({
    ...(await original<typeof import("../shared/api")>()), request: api.request, readRequest: api.request,
}));
import { configureTimeZone, setAdminDisplayTimeZone } from "../shared/timezone";
import { AdminMailLogs } from "./AdminMailLogs";
import { configField } from "./admin-fields";
import { settingsFields } from "./admin-linkage";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("queries exact email, provider and status without issuing a send", async () => {
    api.request.mockResolvedValue({ data: [], total: 0 });
    render(<AdminMailLogs />);
    expect((await screen.findByText("暂无匹配邮件日志")).getAttribute("role")).toBe("status");
    expect(screen.queryByRole("region", { name: "数据表格" })).toBeNull();
    fireEvent.change(screen.getByLabelText("收件邮箱（精确查询）"), {target:{value:"person@example.test"}});
    fireEvent.change(screen.getByLabelText("发送通道"), {target:{value:"mailgun"}});
    fireEvent.change(screen.getByLabelText("状态"), {target:{value:"uncertain"}});
    const advanced = screen.getByRole("button", { name: "高级筛选" });
    expect(screen.queryByRole("group", { name: "高级筛选条件" })).toBeNull();
    fireEvent.click(advanced);
    expect(screen.getByRole("group", { name: "高级筛选条件" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("投递反馈"), { target: { value: "temporary" } });
    fireEvent.click(advanced);
    expect(advanced.textContent).toContain("有未提交的条件");
    expect(api.request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", {name:"查询"}));
    await waitFor(() => expect(api.request.mock.calls.some(([path]) => path.includes("email=person%40example.test") && path.includes("provider=mailgun") && path.includes("status=uncertain") && path.includes("delivery_status=temporary") && path.includes("current=1"))).toBe(true));
    expect(advanced.textContent).toContain("已应用 1 项");
    expect(advanced.textContent).not.toContain("未提交");
    expect(api.request.mock.calls.every(([path, body]) => path.includes("mail-logs/fetch") && body === undefined)).toBe(true);
    fireEvent.click(screen.getByRole("button", {name:"重置"}));
    await waitFor(() => expect(api.request.mock.calls.at(-1)?.[0]).toBe("test-admin/mail-logs/fetch?current=1&page_size=20"));
    expect(advanced.textContent).toBe("高级筛选");
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
    expect(screen.queryByText("暂无匹配邮件日志")).toBeNull();
    expect((screen.getByRole("button",{name:"刷新"}) as HTMLButtonElement).disabled).toBe(false);
});
it("rejects reversed date filters before requesting", async () => {
    api.request.mockResolvedValue({data:[],total:0}); render(<AdminMailLogs />);
    await screen.findByText("暂无匹配邮件日志");
    const before=api.request.mock.calls.length;
    const advanced = screen.getByRole("button", { name: "高级筛选" });
    fireEvent.click(advanced);
    fireEvent.change(screen.getByLabelText(/开始时间/),{target:{value:"2026-10-14T12:00"}});
    fireEvent.change(screen.getByLabelText(/结束时间/),{target:{value:"2026-10-13T12:00"}});
    fireEvent.click(advanced);
    fireEvent.click(screen.getByRole("button",{name:"查询"}));
    expect(screen.getByRole("alert").textContent).toContain("结束时间不能早于开始时间");
    expect(advanced.getAttribute("aria-expanded")).toBe("true");
    expect(api.request.mock.calls).toHaveLength(before);
});
it("keeps applied and unsubmitted mail log bounds at the same instants when the display timezone changes", async () => {
    configureTimeZone("Asia/Shanghai", true);
    setAdminDisplayTimeZone("UTC");
    try {
        const from = Date.parse("2026-11-01T06:30:37Z") / 1000;
        api.request.mockResolvedValue({ data: [{ id: 1, status: "accepted", created_at: from }], total: 1 });
        render(<AdminMailLogs />);
        await screen.findByText(/06:30:37/, { selector: "time" });
        const advanced = screen.getByRole("button", { name: "高级筛选" });
        const search = screen.getByRole("button", { name: "查询" });
        fireEvent.click(advanced);
        const start = screen.getByLabelText<HTMLInputElement>("开始时间"), end = screen.getByLabelText<HTMLInputElement>("结束时间");
        fireEvent.change(start, { target: { value: "2026-11-01T06:30:37" } });
        fireEvent.click(search);
        const params = () => new URLSearchParams(api.request.mock.calls.at(-1)?.[0].split("?")[1]);
        await waitFor(() => expect(params().get("from")).toBe(String(from)));
        const reads = api.request.mock.calls.length;
        fireEvent.click(advanced);
        act(() => setAdminDisplayTimeZone("America/New_York"));
        expect(screen.getByText("日志时间与筛选时区：America/New_York")).toBeTruthy();
        const timestamp = await screen.findByText(/01:30:37/, { selector: "time" });
        expect(timestamp.getAttribute("datetime")).toBe("2026-11-01T06:30:37.000Z");
        expect(timestamp.title).toContain("UTC-5");
        expect(start.value).toContain("2026-11-01T01:30:37");
        expect(advanced.textContent).toBe("高级筛选（已应用 1 项）");
        fireEvent.click(search);
        expect(screen.queryByRole("alert")).toBeNull();
        expect(api.request.mock.calls).toHaveLength(reads);

        fireEvent.click(advanced);
        fireEvent.change(end, { target: { value: "2026-11-01T03:45:11" } });
        fireEvent.click(advanced);
        act(() => setAdminDisplayTimeZone("UTC"));
        expect(end.value).toContain("2026-11-01T08:45:11");
        expect(advanced.textContent).toContain("有未提交的条件");
        expect(api.request.mock.calls).toHaveLength(reads);
        expect(params().get("to")).toBeNull();
        fireEvent.click(search);
        await waitFor(() => {
            expect(params().get("from")).toBe(String(from));
            expect(params().get("to")).toBe(String(Date.parse("2026-11-01T08:45:11Z") / 1000));
        });
        expect(advanced.textContent).toBe("高级筛选（已应用 2 项）");
        fireEvent.click(screen.getByRole("button", { name: "重置" }));
        await waitFor(() => expect(params().has("from")).toBe(false));
        expect(params().has("to")).toBe(false);
        expect(start.value).toBe("");
        expect(end.value).toBe("");
    } finally { act(() => setAdminDisplayTimeZone("business")); }
});
it("keeps an ambiguous mail log date unsubmitted and opens its advanced filters on query", async () => {
    configureTimeZone("Asia/Shanghai", true);
    setAdminDisplayTimeZone("America/New_York");
    try {
        api.request.mockResolvedValue({ data: [], total: 0 });
        render(<AdminMailLogs />);
        await screen.findByText("暂无匹配邮件日志");
        const reads = api.request.mock.calls.length;
        const advanced = screen.getByRole("button", { name: "高级筛选" });
        fireEvent.click(advanced);
        fireEvent.change(screen.getByLabelText("开始时间"), { target: { value: "2026-11-01T01:30:37" } });
        fireEvent.click(advanced);
        expect(advanced.textContent).toContain("有未提交的条件");
        fireEvent.click(screen.getByRole("button", { name: "查询" }));
        expect(screen.getByRole("alert").textContent).toContain("重复");
        expect(advanced.getAttribute("aria-expanded")).toBe("true");
        expect(api.request.mock.calls).toHaveLength(reads);
    } finally { act(() => setAdminDisplayTimeZone("business")); }
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
