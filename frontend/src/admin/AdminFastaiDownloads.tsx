import { useRef, useState, type FormEvent } from "react";
import type { V10FastaiRelease } from "../shared/v10-types";
import { dateTimeFieldValue, dateTimeFieldInstant } from "../shared/date-time-field";
import { FastaiInstallerPicker } from "./FastaiInstallerPicker";

const platforms = {
    windows: "Windows",
    macos: "macOS",
    android: "Android",
    linux: "Linux",
};
const architectures = {
    x64: "Intel / AMD · x64",
    arm64: "ARM64 / Apple Silicon",
    arm: "ARM",
    x86: "x86",
};
type ReleaseDraft = V10FastaiRelease & { publishedAtInput: string };

export function AdminFastaiDownloads({
    initial,
    save,
}: {
    initial: V10FastaiRelease[];
    save: (releases: V10FastaiRelease[]) => Promise<void>;
}) {
    const [releases, setReleases] = useState<ReleaseDraft[]>(() => initial.map(release => ({
        ...release, publishedAtInput: dateTimeFieldValue(release.publishedAt),
    })));
    const currentDraft = useRef(releases);
    currentDraft.current = releases;
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [picker, setPicker] = useState<number | null>(null);
    function update(index: number, values: Partial<ReleaseDraft>) {
        const changes = values.publishedAt === undefined ? values : {
            ...values, publishedAtInput: dateTimeFieldValue(values.publishedAt),
        };
        setReleases((items) =>
            items.map((item, i) =>
                i === index ? { ...item, ...changes } : item,
            ),
        );
        setMessage("");
    }
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setMessage("");
        try {
            await save(releases.map(({ publishedAtInput, ...release }) => {
                const at = dateTimeFieldInstant(publishedAtInput, release.publishedAt);
                if (at == null) throw new Error("请填写发布时间");
                return { ...release, publishedAt: new Date(at * 1000).toISOString().replace(/\.000Z$/, "Z") };
            }));
            setMessage(
                currentDraft.current === releases
                    ? "FastAI 下载与版本设置已发布"
                    : "本次提交已发布；后续修改尚未发布",
            );
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <>
            <form className="pad" onSubmit={submit}>
                <h3>FastAI 客户端下载与更新</h3>
                <p className="muted">发布安装包后，请确认客户端已启用且最低版本与下载版本一致，避免用户下载后无法接入。<a href="#/clients">管理访问与版本策略</a></p>
                <p className="muted">
                    为每个平台和架构分别发布安装包。可上传本地文件或填写外部
                    HTTPS 链接。上传和选择只修改草稿，确认发布后才更新用户下载及
                    App 更新策略。iOS 继续使用下方原有设置。
                </p>
                <fieldset
                    disabled={busy || picker !== null}
                    style={{ border: 0, padding: 0 }}
                >
                    {releases.map((release, index) => (
                        <fieldset
                            key={index}
                            className="pad"
                            style={{ marginBottom: 16 }}
                        >
                            <legend>
                                {platforms[release.platform]} ·{" "}
                                {release.architecture}
                            </legend>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns:
                                        "repeat(auto-fit, minmax(220px, 1fr))",
                                    gap: 12,
                                }}
                            >
                                <label>
                                    平台
                                    <select
                                        value={release.platform}
                                        onChange={(e) =>
                                            update(index, {
                                                platform: e.target
                                                    .value as V10FastaiRelease["platform"],
                                            })
                                        }
                                    >
                                        {Object.entries(platforms).map(
                                            ([key, label]) => (
                                                <option key={key} value={key}>
                                                    {label}
                                                </option>
                                            ),
                                        )}
                                    </select>
                                </label>
                                <label>
                                    架构
                                    <select
                                        value={release.architecture}
                                        onChange={(e) =>
                                            update(index, {
                                                architecture: e.target
                                                    .value as V10FastaiRelease["architecture"],
                                            })
                                        }
                                    >
                                        {Object.entries(architectures).map(
                                            ([key, label]) => (
                                                <option key={key} value={key}>
                                                    {label}
                                                </option>
                                            ),
                                        )}
                                    </select>
                                </label>
                                <label>
                                    最新版本
                                    <input
                                        required
                                        placeholder="1.0.0"
                                        value={release.latestVersion}
                                        onChange={(e) =>
                                            update(index, {
                                                latestVersion: e.target.value,
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    构建号
                                    <input
                                        required
                                        type="number"
                                        min={1}
                                        max={2100000000}
                                        value={release.latestBuild}
                                        onChange={(e) =>
                                            update(index, {
                                                latestBuild: Number(
                                                    e.target.value,
                                                ),
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    最低支持版本
                                    <input
                                        required
                                        placeholder="1.0.0"
                                        value={release.minimumVersion}
                                        onChange={(e) =>
                                            update(index, {
                                                minimumVersion: e.target.value,
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    发布时间
                                    <input
                                        required
                                        type="datetime-local"
                                        step={1}
                                        value={release.publishedAtInput}
                                        onChange={(e) =>
                                            update(index, {
                                                publishedAtInput: e.target.value,
                                            })
                                        }
                                    />
                                </label>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPicker(index)}
                            >
                                上传 / 选择已上传安装包
                            </button>
                            <label>
                                安装包 HTTPS
                                下载地址（上传自动填写，也可使用外部链接）
                                <input
                                    required
                                    type="url"
                                    value={release.downloadUrl}
                                    onChange={(e) =>
                                        update(index, {
                                            downloadUrl: e.target.value,
                                        })
                                    }
                                />
                            </label>
                            <label>
                                安装包 SHA-256
                                <input
                                    required
                                    pattern="[a-f0-9]{64}"
                                    value={release.sha256}
                                    onChange={(e) =>
                                        update(index, {
                                            sha256: e.target.value,
                                        })
                                    }
                                />
                            </label>
                            <label>
                                更新说明
                                <textarea
                                    maxLength={12000}
                                    value={release.releaseNotes || ""}
                                    onChange={(e) =>
                                        update(index, {
                                            releaseNotes: e.target.value,
                                        })
                                    }
                                />
                            </label>
                            <button
                                type="button"
                                onClick={() => {
                                    setReleases((items) =>
                                        items.filter((_, i) => i !== index),
                                    );
                                    setMessage("");
                                }}
                            >
                                移除此安装包
                            </button>
                        </fieldset>
                    ))}
                    {!releases.length && (
                        <p className="muted">尚未发布 FastAI 安装包。</p>
                    )}
                    <button
                        type="button"
                        disabled={releases.length >= 32}
                        onClick={() => {
                            setMessage("");
                            const publishedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
                            setReleases((items) => [
                                ...items,
                                {
                                    platform: "windows",
                                    architecture: "x64",
                                    channel: "stable",
                                    latestVersion: "",
                                    latestBuild: 1,
                                    minimumVersion: "",
                                    downloadUrl: "",
                                    sha256: "",
                                    publishedAt,
                                    publishedAtInput: dateTimeFieldValue(publishedAt),
                                    releaseNotes: "",
                                },
                            ]);
                        }}
                    >
                        添加平台安装包
                    </button>
                    <button type="submit" disabled={busy}>
                        {busy ? "发布中…" : "确认发布 FastAI 下载设置"}
                    </button>
                </fieldset>
                {message && <p role="status">{message}</p>}
            </form>
            {picker !== null && (
                <FastaiInstallerPicker
                    release={releases[picker]}
                    close={() => setPicker(null)}
                    select={(item) => {
                        update(picker, {
                            downloadUrl: item.downloadUrl,
                            sha256: item.sha256,
                            latestVersion: item.latestVersion,
                            latestBuild: item.latestBuild,
                            publishedAt: new Date()
                                .toISOString()
                                .replace(/\.\d{3}Z$/, "Z"),
                        });
                        setPicker(null);
                        setMessage(
                            "安装包已选入草稿；请核对版本、最低支持版本及更新说明后确认发布。",
                        );
                    }}
                />
            )}
        </>
    );
}
