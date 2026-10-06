import { useRef, useState } from "react";
import { admin, request, Row } from "../shared/api";
import { Modal, Panel, State, useData } from "../shared/ui";
import { languages } from "../shared/i18n";
import {
    bannerUrl,
    bannerImages,
    presetBanner,
    presetMobileBanner,
} from "../shared/BannerStrip";
import "../shared/banners.css";
const preset = presetBanner;
const positions: Record<string, string> = {
    dashboard: "用户首页",
    landing: "落地页",
};
function localDate(value: number) {
    if (!value) return "";
    const d = new Date(value * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
}
function dateLabel(value: number) {
    return value
        ? new Date(value * 1000).toLocaleString("zh-CN", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
          })
        : "不限";
}
export function AdminBanners() {
    const data = useData<Row[]>(admin("banner/fetch"));
    const [editing, setEditing] = useState<Row | null>(null),
        [error, setError] = useState(""),
        [busy, setBusy] = useState(false);
    async function action(row: Row, remove = false) {
        if (
            busy ||
            (remove && !window.confirm(`删除 Banner「${row.title}」？`))
        )
            return;
        setBusy(true);
        setError("");
        try {
            await request(admin(`banner/${remove ? "drop" : "show"}`), {
                id: row.id,
                ...(!remove ? { show: !row.show } : {}),
            });
            data.reload();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <Panel
            title="Banner 管理"
            actions={
                <>
                    <button onClick={() => data.reload()}>刷新</button>
                    <button
                        className="primary"
                        onClick={() =>
                            setEditing({
                                title: "",
                                image_url: "",
                                mobile_image_url: "",
                                target_url: "",
                                placements: ["dashboard"],
                                languages: [],
                                show: true,
                                sort: 0,
                            })
                        }
                    >
                        新建 Banner
                    </button>
                </>
            }
        >
            <div className="banner-list">
                <p>排序数字越小越靠前；每个位置最多展示 6 张。</p>
                <State {...data} retry={data.reload}>
                    {null}
                </State>
                {error && (
                    <p role="alert" className="banner-error">
                        {error}
                    </p>
                )}
                {data.data?.map((row) => (
                    <article className="banner-item" key={row.id}>
                        {bannerUrl(row.image_url) && (
                            <img
                                className="banner-desktop-preview"
                                src={bannerImages(row).desktop}
                                alt={row.title}
                            />
                        )}
                        <div className="banner-item-info">
                            <h3>{row.title}</h3>
                            <p>
                                {row.placements
                                    .map((p: string) => positions[p])
                                    .join(" · ")}{" "}
                                ·{" "}
                                {row.show
                                    ? row.starts_at > Date.now() / 1000
                                        ? "待上线"
                                        : row.ends_at &&
                                            row.ends_at <= Date.now() / 1000
                                          ? "已到期"
                                          : "已启用"
                                    : "已停用"}{" "}
                                · 排序 {row.sort}
                            </p>
                            <p>
                                {row.languages?.length
                                    ? row.languages
                                          .map(
                                              (c: string) =>
                                                  languages.find(
                                                      (l) => l.code === c,
                                                  )?.name || c,
                                          )
                                          .join("、")
                                    : "全部语言"}
                            </p>
                            <p>
                                上线 {dateLabel(row.starts_at)} / 下线{" "}
                                {dateLabel(row.ends_at)}
                            </p>
                        </div>
                        <div className="actions">
                            <button onClick={() => setEditing(row)}>
                                编辑 / 预览
                            </button>
                            <button disabled={busy} onClick={() => action(row)}>
                                {row.show ? "停用" : "启用"}
                            </button>
                            <button
                                disabled={busy}
                                onClick={() => action(row, true)}
                            >
                                删除
                            </button>
                        </div>
                    </article>
                ))}
                {data.data?.length === 0 && (
                    <p>暂无 Banner，点击“新建 Banner”添加。</p>
                )}
            </div>
            {editing && (
                <BannerEditor
                    initial={editing}
                    close={() => setEditing(null)}
                    complete={() => {
                        setEditing(null);
                        data.reload();
                    }}
                />
            )}
        </Panel>
    );
}
export function BannerEditor({
    initial,
    close,
    complete,
}: {
    initial: Row;
    close: () => void;
    complete: () => void;
}) {
    const [draft, setDraft] = useState<Row>({
        ...initial,
        image_url: bannerImages(initial).desktop,
        mobile_image_url: bannerImages(initial).mobile || "",
        starts_at: localDate(initial.starts_at),
        ends_at: localDate(initial.ends_at),
    });
    const [busy, setBusy] = useState(false),
        [uploading, setUploading] = useState(false),
        [error, setError] = useState("");
    const lock = useRef(false);
    function change(key: string, value: unknown) {
        setDraft((d) => ({ ...d, [key]: value }));
    }
    function toggle(key: string, value: string) {
        setDraft((d) => ({
            ...d,
            [key]: (d[key] || []).includes(value)
                ? d[key].filter((v: string) => v !== value)
                : [...(d[key] || []), value],
        }));
    }
    async function upload(file: File | undefined, key: string) {
        if (!file || lock.current) return;
        if (
            !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
            file.size > 5 * 1024 * 1024
        ) {
            setError("请上传不超过 5 MB 的 PNG、JPG 或 WebP 图片。");
            return;
        }
        lock.current = true;
        setUploading(true);
        setError("");
        try {
            const form = new FormData();
            form.append("image", file);
            const result = await request<{ url: string }>(
                admin("banner/upload"),
                form,
            );
            change(key, result.data.url);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            lock.current = false;
            setUploading(false);
        }
    }
    async function save(e: React.FormEvent) {
        e.preventDefault();
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            await request(admin("banner/save"), {
                ...draft,
                sort: Number(draft.sort),
                mobile_image_url: draft.mobile_image_url || null,
                target_url: draft.target_url || null,
                starts_at: draft.starts_at
                    ? Math.floor(new Date(draft.starts_at).getTime() / 1000)
                    : null,
                ends_at: draft.ends_at
                    ? Math.floor(new Date(draft.ends_at).getTime() / 1000)
                    : null,
            });
            complete();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }
    return (
        <Modal
            title={initial.id ? "编辑 Banner" : "新建 Banner"}
            variant="drawer"
            wide
            close={close}
        >
            <form className="banner-editor" onSubmit={save}>
                <label>
                    标题 / 图片替代文本
                    <input
                        required
                        maxLength={200}
                        value={draft.title}
                        onChange={(e) => change("title", e.target.value)}
                    />
                </label>
                <button
                    type="button"
                    disabled={busy || uploading}
                    onClick={() =>
                        setDraft((d) => ({
                            ...d,
                            image_url: preset,
                            mobile_image_url: presetMobileBanner,
                            title:
                                d.title ||
                                "Fastdog 3.0 — Faster. Simpler. Smarter.",
                        }))
                    }
                >
                    使用 Fastdog 3.0 预置图片
                </button>
                {[
                    ["image_url", "主图片"],
                    ["mobile_image_url", "手机图片（可选）"],
                ].map(([key, label]) => (
                    <label key={key}>
                        {label}
                        <input
                            required={key === "image_url"}
                            value={draft[key] || ""}
                            placeholder="上传图片或填写 HTTPS 图片地址"
                            onChange={(e) => change(key, e.target.value)}
                        />
                        <input
                            className="banner-file"
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={busy || uploading}
                            onChange={(e) => {
                                upload(e.target.files?.[0], key);
                                e.target.value = "";
                            }}
                        />
                        {bannerUrl(draft[key]) && (
                            <img
                                className={
                                    key === "image_url"
                                        ? "banner-desktop-preview"
                                        : "banner-mobile-preview"
                                }
                                src={draft[key]}
                                alt={`${label}预览`}
                            />
                        )}
                    </label>
                ))}
                <small>
                    桌面按约 6:1 显示，高度 128–180px；手机按 3:1
                    显示。文字请放在中央安全区域；支持 PNG、JPG、WebP，最大 5
                    MB。
                </small>
                <label>
                    点击跳转（可选）
                    <input
                        value={draft.target_url || ""}
                        placeholder="例如 /app#/plan 或 https://example.com"
                        onChange={(e) => change("target_url", e.target.value)}
                    />
                </label>
                <fieldset>
                    <legend>展示位置</legend>
                    {Object.entries(positions).map(([code, name]) => (
                        <label key={code}>
                            <input
                                type="checkbox"
                                checked={draft.placements.includes(code)}
                                onChange={() => toggle("placements", code)}
                            />
                            {name}
                        </label>
                    ))}
                </fieldset>
                <fieldset>
                    <legend>语言范围（不勾选表示全部语言）</legend>
                    {languages.map((l) => (
                        <label key={l.code}>
                            <input
                                type="checkbox"
                                checked={(draft.languages || []).includes(
                                    l.code,
                                )}
                                onChange={() => toggle("languages", l.code)}
                            />
                            {l.name}
                        </label>
                    ))}
                </fieldset>
                <div className="banner-options">
                    <label>
                        排序
                        <input
                            type="number"
                            min={0}
                            max={100000}
                            required
                            value={draft.sort}
                            onChange={(e) => change("sort", e.target.value)}
                        />
                    </label>
                    <label>
                        上线时间
                        <input
                            type="datetime-local"
                            value={draft.starts_at}
                            onChange={(e) =>
                                change("starts_at", e.target.value)
                            }
                        />
                    </label>
                    <label>
                        下线时间
                        <input
                            type="datetime-local"
                            value={draft.ends_at}
                            onChange={(e) => change("ends_at", e.target.value)}
                        />
                    </label>
                </div>
                <small>时间按当前设备时区填写；留空表示不限制。</small>
                <label style={{ display: "flex", alignItems: "center" }}>
                    <input
                        type="checkbox"
                        checked={draft.show}
                        onChange={(e) => change("show", e.target.checked)}
                    />
                    启用
                </label>
                {error && (
                    <p role="alert" className="banner-error">
                        {error}
                    </p>
                )}
                <div className="actions">
                    <button type="button" onClick={close}>
                        取消
                    </button>
                    <button
                        className="primary"
                        disabled={busy || uploading || !draft.placements.length}
                    >
                        {uploading ? "正在上传…" : busy ? "保存中…" : "保存"}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
