// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {AdminBrowserPreview} from "./AdminBrowserPreview";
import {deviceContext} from "../shared/user-experience";
import {browserPolicy} from "../shared/browser-access";
vi.mock("../shared/api", () => ({boot:{title:"Preview"}}));
vi.mock("../shared/i18n", () => ({tx:(key:string)=>key}));
vi.mock("../shared/experience-copy", () => ({e:(key:string)=>key}));
vi.mock("react-i18next", () => ({useTranslation:()=>({})}));
afterEach(cleanup);
it("previews draft policies without clipboard or navigation side effects", () => {
 const copy=vi.fn();Object.defineProperty(navigator,"clipboard",{value:{writeText:copy},configurable:true});
 const view=render(<AdminBrowserPreview values={{browser_policy_wechat:"prompt"}}/>);
 fireEvent.click(screen.getByText("copyAddress"));
 expect(copy).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("browserContinue"));
 expect(screen.getByText(/用户可以进入网站/)).toBeTruthy();
 view.rerender(<AdminBrowserPreview values={{browser_policy_wechat:"guide"}}/>);
 expect(screen.queryByText("browserContinue")).toBeNull();
 expect(screen.getByText("browserTitle")).toBeTruthy();
});
it.each([["XiaoHongShu","xiaohongshu"],["Aweme","douyin"],["BiliApp","bilibili"],["AlipayClient","alipay"],["DingTalk","dingtalk"],["MicroMessenger wxwork","wecom"]])("recognizes %s and honors configured policy", (ua,key)=>{
 expect(deviceContext(ua).embedded).toBe(key);
 expect(browserPolicy(key)).toBe("allow");
 expect(browserPolicy(key,{[key]:"guide"})).toBe("guide");
});
it("does not treat standalone QQBrowser as QQ in-app",()=>expect(deviceContext("Mozilla QQBrowser/12.0").embedded).toBeNull());
