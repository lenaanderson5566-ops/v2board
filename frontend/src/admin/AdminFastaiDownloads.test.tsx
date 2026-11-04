// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => { window.FASTAI = { mode: "admin", adminPath: "test-admin" } as any; });
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminFastaiDownloads } from "./AdminFastaiDownloads";
import type { V10FastaiRelease } from "../shared/v10-types";

afterEach(cleanup);
const release: V10FastaiRelease = { platform: "windows", architecture: "x64", channel: "stable", latestVersion: "1.2.0", latestBuild: 3, minimumVersion: "1.0.0", downloadUrl: "https://example.com/fastai.exe", sha256: "a".repeat(64), publishedAt: "2026-10-06T00:00:00Z" };

it("saves separate platform packages without changing other entries", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AdminFastaiDownloads initial={[release, { ...release, platform: "macos", architecture: "arm64", downloadUrl: "https://example.com/fastai.dmg" }]} save={save} />);
    const version = screen.getAllByLabelText("最新版本")[1];
    const form = version.closest("form");
    expect(form?.hasAttribute("data-unsaved")).toBe(false);
    fireEvent.change(version, { target: { value: "2.0.0" } });
    expect(form?.getAttribute("data-unsaved")).toBe("true");
    fireEvent.click(screen.getByText("确认发布 FastAI 下载设置"));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0][0]).toEqual(release);
    expect(save.mock.calls[0][0][1]).toMatchObject({ platform: "macos", architecture: "arm64", latestVersion: "2.0.0" });
    await waitFor(() => expect(form?.hasAttribute("data-unsaved")).toBe(false));
    expect(screen.queryByRole("option", { name: "iOS" })).toBeNull();
});

