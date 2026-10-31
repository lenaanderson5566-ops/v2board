// @vitest-environment jsdom
import i18n from "../shared/i18n";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
vi.mock("../shared/api", () => ({ boot: { mode: "user", appleAccountEnabled: true, clientMirrors: { clash_windows: "https://mirror.example/clash.exe" }, legacyDownloads: { android: "https://mirror.example/app.apk" } } }));
vi.mock("../shared/ui", () => ({ Modal: ({children}: any) => <div role="dialog">{children}</div> }));
vi.mock("./AppleAccounts", () => ({ AccountList: () => <div>Account list loaded</div> }));
import { boot } from "../shared/api";
import { ClientDownload, mirrorDownload, safeDownloadUrl } from "./ClientDownload";
import { FastaiDownload } from "./FastaiDownload";
beforeEach(async () => { await i18n.changeLanguage("zh-CN"); boot.fastaiDownloads = undefined; });
afterEach(cleanup);
it("uses the universal Mac installer without requiring a chip selection",()=>{
 const old=boot.clientMirrors;
 boot.clientMirrors={"clash_macos:universal":"https://mirror.example/universal.dmg","clash_macos:arm64":"https://mirror.example/arm.dmg","clash_macos:x64":"https://mirror.example/intel.dmg"};
 try {
  render(<ClientDownload client="clash" device="macos" official="https://github.com/clash-verge-rev/clash-verge-rev/releases" close={()=>{}}/>);
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByRole("link",{name:/镜像下载/}).getAttribute("href")).toBe("https://mirror.example/universal.dmg");
 } finally {boot.clientMirrors=old;}
});
it("selects mirrors by both client and device and rejects unsafe URLs", () => {
 expect(mirrorDownload("clash", "windows")).toBe("https://mirror.example/clash.exe");
 expect(mirrorDownload("hiddify", "android")).toBe("https://mirror.example/app.apk");
 expect(mirrorDownload("singbox", "android")).toBeUndefined();
 expect(mirrorDownload("clash", "macos")).toBeUndefined();
 for (const value of ["javascript:alert(1)", "data:text/html,x", "https://user:pass@example.com", "invalid"]) expect(safeDownloadUrl(value)).toBeUndefined();
});
it("offers official and configured mirror links in a dialog", () => {
 render(<ClientDownload client="clash" device="windows" official="https://github.com/clash-verge-rev/clash-verge-rev/releases" close={() => {}} />);
 expect(screen.getAllByRole("link")).toHaveLength(2);
 expect(screen.getByRole("link", {name: /镜像下载/}).getAttribute("href")).toBe("https://mirror.example/clash.exe");
});
it("disables missing mirror without linking another client", () => {
 render(<ClientDownload client="singbox" device="android" official="https://sing-box.sagernet.org/clients/" close={() => {}} />);
 expect(screen.getAllByRole("link")).toHaveLength(1);
 expect((screen.getByRole("button", {name: /镜像下载/}) as HTMLButtonElement).disabled).toBe(true);
});

