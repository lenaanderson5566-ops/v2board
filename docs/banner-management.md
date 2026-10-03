# Banner 管理

后台入口：运营中台 → Banner 管理。

支持新建、编辑、预览、启停、删除；主图、手机专用图、可选跳转链接；用户首页与落地页位置；八种语言范围；排序及精确到分钟的上线/下线时间。语言不勾选表示全部语言。图片为 PNG/JPG/WebP，最大 5 MB、6000×6000；推荐主图 3:1。手机完整展示图片，不裁切文字。多张图片手动切换，每个位置最多 6 张，无自动轮播。

图片上传保存在 storage/app/banners，通过受限图片接口公开提供，文件名随机化，不需要 storage 软链接。PHP 的 upload_max_filesize、post_max_size 和反向代理请求体限制应满足 5 MB 上传。删除 Banner 保留图片文件，避免影响共享图片的其他 Banner。

更新：正常使用 update.sh 的备份及停止队列/调度器流程，脚本自动执行 database/migrations/2026_10_03_000002_create_banners.php。已存在表时迁移不重复预置或覆盖编辑。数据库尚未迁移时，前台隐藏 Banner，后台显示错误及重试入口。

## 预置图片

public/banners/fastdog-3-launch.png，2172×724。迁移首次创建 Fastdog 3.0 — Faster. Simpler. Smarter.，默认用户首页、全部语言、启用、无跳转链接；落地页由管理员勾选启用。新建时也可选择“使用 Fastdog 3.0 预置图片”。

使用内置 imagegen 工具生成，最终提示词：

> Create one finished premium website promotional banner image for Fastdog 3.0. Use case: ads-marketing, production website asset. Extra wide horizontal composition, approximately 3:1 aspect ratio (ideally 1536 by 512). Mature minimal technology product launch aesthetic, dark forest green and charcoal background, soft ivory typography, subtle sage highlights. Exact text on the left: 'Fastdog 3.0' on the first line, then 'Faster. Simpler. Smarter.' on the second line. These are the only words; no other labels, buttons, badges or watermarks. Typography must be crisp, large, correctly spelled and aligned, balanced negative space and generous safe margins. On the right: sophisticated abstract sculptural flowing ribbons, translucent rounded paths and a restrained warm accent expressing speed, simplicity and intelligence; elegant realistic 3D materials, soft studio lighting, refined not flashy. No third-party logos, no browser UI, no mascot, no rockets. Finished flat banner image, not a mockup of a banner in a device. Ensure text and artwork sit within the central safe area so the image can display whole on phones.