it("removes a package and reports server validation errors", async () => {
    const save = vi.fn().mockRejectedValue(new Error("Duplicate release target"));
    render(<AdminFastaiDownloads initial={[release]} save={save} />);
    fireEvent.click(screen.getByText("移除此安装包"));
    fireEvent.click(screen.getByText("确认发布 FastAI 下载设置"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Duplicate release target"));
    expect(save).toHaveBeenCalledWith([]);
});

it("shows the effective version floor and blocks a package below the access policy", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AdminFastaiDownloads initial={[release]} globalMinimum="1.10.0" save={save} />);
    expect(screen.getByText("生效最低版本：1.10.0")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("客户端访问策略");
    expect((screen.getByRole("button", { name: "确认发布 FastAI 下载设置" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("最新版本"), { target: { value: "1.10.0" } });
    fireEvent.click(screen.getByRole("button", { name: "确认发布 FastAI 下载设置" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
});

it("accepts the same stable version with a padded access-policy floor", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AdminFastaiDownloads initial={[release]} globalMinimum="v1.2.0.0+release" save={save} />);
    fireEvent.click(screen.getByRole("button", { name: "确认发布 FastAI 下载设置" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith([release]));
});

it("preserves a conflicting draft until the administrator explicitly reloads", async () => {
    const other = { ...release, platform: "macos" as const, architecture: "arm64" as const };
    const reload = vi.fn().mockResolvedValue({ releases: [release, other], revision: "new", globalMinimum: null });
    const save = vi.fn().mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 })).mockResolvedValue(undefined);
    render(<AdminFastaiDownloads initial={[release]} initialRevision="old" save={save} reload={reload} />);
    fireEvent.change(screen.getByLabelText("最新版本"), { target: { value: "1.5.0" } });
    fireEvent.click(screen.getByRole("button", { name: "确认发布 FastAI 下载设置" }));
    const reloadButton = await screen.findByRole("button", { name: "放弃当前草稿并加载最新发布目录" });
    expect(reload).not.toHaveBeenCalled();
    expect((screen.getByLabelText("最新版本") as HTMLInputElement).value).toBe("1.5.0");
    expect(save).toHaveBeenCalledWith([{ ...release, latestVersion: "1.5.0" }], "old");
    fireEvent.click(reloadButton);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("macOS · arm64"));
    expect((screen.getAllByLabelText("最新版本")[0] as HTMLInputElement).value).toBe(release.latestVersion);
    fireEvent.click(screen.getByRole("button", { name: "确认发布 FastAI 下载设置" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith([release, other], "new"));
});

it("lists only supported architectures and allows an unchanged legacy target", async () => {
    const legacy = { ...release, architecture: "x86" as const };
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AdminFastaiDownloads initial={[legacy]} targets={{ windows: ["x64", "arm64"], android: ["arm64"] }} save={save} />);
    expect(screen.getByText("旧目标已停止支持。可以原样保留或移除。")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "macOS" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认发布 FastAI 下载设置" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith([legacy]));
    fireEvent.change(screen.getByLabelText("最新版本"), { target: { value: "2.0.0" } });
    expect(screen.getByRole("alert").textContent).toContain("旧条目仅可原样保留或移除");
    expect((screen.getByRole("button", { name: "确认发布 FastAI 下载设置" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("平台"), { target: { value: "android" } });
    expect((screen.getByLabelText("架构") as HTMLSelectElement).value).toBe("arm64");
    expect((screen.getByLabelText(/下载地址（上传自动填写/) as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("option", { name: "Intel / AMD · x64" })).toBeNull();
});

it("locks the release draft during publishing and allows editing after completion", async () => {
    let finish!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    render(<AdminFastaiDownloads initial={[release]} save={save} />);
    fireEvent.click(screen.getByRole("button", {name:"确认发布 FastAI 下载设置"}));
    const input = screen.getByLabelText("最新版本") as HTMLInputElement;
    expect(input.matches(":disabled")).toBe(true);
    expect((screen.getByRole("button", {name:"发布中…"}) as HTMLButtonElement).disabled).toBe(true);
    expect(save.mock.calls[0][0][0].latestVersion).toBe("1.2.0");
    finish();
    await waitFor(() => expect(input.matches(":disabled")).toBe(false));
    expect(screen.getByRole("status").textContent).toContain("已发布");
    fireEvent.change(input, {target:{value:"1.4.0"}});
    fireEvent.click(screen.getByRole("button", {name:"确认发布 FastAI 下载设置"}));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0][0].latestVersion).toBe("1.4.0");
});

it("shows installer upload times in the system zone without exposing raw ISO", async () => {
    const api = await import("../shared/api");
    const { configureTimeZone, setDisplayTimeZone } = await import("../shared/timezone");
    const { FastaiInstallerPicker } = await import("./FastaiInstallerPicker");
    configureTimeZone("Asia/Kathmandu", true);
    setDisplayTimeZone("America/New_York");
    const request = vi.spyOn(api, "request").mockResolvedValue({ data: [{
        ...release, id: "installer", name: "synthetic.exe", size: 1024,
        createdAt: "2026-11-30T00:00:00Z",
    }] });
    try {
        render(<FastaiInstallerPicker release={release} select={vi.fn()} close={vi.fn()} />);
        expect(await screen.findByText(/05:45:00/)).toBeTruthy();
        expect(screen.getByRole("dialog").textContent).not.toContain("2026-11-30T00:00:00Z");
        expect(screen.getByRole("dialog").textContent).not.toMatch(/UTC|GMT/);
    } finally { request.mockRestore(); setDisplayTimeZone(null); configureTimeZone("Asia/Shanghai", true); }
});

it("edits release dates in the business zone and publishes UTC ISO seconds", async () => {
    const { configureTimeZone, setDisplayTimeZone } = await import("../shared/timezone");
    configureTimeZone("Asia/Kathmandu", true);
    setDisplayTimeZone("America/New_York");
    const save = vi.fn().mockResolvedValue(undefined);
    const original = { ...release, publishedAt: "2026-10-06T00:00:37Z" };
    try {
        render(<AdminFastaiDownloads initial={[original]} save={save} />);
        const input = screen.getByLabelText("发布时间") as HTMLInputElement;
        expect(input.type).toBe("datetime-local");
        expect(input.step).toBe("1");
        expect(input.value.replace(/\.0{1,3}$/, "")).toBe("2026-10-06T05:45:37");
        fireEvent.click(screen.getByText("确认发布 FastAI 下载设置"));
        await waitFor(() => expect(save).toHaveBeenCalledWith([original]));
        fireEvent.change(input, { target: { value: "2026-10-06T06:00:37" } });
        fireEvent.click(screen.getByText("确认发布 FastAI 下载设置"));
        await waitFor(() => expect(save).toHaveBeenLastCalledWith([{ ...release, publishedAt: "2026-10-06T00:15:37Z" }]));
    } finally { setDisplayTimeZone(null); configureTimeZone("Asia/Shanghai", true); }
});

it.each(["2026-11-01T05:30:37Z", "2026-11-01T06:30:37Z"])("preserves the exact unchanged release instant in a repeated hour: %s", async (publishedAt) => {
    const { configureTimeZone } = await import("../shared/timezone");
    configureTimeZone("America/New_York", true);
    const save = vi.fn().mockResolvedValue(undefined);
    try {
        render(<AdminFastaiDownloads initial={[{ ...release, publishedAt }]} save={save} />);
        fireEvent.change(screen.getByLabelText("发布时间"), { target: { value: "2026-11-01T01:30:37.000" } });
        fireEvent.change(screen.getByLabelText("最新版本"), { target: { value: "2.0.0" } });
        fireEvent.click(screen.getByText("确认发布 FastAI 下载设置"));
        await waitFor(() => expect(save).toHaveBeenCalledWith([{ ...release, latestVersion: "2.0.0", publishedAt }]));
    } finally { configureTimeZone("Asia/Shanghai", true); }
});

it.each(["2026-11-01T05:30:37Z", "2026-11-01T06:30:37Z"])("refreshes the release time when selecting an uploaded installer over a repeated-hour release: %s", async (publishedAt) => {
    const api = await import("../shared/api");
    const { configureTimeZone } = await import("../shared/timezone");
    configureTimeZone("America/New_York", true);
    vi.useFakeTimers({ toFake: ["Date"] });
    const selectedAt = "2026-11-02T10:15:37Z";
    vi.setSystemTime(new Date(selectedAt));
    const installer = {
        ...release, id: "new-installer", name: "new.exe", size: 1024,
        latestVersion: "2.0.0", latestBuild: 4,
        downloadUrl: "https://example.com/new.exe", sha256: "b".repeat(64),
        createdAt: "2026-11-02T10:00:00Z",
    };
    const request = vi.spyOn(api, "request").mockResolvedValue({ data: [installer] });
    const save = vi.fn().mockResolvedValue(undefined);
    try {
        render(<AdminFastaiDownloads initial={[{ ...release, publishedAt }]} save={save} />);
        fireEvent.click(screen.getByRole("button", { name: "上传 / 选择已上传安装包" }));
        fireEvent.click(await screen.findByRole("button", { name: "使用此安装包" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect((screen.getByLabelText("发布时间") as HTMLInputElement).value.replace(/\.0{1,3}$/, "")).toBe("2026-11-02T05:15:37");
        fireEvent.click(screen.getByRole("button", { name: "确认发布 FastAI 下载设置" }));
        await waitFor(() => expect(save).toHaveBeenCalledWith([{
            ...release, latestVersion: installer.latestVersion, latestBuild: installer.latestBuild,
            downloadUrl: installer.downloadUrl, sha256: installer.sha256, publishedAt: selectedAt,
        }]));
    } finally {
        request.mockRestore();
        vi.useRealTimers();
        configureTimeZone("Asia/Shanghai", true);
    }
});

it.each([
    ["2026-11-01T01:31:37", "夏令时重复"],
    ["2026-03-08T02:30:37", "不存在"],
])("rejects a newly entered invalid business-zone release time: %s", async (value, message) => {
    const { configureTimeZone } = await import("../shared/timezone");
    configureTimeZone("America/New_York", true);
    const save = vi.fn().mockResolvedValue(undefined);
    try {
        render(<AdminFastaiDownloads initial={[release]} save={save} />);
        fireEvent.change(screen.getByLabelText("发布时间"), { target: { value } });
        fireEvent.click(screen.getByText("确认发布 FastAI 下载设置"));
        await waitFor(() => expect(screen.getByRole("status").textContent).toContain(message));
        expect(save).not.toHaveBeenCalled();
    } finally { configureTimeZone("Asia/Shanghai", true); }
});
