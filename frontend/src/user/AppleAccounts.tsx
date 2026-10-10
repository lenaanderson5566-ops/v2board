import { StatusBadge } from "../shared/StatusBadge";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n, { tx } from "../shared/i18n";
import { request, date } from "../shared/api";
import { Modal } from "../shared/ui";

const labels = {
    "zh-CN": ["获取下载账号", "仅用于 App Store 下载，请勿登录 iCloud 或系统设置。", "正在获取…", "账号暂不可用，请稍后重试。需要有效订阅或剩余额度。", "暂无可用账号", "重试", "复制账号", "复制密码", "显示密码", "隐藏密码", "已复制", "复制失败，请手动复制", "最近检查"],
    "zh-TW": ["取得下載帳號", "僅供 App Store 下載，請勿登入 iCloud 或系統設定。", "正在取得…", "帳號暫不可用，請稍後重試。需要有效訂閱或剩餘額度。", "暫無可用帳號", "重試", "複製帳號", "複製密碼", "顯示密碼", "隱藏密碼", "已複製", "複製失敗，請手動複製", "最近檢查"],
    "en-US": ["Get download account", "For App Store downloads only. Do not sign in to iCloud or device settings.", "Loading…", "Account unavailable. Try again later. An active subscription or remaining credits are required.", "No accounts available", "Retry", "Copy account", "Copy password", "Show password", "Hide password", "Copied", "Copy failed. Please copy manually.", "Last checked"],
    "ja-JP": ["ダウンロード用アカウント", "App Store のダウンロード専用です。iCloud や端末設定にはサインインしないでください。", "読み込み中…", "利用できません。有効な購読または残高を確認し、後で再試行してください。", "利用可能なアカウントがありません", "再試行", "アカウントをコピー", "パスワードをコピー", "パスワードを表示", "パスワードを隠す", "コピーしました", "コピーできません。手動でコピーしてください。", "最終確認"],
    "ko-KR": ["다운로드 계정 받기", "App Store 다운로드 전용입니다. iCloud나 기기 설정에 로그인하지 마세요.", "불러오는 중…", "계정을 사용할 수 없습니다. 유효한 구독 또는 잔여 크레딧을 확인하고 다시 시도하세요.", "사용 가능한 계정 없음", "재시도", "계정 복사", "비밀번호 복사", "비밀번호 표시", "비밀번호 숨기기", "복사됨", "복사 실패. 직접 복사해 주세요.", "마지막 확인"],
    "vi-VN": ["Lấy tài khoản tải ứng dụng", "Chỉ dùng tải ứng dụng trên App Store. Không đăng nhập iCloud hoặc cài đặt thiết bị.", "Đang tải…", "Tài khoản chưa khả dụng. Cần gói còn hiệu lực hoặc dung lượng còn lại. Hãy thử lại sau.", "Chưa có tài khoản", "Thử lại", "Sao chép tài khoản", "Sao chép mật khẩu", "Hiện mật khẩu", "Ẩn mật khẩu", "Đã sao chép", "Không thể sao chép. Hãy sao chép thủ công.", "Kiểm tra gần nhất"],
    "ru-RU": ["Аккаунт для загрузки", "Только для загрузок из App Store. Не входите в iCloud или настройки устройства.", "Загрузка…", "Аккаунт недоступен. Нужна активная подписка или остаток трафика. Повторите позже.", "Нет доступных аккаунтов", "Повторить", "Копировать аккаунт", "Копировать пароль", "Показать пароль", "Скрыть пароль", "Скопировано", "Не удалось скопировать. Скопируйте вручную.", "Последняя проверка"],
    "fa-IR": ["دریافت حساب دانلود", "فقط برای دانلود از App Store. وارد iCloud یا تنظیمات دستگاه نشوید.", "در حال دریافت…", "حساب در دسترس نیست. اشتراک فعال یا اعتبار باقی‌مانده لازم است. بعداً تلاش کنید.", "حسابی موجود نیست", "تلاش مجدد", "کپی حساب", "کپی رمز", "نمایش رمز", "پنهان کردن رمز", "کپی شد", "کپی نشد؛ دستی کپی کنید.", "آخرین بررسی"],
};
Object.entries(labels).forEach(([language, values]) => i18n.addResourceBundle(language, "appleAccount", Object.fromEntries(values.map((value, i) => [String(i), value]))));
type Account = { username: string; password?: string; available?: boolean; status?: string; region_display?: string; last_check?: string | number };

export function AppleAccounts() {
    const { t } = useTranslation("appleAccount");
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>{t("0")}</button>{open && <Modal title={t("0")} close={() => setOpen(false)}><AccountList /></Modal>}</>;
}

export function AccountList() {
    const { t } = useTranslation("appleAccount");
    const [attempt, setAttempt] = useState(0);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState(false);
    const [visible, setVisible] = useState<Record<number, boolean>>({});
    const [feedback, setFeedback] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        const deadline = window.setTimeout(() => controller.abort(), 20000);
        let active = true;
        setBusy(true); setError(false); setAccounts([]); setVisible({});
        request<Account[]>("user/apple-account", undefined, { signal: controller.signal })
            .then(result => { if (active) setAccounts(result.data); })
            .catch(() => { if (active) setError(true); })
            .finally(() => { window.clearTimeout(deadline); if (active) setBusy(false); });
        return () => { active = false; window.clearTimeout(deadline); controller.abort(); };
    }, [attempt]);
    async function copy(value: string) {
        try { await navigator.clipboard.writeText(value); setFeedback("10"); }
        catch { setFeedback("11"); }
    }
    return <div className="pad">
        <p>{t("1")}</p>
        {busy ? <p role="status">{t("2")}</p> : error ? <p role="alert">{t("3")}</p> : accounts.length === 0 ? <p>{t("4")}</p> : accounts.map((account, index) => <section key={index} className="apple-account-card">
            <div className="apple-account-heading"><strong>{account.region_display || "App Store"}</strong><StatusBadge tone={account.available ? "success" : account.status === "disabled" ? "neutral" : "warning"}>{tx(account.available ? "正常" : account.status === "disabled" ? "已停用" : "暂不可用")}</StatusBadge></div>
            <p dir="ltr">{account.username}</p>
            <p className="apple-account-password" dir="ltr">{account.available && (visible[index] ? account.password : "••••••••")}</p>
            {account.available && account.password && <div className="quick-actions"><button onClick={() => copy(account.username)}>{t("6")}</button><button onClick={() => copy(account.password!)}>{t("7")}</button><button onClick={() => setVisible(previous => ({ ...previous, [index]: !previous[index] }))}>{t(visible[index] ? "9" : "8")}</button></div>}
            {account.last_check && <p className="muted">{t("12")}: {typeof account.last_check === 'number' ? date(account.last_check) : account.last_check}</p>}
        </section>)}
        {!busy && (error || accounts.length === 0) && <button onClick={() => setAttempt(value => value + 1)}>{t("5")}</button>}
        <p role="status">{feedback && t(feedback)}</p>
    </div>;
}
