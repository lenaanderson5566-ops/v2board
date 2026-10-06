// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminFastaiDownloads } from "./AdminFastaiDownloads";
import type { V10FastaiRelease } from "../shared/v10-types";

afterEach(cleanup);
const release: V10FastaiRelease = { platform: "windows", architecture: "x64", channel: "stable", latestVersion: "1.2.0", latestBuild: 3, minimumVersion: "1.0.0", downloadUrl: "https://example.com/fastai.exe", sha256: "a".repeat(64), publishedAt: "2026-10-06T00:00:00Z" };

it("saves separate platform packages without changing other entries", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AdminFastaiDownloads initial={[release, { ...release, platform: "macos", architecture: "arm64", downloadUrl: "https://example.com/fastai.dmg" }]} save={save} />);
    fireEvent.change(screen.getAllByLabelText("最新版本")[1], { target: { value: "2.0.0" } });
    fireEvent.click(screen.getByText("保存 FastAI 下载设置"));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0][0]).toEqual(release);
    expect(save.mock.calls[0][0][1]).toMatchObject({ platform: "macos", architecture: "arm64", latestVersion: "2.0.0" });
    expect(screen.queryByRole("option", { name: "iOS" })).toBeNull();
});

it("removes a package and reports server validation errors", async () => {
    const save = vi.fn().mockRejectedValue(new Error("Duplicate release target"));
    render(<AdminFastaiDownloads initial={[release]} save={save} />);
    fireEvent.click(screen.getByText("移除此安装包"));
    fireEvent.click(screen.getByText("保存 FastAI 下载设置"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Duplicate release target"));
    expect(save).toHaveBeenCalledWith([]);
});

it("keeps inputs editable while saving and saves later edits on the next submission", async () => {
    let finish!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    render(<AdminFastaiDownloads initial={[release]} save={save} />);
    fireEvent.click(screen.getByText("保存 FastAI 下载设置"));
    const input = screen.getByLabelText("最新版本") as HTMLInputElement;
    expect(input.matches(":disabled")).toBe(false);
    expect((screen.getByText("保存中…") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "1.3.0" } });
    expect(save.mock.calls[0][0][0].latestVersion).toBe("1.2.0");
    finish();
    await waitFor(() => expect((screen.getByText("保存 FastAI 下载设置") as HTMLButtonElement).disabled).toBe(false));
    expect(input.value).toBe("1.3.0");
    expect(screen.getByRole("status").textContent).toContain("后续修改尚未保存");
    fireEvent.change(input, { target: { value: "1.4.0" } });
    fireEvent.click(screen.getByText("保存 FastAI 下载设置"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0][0].latestVersion).toBe("1.4.0");
    await waitFor(() => expect((screen.getByText("保存 FastAI 下载设置") as HTMLButtonElement).disabled).toBe(false));
});
