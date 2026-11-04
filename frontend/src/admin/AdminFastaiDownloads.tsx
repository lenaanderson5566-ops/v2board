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
export type FastaiReleaseTargets = Partial<Record<V10FastaiRelease["platform"], V10FastaiRelease["architecture"][]>>;
type CatalogSnapshot = {
    releases: V10FastaiRelease[];
    revision: string;
    globalMinimum?: string | null;
};

function compareVersion(a: string, b: string) {
    const parse = (value: string) => /^v?(\d+(?:\.\d+){0,3})(?:-(alpha|beta|rc)[.-]?(\d*))?(?:\+[a-z0-9.-]+)?$/i.exec(value.trim());
    const left = parse(a);
    const right = parse(b);
    if (!left || !right) return null;
    const leftParts = left[1].split(".");
    const rightParts = right[1].split(".");
    for (let i = 0; i < 4; i++) {
        const x = BigInt(leftParts[i] ?? "0");
        const y = BigInt(rightParts[i] ?? "0");
        if (x !== y) return x < y ? -1 : 1;
    }
    const stages = ["alpha", "beta", "rc", "stable"];
    const stageOrder = stages.indexOf(left[2]?.toLowerCase() ?? "stable")
        - stages.indexOf(right[2]?.toLowerCase() ?? "stable");
    if (stageOrder) return Math.sign(stageOrder);
    const x = BigInt(left[3] || "0");
    const y = BigInt(right[3] || "0");
    return x === y ? 0 : x < y ? -1 : 1;
}

const toDraft = (releases: V10FastaiRelease[]): ReleaseDraft[] =>
    releases.map(release => ({ ...release, publishedAtInput: dateTimeFieldValue(release.publishedAt) }));
const targetLabel = (release: V10FastaiRelease) => `${platforms[release.platform]} · ${release.architecture}`;
const releaseFingerprint = (release: V10FastaiRelease) => JSON.stringify(
    Object.entries({ ...release, releaseNotes: release.releaseNotes ?? null }).sort(([a], [b]) => a.localeCompare(b)),
);
function installerHost(url: string) {
    try {
        return new URL(url).host || "待填写";
    } catch {
        return "待填写";
    }
}

