import i18n from "./i18n";
const rows = {
    showPassword: [
        "显示密码",
        "顯示密碼",
        "Show password",
        "パスワードを表示",
        "비밀번호 표시",
        "Hiện mật khẩu",
        "Показать пароль",
        "نمایش رمز عبور",
    ],
    hidePassword: [
        "隐藏密码",
        "隱藏密碼",
        "Hide password",
        "パスワードを隠す",
        "비밀번호 숨기기",
        "Ẩn mật khẩu",
        "Скрыть пароль",
        "پنهان کردن رمز عبور",
    ],
    saved: [
        "已保存",
        "已儲存",
        "Saved",
        "保存しました",
        "저장됨",
        "Đã lưu",
        "Сохранено",
        "ذخیره شد",
    ],
    noOptions: [
        "暂无可选内容",
        "暫無可選內容",
        "No options available",
        "選択肢がありません",
        "선택 가능한 항목 없음",
        "Chưa có lựa chọn",
        "Нет доступных вариантов",
        "گزینه‌ای موجود نیست",
    ],
    clear: [
        "清空选择",
        "清空選擇",
        "Clear selection",
        "選択を解除",
        "선택 지우기",
        "Bỏ chọn",
        "Снять выбор",
        "پاک کردن انتخاب",
    ],
    selected: [
        "已选择 {{count}} 项",
        "已選擇 {{count}} 項",
        "Selected: {{count}}",
        "{{count}} 件選択中",
        "{{count}}개 선택됨",
        "Đã chọn: {{count}}",
        "Выбрано: {{count}}",
        "انتخاب‌شده: {{count}}",
    ],
} as const;
const codes = [
    "zh-CN",
    "zh-TW",
    "en-US",
    "ja-JP",
    "ko-KR",
    "vi-VN",
    "ru-RU",
    "fa-IR",
];
codes.forEach((code, index) =>
    i18n.addResourceBundle(
        code,
        "ux",
        Object.fromEntries(
            Object.entries(rows).map(([key, values]) => [key, values[index]]),
        ),
    ),
);
export const ux = (key: keyof typeof rows, values?: Record<string, unknown>) =>
    String(i18n.t(key, { ns: "ux", ...values }));