it("shows iOS guidance and loads accounts only on request without a nested modal", () => {
 render(<ClientDownload client="shadowrocket" device="ios" official="https://apps.apple.com/app/id932747118" close={() => {}} />);
 expect(screen.queryByText("Account list loaded")).toBeNull();
 expect(screen.queryByRole("button", {name: /镜像下载/})).toBeNull();
 fireEvent.click(screen.getByRole("button", {name: /使用下载账户/}));
 expect(screen.getByText("Account list loaded")).toBeTruthy();
 expect(screen.getByText(/请勿退出或登录 iCloud/)).toBeTruthy();
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
 const trigger = screen.getByRole("button", {name:/使用下载账户/});
 expect(trigger.getAttribute("aria-expanded")).toBe("true");
 expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toBeTruthy();
 expect(screen.getByText(/如提示付款或额外验证/).closest("details")).toBeNull();
 fireEvent.click(trigger);
 expect(screen.queryByText("Account list loaded")).toBeNull();
 expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
it("keeps official download available when account sharing is disabled", () => {
 boot.appleAccountEnabled = false;
 render(<ClientDownload client="shadowrocket" device="ios" official="https://apps.apple.com/app/id932747118" close={() => {}} />);
 expect(screen.getByRole("link", {name: /官方下载/})).toBeTruthy();
 expect(screen.queryByRole("button", {name: /使用下载账户/})).toBeNull();
 boot.appleAccountEnabled = true;
});

it("requires architecture selection and serves the matching mirror",()=>{
 const old=boot.clientMirrors;
 boot.clientMirrors={"clash_macos:arm64":"https://mirror.example/arm.dmg","clash_macos:x64":"https://mirror.example/intel.dmg"};
 try {
 render(<ClientDownload client="clash" device="macos" official="https://github.com/clash-verge-rev/clash-verge-rev/releases" close={()=>{}}/>);
 expect(screen.queryByRole("link",{name:/镜像下载/})).toBeNull();
 fireEvent.change(screen.getByRole("combobox"),{target:{value:"arm64"}});
 expect(screen.getByRole("link",{name:/镜像下载/}).getAttribute("href")).toBe("https://mirror.example/arm.dmg");
 fireEvent.change(screen.getByRole("combobox"),{target:{value:"x64"}});
 expect(screen.getByRole("link",{name:/镜像下载/}).getAttribute("href")).toBe("https://mirror.example/intel.dmg");
 } finally {boot.clientMirrors=old;}
});

it.each(["invalid", "javascript:alert(1)", "https://user:pass@example.com"])("keeps the mirror and return action usable for an invalid official URL: %s", (official) => {
    const close = vi.fn();
    render(<ClientDownload client="clash" device="windows" official={official} close={close} />);
    expect(screen.queryByRole("link", { name: /官方下载/ })).toBeNull();
    expect(screen.getByRole("link", { name: /镜像下载/ }).getAttribute("href")).toBe("https://mirror.example/clash.exe");
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("continueImport", { ns: "clientDownload" }) }));
    expect(close).toHaveBeenCalledTimes(1);
});
const fastaiText = (key: string, fallback: string) => i18n.t(key, {ns:"fastaiDownload",defaultValue:fallback});
const dedicated = (platform: string, architecture: string, url: string) => ({
    platform, architecture, downloadUrl: url, latestVersion:"1.2.3",latestBuild:123,
    minimumVersion:"1.0.0",channel:"stable",sha256:"a".repeat(64),publishedAt:"2030-01-01T00:00:00Z",
}) as any;
it("requires an explicit chip choice for multiple FastAI builds and offers one matching download", () => {
    boot.fastaiDownloads=[dedicated("macos","arm64","https://download.example/apple.dmg"), dedicated("macos","x64","https://download.example/intel.dmg")];
    render(<FastaiDownload />);
    fireEvent.change(screen.getByRole("combobox",{name:/选择系统/}),{target:{value:"macos"}});
    const selector=screen.getByRole("combobox",{name:fastaiText("architecture","Device chip")});
    expect((selector as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("option",{name:fastaiText("architectureApple","Apple Silicon (M1 or later, arm64)")})).toBeTruthy();
    expect(screen.getByRole("option",{name:fastaiText("architectureIntelMac","Intel Mac (x64)")})).toBeTruthy();
    expect(screen.queryByRole("link",{name:/下载 FastAI/})).toBeNull();
    expect((screen.getByRole("button",{name:"下载 FastAI"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(selector,{target:{value:"x64"}});
    expect(screen.getAllByRole("link",{name:/下载 FastAI/})).toHaveLength(1);
    expect(screen.getByRole("link",{name:/下载 FastAI/}).getAttribute("href")).toBe("https://download.example/intel.dmg");
});
it("does not carry a chip selection to another platform", () => {
    boot.fastaiDownloads=[dedicated("macos","arm64","https://download.example/apple.dmg"), dedicated("macos","x64","https://download.example/intel.dmg"),dedicated("windows","arm64","https://download.example/windows-arm.exe"),dedicated("windows","x64","https://download.example/windows-x64.exe")];
    render(<FastaiDownload />);
    const system=screen.getByRole("combobox",{name:/选择系统/});
    fireEvent.change(system,{target:{value:"macos"}});
    fireEvent.change(screen.getByRole("combobox",{name:fastaiText("architecture","Device chip")}),{target:{value:"x64"}});
    fireEvent.change(system,{target:{value:"windows"}});
    expect((screen.getByRole("combobox",{name:fastaiText("architecture","Device chip")}) as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("link",{name:/下载 FastAI/})).toBeNull();
});
it("prefers a configured universal FastAI installer without asking users to guess a chip", () => {
    boot.fastaiDownloads=[dedicated("macos","arm64","https://download.example/apple.dmg"),dedicated("macos","universal","https://download.example/universal.dmg")];
    render(<FastaiDownload />);
    fireEvent.change(screen.getByRole("combobox",{name:/选择系统/}),{target:{value:"macos"}});
    expect(screen.queryByRole("combobox",{name:fastaiText("architecture","Device chip")})).toBeNull();
    expect(screen.getByText(fastaiText("architectureUniversal","Universal installer"))).toBeTruthy();
    expect(screen.getByRole("link",{name:/下载 FastAI/}).getAttribute("href")).toBe("https://download.example/universal.dmg");
});
it("shows the chip requirement for a sole FastAI build and rejects unsafe release URLs", () => {
    boot.fastaiDownloads=[dedicated("windows","x64","https://download.example/windows.exe"),dedicated("windows","arm64","javascript:alert(1)")];
    render(<FastaiDownload />);
    fireEvent.change(screen.getByRole("combobox",{name:/选择系统/}),{target:{value:"windows"}});
    expect(screen.getByText(fastaiText("architectureX64","Intel / AMD 64-bit (x64)"))).toBeTruthy();
    expect(screen.getAllByRole("link",{name:/下载 FastAI/})).toHaveLength(1);
    expect(screen.getByRole("link",{name:/下载 FastAI/}).getAttribute("href")).toBe("https://download.example/windows.exe");
});
