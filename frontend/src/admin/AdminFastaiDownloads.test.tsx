// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => { window.V2BOARD = { mode: "admin", adminPath: "test-admin" } as any; });
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminFastaiDownloads } from "./AdminFastaiDownloads";
import type { V10FastaiRelease } from "../shared/v10-types";

afterEach(cleanup);
const release: V10FastaiRelease = { platform: "windows", architecture: "x64", channel: "stable", latestVersion: "1.2.0", latestBuild: 3, minimumVersion: "1.0.0", downloadUrl: "https://example.com/fastai.exe", sha256: "a".repeat(64), publishedAt: "2026-10-06T00:00:00Z" };

it("saves separate platform packages without changing other entries", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AdminFastaiDownloads initial={[release, { ...release, platform: "macos", architecture: "arm64", downloadUrl: "https://example.com/fastai.dmg" }]} save={save} />);
    fireEvent.change(screen.getAllByLabelText("最新版本")[1], { target: { value: "2.0.0" } });
    fireEvent.click(screen.getByText("确认发布 FastAI 下载设置"));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0][0]).toEqual(release);
    expect(save.mock.calls[0][0][1]).toMatchObject({ platform: "macos", architecture: "arm64", latestVersion: "2.0.0" });
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
