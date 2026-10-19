import { useEffect, useState } from "react";
import { boot, type Row } from "../shared/api";
import { BrowserNoticeView } from "../shared/ui/BrowserNoticeView";
import { browserLabel } from "./browser-labels";
import { browserPolicy } from "../shared/browser-access";
import "./browser-preview.css";
const platforms = {wechat:"WeChat", qq:"QQ", weibo:"Weibo", xiaohongshu:"xiaohongshu", douyin:"douyin", bilibili:"bilibili", alipay:"alipay", dingtalk:"dingtalk", wecom:"wecom", other:"Other"};
export function AdminBrowserPreview({values}: {values: Row}) {
    const [platform, setPlatform] = useState<keyof typeof platforms>("wechat");
    const [device, setDevice] = useState("ios");
    const [continued, setContinued] = useState("");
    const policies = Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith("browser_policy_")).map(([key,value]) => [key.slice(15),value]));
    const policy = browserPolicy(platforms[platform], policies);
    const identity = `${platform}-${device}-${policy}`;
    useEffect(() => setContinued(""), [identity]);
    return <section className="pad browser-preview" aria-label="浏览器策略预览">
        <h3>浏览器策略预览</h3>
        <p className="muted">跟随当前表单设置，保存后对新加载的用户页面生效。按钮仅演示，不复制后台地址、不发送访问统计。UA 识别依赖应用版本，隐藏标识的应用可能无法识别。</p>
        <div className="browser-preview-controls">
            <label>预览平台<select value={platform} onChange={e => {setPlatform(e.target.value as keyof typeof platforms);setContinued("");}}>{Object.keys(platforms).map(key => <option key={key} value={key}>{browserLabel(key)}</option>)}</select></label>
            <label>预览设备<select value={device} onChange={e => {setDevice(e.target.value);setContinued("");}}><option value="ios">iOS</option><option value="android">Android</option><option value="windows">桌面</option></select></label>
            <button type="button" onClick={() => setContinued("")}>重新预览</button>
        </div>
        <p>当前策略：{policy === "allow" ? "允许访问" : policy === "prompt" ? "提示后允许访问" : "仅显示引导"}</p>
        <div className="browser-preview-frame" key={identity}>
            {policy === "allow" || (continued === identity && policy === "prompt") ? <div className="pad" role="status">用户可以进入网站。此处仅为页面入口示意。</div> : <BrowserNoticeView key={identity} embedded={platforms[platform]} device={device} title={boot.title || "站点预览"} address="https://example.com/#/login" copy={async () => {}} onContinue={policy === "prompt" ? () => setContinued(identity) : undefined} />}
        </div>
    </section>;
}
