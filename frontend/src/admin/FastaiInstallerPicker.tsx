import { useEffect, useRef, useState } from "react";
import { admin, bytes, request } from "../shared/api";
import { Modal } from "../shared/ui";
import type { V10FastaiRelease } from "../shared/v10-types";

export interface FastaiInstaller {
    id: string;
    name: string;
    size: number;
    platform: V10FastaiRelease["platform"];
    architecture: V10FastaiRelease["architecture"];
    latestVersion: string;
    latestBuild: number;
    sha256: string;
    downloadUrl: string;
    createdAt: string;
}

export function FastaiInstallerPicker({
    release,
    select,
    close,
}: {
    release: V10FastaiRelease;
    select: (item: FastaiInstaller) => void;
    close: () => void;
}) {
    const [items, setItems] = useState<FastaiInstaller[]>([]);
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState(0);
    const [message, setMessage] = useState("");
    const session = useRef<{
        id: string;
        chunkBytes: number;
        index: number;
    } | null>(null);
    const controller = useRef<AbortController | null>(null);
    useEffect(() => {
        const pending = new AbortController();
        request<FastaiInstaller[]>(
            admin("fastai-installers/fetch"),
            undefined,
            { signal: pending.signal },
        )
            .then((r) => setItems(r.data))
            .catch((e) => {
                if (!pending.signal.aborted) setMessage(e.message);
            });
        return () => {
            pending.abort();
            controller.current?.abort();
        };
    }, []);

    async function upload() {
        if (!file || busy) return;
        if (file.size < 1 || file.size > 512 * 1024 * 1024) {
            setMessage("请选择 512 MiB 以内的非空安装包。");
            return;
        }
        if (!/^\d+\.\d+\.\d+$/.test(release.latestVersion)) {
            setMessage("请先关闭此窗口，填写最新版本号，例如 1.0.0。");
            return;
        }
        setBusy(true);
        setMessage("");
        const pending = new AbortController();
        controller.current = pending;
        const options = { signal: pending.signal, timeoutMs: 120000 };
        try {
            if (!session.current) {
                const response = await request<{
                    id: string;
                    chunkBytes: number;
                }>(
                    admin("fastai-installers/create"),
                    {
                        name: file.name,
                        size: file.size,
                        platform: release.platform,
                        architecture: release.architecture,
                        latestVersion: release.latestVersion,
                        latestBuild: release.latestBuild,
                    },
                    options,
                );
                session.current = { ...response.data, index: 0 };
            }
            const state = session.current;
            const count = Math.ceil(file.size / state.chunkBytes);
            for (; state.index < count; state.index++) {
                const form = new FormData();
                form.append("id", state.id);
                form.append("index", String(state.index));
                form.append(
                    "chunk",
                    file.slice(
                        state.index * state.chunkBytes,
                        (state.index + 1) * state.chunkBytes,
                    ),
                    "chunk.bin",
                );
                await request(admin("fastai-installers/chunk"), form, options);
                setProgress(Math.round(((state.index + 1) / count) * 100));
            }
            setMessage("上传完成，正在合并文件并计算 SHA-256…");
            const response = await request<FastaiInstaller>(
                admin("fastai-installers/complete"),
                { id: state.id },
                options,
            );
            select(response.data);
        } catch (error) {
            if (!pending.signal.aborted)
                setMessage(`${(error as Error).message}。可点击重试继续上传。`);
        } finally {
            if (!pending.signal.aborted) setBusy(false);
        }
    }

    const available = items.filter(
        (item) =>
            item.platform === release.platform &&
            item.architecture === release.architecture,
    );
    return (
        <Modal
            title="选择 FastAI 安装包"
            close={() => {
                if (!busy) close();
            }}
        >
            <p>
                目标：{release.platform} · {release.architecture} ·{" "}
                {release.latestVersion || "未填写版本"}（构建{" "}
                {release.latestBuild}）
            </p>
            <p className="muted">
                安装包上传后保存在服务器，自动计算下载地址和
                SHA-256。选择后仍需点击“确认发布”，才会用于用户下载与 App 更新。
            </p>
            <label>
                上传本地安装包（最大 512 MiB）
                <input
                    type="file"
                    disabled={busy}
                    accept={
                        release.platform === "android"
                            ? ".apk"
                            : release.platform === "windows"
                              ? ".exe,.msi,.zip"
                              : release.platform === "macos"
                                ? ".dmg,.pkg,.zip"
                                : ".deb,.rpm,.AppImage,.tar.gz,.zip"
                    }
                    onChange={(e) => {
                        setFile(e.target.files?.[0] || null);
                        session.current = null;
                        setProgress(0);
                        setMessage("");
                    }}
                />
            </label>
            {file && (
                <p>
                    {file.name} · {bytes(file.size)}
                </p>
            )}
            <button type="button" disabled={!file || busy} onClick={upload}>
                {busy
                    ? "上传处理中…"
                    : session.current
                      ? "重试并继续上传"
                      : "上传并使用"}
            </button>
            {(busy || progress > 0) && (
                <p>
                    <progress
                        aria-label="安装包上传进度"
                        value={progress}
                        max={100}
                    />{" "}
                    {progress}%
                </p>
            )}
            {message && <p role="status">{message}</p>}
            <h4>已上传的安装包</h4>
            <p className="muted">
                选择历史安装包会同时填入其版本和构建号；请核对最低支持版本及更新说明。降低版本号不保证已安装
                App 自动降级。
            </p>
            {!available.length && (
                <p className="muted">此平台和架构暂无已上传安装包。</p>
            )}
            {available.map((item) => (
                <div className="pad" key={item.id}>
                    <strong>
                        {item.latestVersion}（构建 {item.latestBuild}）
                    </strong>{" "}
                    · {item.name} · {bytes(item.size)}
                    <p className="muted">{item.createdAt}</p>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => select(item)}
                    >
                        使用此安装包
                    </button>
                </div>
            ))}
            <button type="button" disabled={busy} onClick={close}>
                关闭
            </button>
        </Modal>
    );
}
