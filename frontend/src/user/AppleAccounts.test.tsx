// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../shared/api", () => ({ request: mocks.request }));
vi.mock("../shared/i18n", () => ({ default: { addResourceBundle: vi.fn() }, tx: (s: string) => s }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../shared/ui", () => ({ Modal: ({ children, close }: any) => <div><button onClick={close}>close</button>{children}</div> }));
import { AppleAccounts } from "./AppleAccounts";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("loads only on demand, hides password, and clears credentials on close", async () => {
    mocks.request.mockResolvedValue({ data: [{ username: "test-account", password: "secret-value", available: true }] });
    render(<AppleAccounts />);
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("0"));
    await screen.findByText("test-account");
    expect(screen.queryByText("secret-value")).toBeNull();
    fireEvent.click(screen.getByText("8"));
    expect(screen.getByText("secret-value")).toBeTruthy();
    fireEvent.click(screen.getByText("close"));
    expect(screen.queryByText("secret-value")).toBeNull();
});
it("recovers from upstream failure with a manual retry", async () => {
    mocks.request.mockRejectedValueOnce(new Error("private error")).mockResolvedValueOnce({ data: [] });
    render(<AppleAccounts />);
    fireEvent.click(screen.getByText("0"));
    await screen.findByRole("alert");
    expect(screen.queryByText("private error")).toBeNull();
    fireEvent.click(screen.getByText("5"));
    await screen.findByText("4");
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
});
it("shows an unavailable account without password actions", async () => {
    mocks.request.mockResolvedValue({ data: [{ username: "unavailable-account", available: false, status: "disabled" }] });
    render(<AppleAccounts />);
    fireEvent.click(screen.getByText("0"));
    await screen.findByText("unavailable-account");
    expect(screen.queryByText("7")).toBeNull();
    expect(screen.queryByText("8")).toBeNull();
});
it("respects download-account rate limits and waits for an explicit retry",async()=>{
 vi.useFakeTimers();
 try {
  mocks.request.mockRejectedValueOnce(Object.assign(new Error("Private provider detail"),{status:429,retryAfter:2})).mockResolvedValueOnce({data:[]});
  render(<AppleAccounts/>);fireEvent.click(screen.getByText("0"));
  await act(async()=>{await Promise.resolve();});
  const retry=screen.getByRole("button",{name:"retryIn"});
  expect((retry as HTMLButtonElement).disabled).toBe(true);fireEvent.click(retry);
  expect(mocks.request).toHaveBeenCalledTimes(1);expect(screen.queryByText("Private provider detail")).toBeNull();
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(mocks.request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"5"}));
  await act(async()=>{await Promise.resolve();});
  expect(mocks.request).toHaveBeenCalledTimes(2);expect(screen.getByText("4")).toBeTruthy();
 }finally {vi.useRealTimers();}
});
it("distinguishes entitlement failures and links to plans and credits",async()=>{
 mocks.request.mockRejectedValueOnce(Object.assign(new Error("Private entitlement detail"),{status:403,code:"FORBIDDEN"}));
 render(<AppleAccounts/>);fireEvent.click(screen.getByText("0"));
 await screen.findByRole("alert");
 expect(screen.getByText("eligibility")).toBeTruthy();
 expect(screen.getByRole("link",{name:"选择套餐"}).getAttribute("href")).toBe("#/plan");
 expect(screen.getByRole("link",{name:"buy"}).getAttribute("href")).toBe("#/traffic");
 expect(screen.queryByText("Private entitlement detail")).toBeNull();
});
it("retains only the rate-limit deadline when an account panel is reopened",async()=>{
 vi.useFakeTimers();
 try {
  mocks.request.mockRejectedValueOnce(Object.assign(new Error("Limited"),{status:429,retryAfter:2})).mockResolvedValueOnce({data:[]});
  render(<AppleAccounts/>);fireEvent.click(screen.getByText("0"));
  await act(async()=>{await Promise.resolve();});
  fireEvent.click(screen.getByRole("button",{name:"close"}));
  fireEvent.click(screen.getByText("0"));
  await act(async()=>{await Promise.resolve();});
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("button",{name:"retryIn"}) as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(mocks.request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"5"}));
  await act(async()=>{await Promise.resolve();});
  expect(mocks.request).toHaveBeenCalledTimes(2);
 }finally {vi.useRealTimers();}
});
