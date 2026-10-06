import i18n, { languages } from "../shared/i18n";
const copy = {
    intro: [
        "查看登录邮箱，管理个人语言偏好与已连接的服务。",
        "查看登入信箱，管理個人語言偏好與已連結的服務。",
        "View your sign-in email and manage your language and connected services.",
        "ログインメール、言語設定、連携サービスを管理します。",
        "로그인 이메일, 언어 및 연결된 서비스를 관리하세요.",
        "Xem email đăng nhập, quản lý ngôn ngữ và dịch vụ đã kết nối.",
        "Просматривайте почту для входа, управляйте языком и подключёнными сервисами.",
        "ایمیل ورود، زبان و سرویس‌های متصل را مدیریت کنید.",
    ],
    emailHelp: [
        "用于登录和接收账户邮件。",
        "用於登入及接收帳戶郵件。",
        "Used to sign in and receive account emails.",
        "ログインとアカウントメールの受信に使用します。",
        "로그인 및 계정 이메일 수신에 사용됩니다.",
        "Dùng để đăng nhập và nhận email tài khoản.",
        "Для входа и получения писем об аккаунте.",
        "برای ورود و دریافت ایمیل‌های حساب استفاده می‌شود.",
    ],
    languageHelp: [
        "自动保存到账户，登录其他设备时同步；账户邮件优先使用此语言。",
        "自動儲存至帳戶，登入其他裝置時同步；帳戶郵件優先使用此語言。",
        "Saved to your account and applied on sign-in across devices. Account emails prefer this language.",
        "アカウントに保存し、他の端末でのログイン時にも適用します。メールもこの言語を優先します。",
        "계정에 저장되어 다른 기기 로그인 시 적용됩니다. 계정 이메일도 이 언어를 우선 사용합니다.",
        "Lưu vào tài khoản và áp dụng khi đăng nhập trên thiết bị khác. Email tài khoản ưu tiên ngôn ngữ này.",
        "Сохраняется в аккаунте и применяется при входе на других устройствах. Письма используют этот язык в первую очередь.",
        "در حساب ذخیره و هنگام ورود در دستگاه‌های دیگر اعمال می‌شود. ایمیل‌های حساب نیز این زبان را ترجیح می‌دهند.",
    ],
};
languages.forEach((language, index) =>
    i18n.addResourceBundle(
        language.code,
        "profile",
        Object.fromEntries(
            Object.entries(copy).map(([key, values]) => [key, values[index]]),
        ),
    ),
);
export const p = (key: keyof typeof copy): string =>
    String(i18n.t(key, { ns: "profile" }));