export function AdminFastaiDownloads({
    initial,
    initialRevision,
    globalMinimum,
    targets,
    save,
    reload,
}: {
    initial: V10FastaiRelease[];
    initialRevision?: string;
    globalMinimum?: string | null;
    targets?: FastaiReleaseTargets;
    save: (releases: V10FastaiRelease[], revision?: string) => Promise<void>;
    reload?: () => Promise<CatalogSnapshot>;
}) {
    const [releases, setReleases] = useState<ReleaseDraft[]>(() => toDraft(initial));
    const [revision, setRevision] = useState(initialRevision);
    const baseline = useRef(initial);
    const [loadedMinimum, setLoadedMinimum] = useState<string | null | undefined>(undefined);
    const policyMinimum = loadedMinimum === undefined ? globalMinimum : loadedMinimum;
    const [needsReload, setNeedsReload] = useState(false);
    const dirty = JSON.stringify(releases) !== JSON.stringify(toDraft(baseline.current));
    const currentDraft = useRef(releases);
    currentDraft.current = releases;
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [picker, setPicker] = useState<number | null>(null);
    const entries = Object.entries(platforms) as [V10FastaiRelease["platform"], string][];
    const availablePlatforms = entries.filter(([platform]) => !targets || targets[platform]?.length);
    const architecturesFor = (platform: V10FastaiRelease["platform"]) => targets
        ? targets[platform] ?? []
        : Object.keys(architectures) as V10FastaiRelease["architecture"][];
    const unsupported = releases.map(release => !architecturesFor(release.platform).includes(release.architecture));
    const blockers = releases.map(({ publishedAtInput, ...release }, index) => {
        if (unsupported[index]) {
            const previous = baseline.current.find(item => targetLabel(item) === targetLabel(release));
            return previous && publishedAtInput === dateTimeFieldValue(previous.publishedAt)
                && releaseFingerprint(previous) === releaseFingerprint(release)
                ? null
                : "此平台与架构组合不在发布目标中。旧条目仅可原样保留或移除。";
        }
        if (policyMinimum && compareVersion(release.latestVersion, policyMinimum) === -1) {
            return `最新版本低于客户端访问策略的最低版本 ${policyMinimum}。`;
        }
        if (compareVersion(release.latestVersion, release.minimumVersion) === -1) {
            return `最新版本低于此安装包的最低支持版本 ${release.minimumVersion}。`;
        }
        return null;
    });

    function adoptCatalog(catalog: CatalogSnapshot) {
        baseline.current = catalog.releases;
        setReleases(toDraft(catalog.releases));
        setRevision(catalog.revision);
        setLoadedMinimum(catalog.globalMinimum ?? null);
        setNeedsReload(false);
    }

    async function reloadCatalog() {
        if (!reload || busy) return;
        setBusy(true);
        try {
            const latest = await reload();
            const before = new Map(baseline.current.map(release => [targetLabel(release), releaseFingerprint(release)]));
            const after = new Map(latest.releases.map(release => [targetLabel(release), releaseFingerprint(release)]));
            const changed = [...new Set([...before.keys(), ...after.keys()])].filter(key => before.get(key) !== after.get(key));
            adoptCatalog(latest);
            setMessage(changed.length ? `已加载最新发布目录。变更目标：${changed.join("、")}` : "已加载最新发布目录。");
        } catch (error) {
            setMessage(`加载发布目录失败。${(error as Error).message}`);
        } finally {
            setBusy(false);
        }
    }
    function update(index: number, values: Partial<ReleaseDraft>) {
        const changes = values.publishedAt === undefined ? values : {
            ...values, publishedAtInput: dateTimeFieldValue(values.publishedAt),
        };
        setReleases((items) =>
            items.map((item, i) => {
                if (i !== index) return item;
                const targetChanged = (changes.platform !== undefined && changes.platform !== item.platform)
                    || (changes.architecture !== undefined && changes.architecture !== item.architecture);
                return { ...item, ...(targetChanged ? { downloadUrl: "", sha256: "" } : {}), ...changes };
            }),
        );
        setMessage("");
    }
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (busy || needsReload || blockers.some(Boolean)) return;
        setBusy(true);
        setMessage("");
        try {
            const catalog = releases.map(({ publishedAtInput, ...release }) => {
                const at = dateTimeFieldInstant(publishedAtInput, release.publishedAt);
                if (at == null) throw new Error("请填写发布时间");
                return { ...release, publishedAt: new Date(at * 1000).toISOString().replace(/\.000Z$/, "Z") };
            });
            if (revision === undefined) await save(catalog);
            else await save(catalog, revision);
            baseline.current = catalog;
            if (reload) {
                try {
                    adoptCatalog(await reload());
                } catch {
                    setNeedsReload(true);
                    setMessage("已发布，但未能读取最新发布目录。请重新加载后再编辑。");
                    return;
                }
            }
            setMessage(
                currentDraft.current === releases
                    ? "FastAI 下载与版本设置已发布"
                    : "本次提交已发布；后续修改尚未发布",
            );
        } catch (error) {
            if ((error as { status?: number })?.status === 409 && reload) {
                setNeedsReload(true);
                setMessage("发布目录已被更新，当前草稿尚未发布。请重新加载最新目录后再编辑。");
            } else setMessage((error as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <>
            <form className="pad" onSubmit={submit} aria-busy={busy} data-unsaved={dirty ? "true" : undefined}>
                <h3>FastAI 客户端下载与更新</h3>
                <p className="muted">客户端访问策略最低版本：{policyMinimum || "未设置"}。<a href="#/clients">管理访问与版本策略</a></p>
                <p className="muted">
                    为每个平台和架构分别发布安装包。可上传本地文件或填写外部
                    HTTPS 链接。上传和选择只修改草稿，确认发布后才更新用户下载及
                    App 更新策略。发布时间用于展示，确认发布后立即生效。iOS 继续使用下方原有设置。
                </p>
                <fieldset
                    disabled={busy || needsReload || picker !== null}
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
                            <p className="muted">
                                版本：{release.latestVersion || "待填写"} · 构建号：{release.latestBuild} · 安装包来源：{installerHost(release.downloadUrl)}
                            </p>
                            <p className="muted">
                                生效最低版本：{policyMinimum && compareVersion(release.minimumVersion, policyMinimum) !== 1
                                    ? policyMinimum
                                    : release.minimumVersion || "待填写"}
                            </p>
                            {blockers[index] && <p role="alert">{blockers[index]}</p>}
                            {unsupported[index] && !blockers[index] && <p className="muted">旧目标已停止支持。可以原样保留或移除。</p>}
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
                                        onChange={(e) => {
                                            const platform = e.target.value as V10FastaiRelease["platform"];
                                            const options = architecturesFor(platform);
                                            update(index, {
                                                platform,
                                                architecture: options.includes(release.architecture)
                                                    ? release.architecture
                                                    : options[0] ?? release.architecture,
                                            });
                                        }}
                                    >
                                        {!availablePlatforms.some(([platform]) => platform === release.platform) && (
                                            <option value={release.platform} disabled>{platforms[release.platform]}（不可发布）</option>
                                        )}
                                        {availablePlatforms.map(
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
                                        {!architecturesFor(release.platform).includes(release.architecture) && (
                                            <option value={release.architecture} disabled>{architectures[release.architecture]}（不可发布）</option>
                                        )}
                                        {architecturesFor(release.platform).map(
                                            (key) => (
                                                <option key={key} value={key}>
                                                    {architectures[key]}
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
                        disabled={releases.length >= 32 || availablePlatforms.length === 0}
                        onClick={() => {
                            setMessage("");
                            const platform = availablePlatforms[0]?.[0];
                            if (!platform) return;
                            const architecture = architecturesFor(platform)[0];
                            if (!architecture) return;
                            const publishedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
                            setReleases((items) => [
                                ...items,
                                {
                                    platform,
                                    architecture,
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
                    <button type="submit" disabled={busy || blockers.some(Boolean)}>
                        {busy ? "发布中…" : "确认发布 FastAI 下载设置"}
                    </button>
                </fieldset>
                {message && <p role="status">{message}</p>}
                {needsReload && reload && (
                    <button type="button" disabled={busy} onClick={() => void reloadCatalog()}>
                        放弃当前草稿并加载最新发布目录
                    </button>
                )}
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
