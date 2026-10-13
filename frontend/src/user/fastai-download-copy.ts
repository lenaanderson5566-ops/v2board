import i18n from "../shared/i18n";
const copy = {
    title: [
        "专用客户端",
        "專用用戶端",
        "Dedicated client",
        "専用クライアント",
        "전용 클라이언트",
        "Ứng dụng chuyên dụng",
        "Клиент сервиса",
        "برنامه اختصاصی",
    ],
    guide: [
        "下载安装后，使用本站账号登录即可同步订阅，无需复制订阅链接。",
        "下載安裝後，使用本站帳號登入即可同步訂閱，無需複製訂閱連結。",
        "Install and sign in with your site account to sync your subscription. No subscription link is needed.",
        "インストール後、サイトのアカウントでログインするとサブスクリプションが同期されます。リンクのコピーは不要です。",
        "설치 후 사이트 계정으로 로그인하면 구독이 동기화됩니다. 구독 링크를 복사할 필요가 없습니다.",
        "Cài đặt và đăng nhập bằng tài khoản trang web để đồng bộ gói dịch vụ, không cần sao chép liên kết.",
        "Установите приложение и войдите в аккаунт сайта для синхронизации подписки. Копировать ссылку не нужно.",
        "پس از نصب، با حساب سایت وارد شوید تا اشتراک همگام شود؛ نیازی به کپی پیوند اشتراک نیست.",
    ],
    unavailable: [
        "当前系统暂无专用安装包，可选择其他系统或使用兼容客户端。",
        "目前系統暫無專用安裝包，可選擇其他系統或使用相容用戶端。",
        "No dedicated installer is available for this system. Choose another system or a compatible client.",
        "このOS向けの専用インストーラーはありません。別のOSまたは互換クライアントを選択してください。",
        "이 운영체제용 설치 파일이 없습니다. 다른 운영체제나 호환 클라이언트를 선택하세요.",
        "Chưa có bộ cài riêng cho hệ thống này. Chọn hệ thống khác hoặc ứng dụng tương thích.",
        "Для этой ОС нет установщика. Выберите другую ОС или совместимый клиент.",
        "نصب‌کننده‌ای برای این سیستم موجود نیست. سیستم دیگری یا برنامه سازگار را انتخاب کنید.",
    ],
    requirement: [
        "请选择适合设备的架构；连接服务需要有效套餐或可用流量。",
        "請選擇適合裝置的架構；連線服務需要有效套餐或可用流量。",
        "Choose your device architecture. Connecting requires an active plan or available data allowance.",
        "端末に合うアーキテクチャを選択してください。接続には有効なプランまたは利用可能な通信量が必要です。",
        "기기에 맞는 아키텍처를 선택하세요. 연결하려면 유효한 요금제 또는 사용 가능한 데이터가 필요합니다.",
        "Chọn kiến trúc phù hợp thiết bị. Kết nối cần gói còn hiệu lực hoặc lưu lượng khả dụng.",
        "Выберите архитектуру устройства. Для подключения нужен активный тариф или доступный трафик.",
        "معماری مناسب دستگاه را انتخاب کنید. اتصال به طرح فعال یا حجم قابل استفاده نیاز دارد.",
    ],
};
[
    "zh-CN",
    "zh-TW",
    "en-US",
    "ja-JP",
    "ko-KR",
    "vi-VN",
    "ru-RU",
    "fa-IR",
].forEach((code, index) =>
    i18n.addResourceBundle(
        code,
        "fastaiDownload",
        Object.fromEntries(
            Object.entries(copy).map(([key, values]) => [key, values[index]]),
        ),
    ),
);
