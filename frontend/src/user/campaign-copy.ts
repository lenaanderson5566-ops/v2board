import i18n, { languages } from "../shared/i18n";
const copy = {
    intro: [
        "分享给朋友",
        "分享給朋友",
        "Share your experience with friends.",
        "友だちと体験を共有。",
        "친구와 경험을 나누세요.",
        "Chia sẻ trải nghiệm với bạn bè.",
        "Поделитесь опытом с друзьями.",
        "تجربه‌تان را با دوستان به اشتراک بگذارید.",
    ],
    send: [
        "邮件邀请",
        "郵件邀請",
        "Invite by email",
        "メールで招待",
        "이메일로 초대",
        "Mời qua email",
        "Пригласить по почте",
        "دعوت با ایمیل",
    ],
};
languages.forEach((language, index) =>
    i18n.addResourceBundle(
        language.code,
        "campaign",
        Object.fromEntries(
            Object.entries(copy).map(([key, values]) => [key, values[index]]),
        ),
    ),
);
export const campaignCopy = (key: keyof typeof copy): string =>
    String(i18n.t(key, { ns: "campaign" }));
