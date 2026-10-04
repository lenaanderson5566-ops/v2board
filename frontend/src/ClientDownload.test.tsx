// @vitest-environment jsdom
import i18n from "./i18n";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
vi.mock("./api", () => ({ boot: { mode: "user", appleAccountEnabled: true, clientMirrors: { clash_windows: "https://mirror.example/clash.exe" }, legacyDownloads: { android: "https://mirror.example/app.apk" } } }));
vi.mock("./ui", () => ({ Modal: ({children}: any) => <div role="dialog">{children}</div> }));
vi.mock("./AppleAccounts", () => ({ AccountList: () => <div>Account list loaded</div> }));
import { boot } from "./api";
import { ClientDownload, mirrorDownload, safeDownloadUrl } from "./ClientDownload";
beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
afterEach(cleanup);
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
 fireEvent.click(screen.getByRole("button", {name: /使用下载账号/}));
 expect(screen.getByText("Account list loaded")).toBeTruthy();
 expect(screen.getByText(/请勿退出或登录 iCloud/)).toBeTruthy();
 expect(screen.getAllByRole("dialog")).toHaveLength(1);
});
it("keeps official download available when account sharing is disabled", () => {
 boot.appleAccountEnabled = false;
 render(<ClientDownload client="shadowrocket" device="ios" official="https://apps.apple.com/app/id932747118" close={() => {}} />);
 expect(screen.getByRole("link", {name: /官方下载/})).toBeTruthy();
 expect(screen.queryByRole("button", {name: /使用下载账号/})).toBeNull();
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
