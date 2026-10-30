import { languages } from "../shared/language-options";
import zhCN from "../locales/zh-CN.json";
type PreviewCatalog = {
    experience: Record<string, string>;
    translation: Record<string, string>;
};
const catalogs = import.meta.glob<PreviewCatalog>("../locales/*.json", {
    import: "default",
});
import { useEffect, useState } from "react";
import { boot, type Row } from "../shared/api";
import { BrowserNoticeView } from "../shared/ui/BrowserNoticeView";
import { browserLabel } from "./browser-labels";
import { browserPolicy } from "../shared/browser-access";
import "./browser-preview.css";
const platforms = {
    wechat: "WeChat",
    qq: "QQ",
    weibo: "Weibo",
    xiaohongshu: "xiaohongshu",
    douyin: "douyin",
    bilibili: "bilibili",
    alipay: "alipay",
    dingtalk: "dingtalk",
    wecom: "wecom",
    other: "Other",
    system: null,
};
const policyLabels = { allow: "允许访问", prompt: "提示后允许访问", guide: "仅显示引导" };
const platformName = (key: keyof typeof platforms) => key === "system" ? "系统浏览器（对照）" : browserLabel(key);
export function AdminBrowserPreview({ values }: { values: Row }) {
    const [language, setLanguage] = useState("zh-CN");
    const [catalog, setCatalog] = useState<{
        code: string;
        values: PreviewCatalog;
    }>({ code: "zh-CN", values: zhCN });
    const [languageError, setLanguageError] = useState("");
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let current = true;
        setLanguageError("");
        catalogs[`../locales/${language}.json`]()
            .then((values) => {
                if (current) setCatalog({ code: language, values });
            })
            .catch(() => {
                if (current) setLanguageError("语言资源加载失败，请重试。");
            });
        return () => {
            current = false;
        };
    }, [language, retry]);
    const [platform, setPlatform] = useState<keyof typeof platforms>("wechat");
    const [device, setDevice] = useState("ios");
    const [continued, setContinued] = useState("");
    const [revision, setRevision] = useState(0);
    const policies = Object.fromEntries(
        Object.entries(values)
            .filter(([key]) => key.startsWith("browser_policy_"))
            .map(([key, value]) => [key.slice(15), value]),
    );
    const policy = browserPolicy(platforms[platform], policies);
    const identity = `${platform}-${device}-${policy}-${language}`;
    useEffect(() => setContinued(""), [identity]);
    function resetPreview() {
        setContinued("");
        setRevision(value => value + 1);
    }
    return (
        <section className="pad browser-preview" aria-label="浏览器策略预览">
            <h3>浏览器策略预览</h3>
            <p className="muted">预览使用当前未保存的表单。保存后对重新加载的用户页面生效；独立部署的前端需重新导出运行配置。</p>
            <div className="browser-entry-explanation">
                <h4>入口公开说明</h4>
                <p>受限入口仅展示真实站点名称和浏览器访问方法，不展示账户、套餐或支付内容。进入工作区后，用户才能继续相应业务。</p>
            </div>
            <h4>工作区访问策略</h4>
            <dl className="browser-policy-modes" aria-label="访问模式说明">
                <div><dt>允许访问</dt><dd>直接加载用户工作区，不显示入口说明。</dd></div>
                <div><dt>提示后允许访问</dt><dd>先展示中性入口说明，用户选择继续后才加载工作区。</dd></div>
                <div><dt>仅显示引导</dt><dd>仅展示中性入口说明及复制地址，不提供工作区继续入口。</dd></div>
            </dl>
            <p className="browser-policy-scope">未显式配置时，微信、QQ、微博和企业微信默认仅显示引导；已保存的允许或提示设置继续优先。普通浏览器正常访问。浏览器标识可能被隐藏或修改，这些策略不替代登录、API 权限校验或风控，也不保证域名不会被平台标记。</p>
            <h4>当前草稿策略</h4>
            <div className="browser-policy-overview" role="group" aria-label="选择平台预览">
                {(Object.keys(platforms) as (keyof typeof platforms)[]).filter(key => key !== "system").map(key => (
                    <button type="button" key={key} aria-pressed={platform === key}
                        onClick={() => { setPlatform(key); resetPreview(); }}>
                        <span>{browserLabel(key)}</span>
                        <small>{policyLabels[browserPolicy(platforms[key], policies)]}</small>
                    </button>
                ))}
            </div>
            <div className="browser-preview-controls">
                <label>
                    预览语言
                    <select
                        value={language}
                        onChange={(event) => setLanguage(event.target.value)}
                    >
                        {languages.map((item) => (
                            <option key={item.code} value={item.code}>
                                {item.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    预览平台
                    <select
                        value={platform}
                        onChange={(e) => {
                            setPlatform(
                                e.target.value as keyof typeof platforms,
                            );
                            setContinued("");
                        }}
                    >
                        {Object.keys(platforms).map((key) => (
                            <option key={key} value={key}>
                                {platformName(key as keyof typeof platforms)}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    预览设备
                    <select
                        value={device}
                        onChange={(e) => {
                            setDevice(e.target.value);
                            setContinued("");
                        }}
                    >
                        <option value="ios">iOS</option>
                        <option value="android">Android</option>
                        <option value="windows">桌面</option>
                        <option value="unknown">未知设备</option>
                    </select>
                </label>
                <button type="button" onClick={resetPreview}>
                    重新预览
                </button>
            </div>
            <p className="browser-preview-summary">{platformName(platform)} · {policyLabels[policy]}</p>
            <p className="muted browser-preview-simulation">下方是交互演示，不复制真实地址、不打开外部浏览器，也不提交设置。</p>
            <div className="browser-preview-frame" key={`${identity}-${revision}`}>
                {languageError ? (
                    <div role="alert">
                        {languageError}
                        <button
                            type="button"
                            onClick={() => setRetry((value) => value + 1)}
                        >
                            重试语言加载
                        </button>
                    </div>
                ) : catalog.code !== language ? (
                    <p role="status">正在加载预览语言…</p>
                ) : policy === "allow" ||
                  (continued === identity && policy === "prompt") ? (
                    <div className="pad" role="status">
                        <strong>用户可以进入网站。此处仅为页面入口示意。</strong>
                        <p>{platform === "system" ? "系统浏览器对照：不显示内置浏览器引导。" : policy === "allow" ? "当前草稿允许该应用直接访问。" : "已演示继续访问，可重新预览查看初始引导。"}</p>
                    </div>
                ) : (
                    <BrowserNoticeView
                        translations={catalog.values}
                        language={language}
                        key={identity}
                        embedded={platforms[platform]}
                        device={device}
                        title={boot.title || "站点预览"}
                        address="https://example.com/#/login"
                        copy={async () => {}}
                        preview
                        onContinue={
                            policy === "prompt"
                                ? () => setContinued(identity)
                                : undefined
                        }
                    />
                )}
            </div>
        </section>
    );
}
