@php
$copy = [
'zh-CN'=>['推广邮件偏好','退订推广邮件','验证码、账单和必要服务通知不受影响。','已退订推广邮件。'],
'zh-TW'=>['推廣郵件偏好','取消訂閱推廣郵件','驗證碼、帳單及必要服務通知不受影響。','已取消訂閱推廣郵件。'],
'en-US'=>['Marketing emails','Unsubscribe','Verification codes, billing and essential service notices are unaffected.','You have unsubscribed from marketing emails.'],
'ja-JP'=>['販促メール','配信を停止','認証コード、請求と重要な通知は引き続き届きます。','販促メールの配信を停止しました。'],
'ko-KR'=>['홍보 이메일','수신 거부','인증 코드, 결제 및 필수 서비스 알림은 계속 발송됩니다.','홍보 이메일 수신을 거부했습니다.'],
'vi-VN'=>['Email tiếp thị','Hủy đăng ký','Mã xác minh, hóa đơn và thông báo thiết yếu không bị ảnh hưởng.','Đã hủy nhận email tiếp thị.'],
'ru-RU'=>['Рекламная рассылка','Отписаться','Коды подтверждения, счета и важные уведомления не затронуты.','Вы отписались от рассылки.'],
'es-ES'=>['Correos promocionales','Cancelar suscripción','Los códigos de verificación, la facturación y los avisos esenciales no se ven afectados.','Has cancelado los correos promocionales.'],
'pt-BR'=>['E-mails promocionais','Cancelar assinatura','Códigos de verificação, cobrança e avisos essenciais não são afetados.','Você cancelou os e-mails promocionais.'],
'fr-FR'=>['E-mails promotionnels', 'Se désabonner', 'Les codes de vérification, la facturation et les notifications essentielles ne sont pas concernés.', 'Vous êtes désabonné des e-mails promotionnels.'],
'de-DE'=>['Marketing-E-Mails', 'Abbestellen', 'Bestätigungscodes, Abrechnung und notwendige Servicemitteilungen bleiben unverändert.', 'Sie haben die Marketing-E-Mails abbestellt.'],
'id-ID'=>['Email promosi', 'Berhenti berlangganan', 'Kode verifikasi, tagihan, dan pemberitahuan layanan penting tidak terpengaruh.', 'Anda telah berhenti menerima email promosi.'],
'th-TH'=>['อีเมลส่งเสริมการขาย', 'ยกเลิกการรับอีเมล', 'รหัสยืนยัน การเรียกเก็บเงิน และประกาศบริการที่จำเป็นจะไม่ได้รับผลกระทบ', 'คุณยกเลิกการรับอีเมลส่งเสริมการขายแล้ว'],
'fa-IR'=>['ایمیل‌های تبلیغاتی','لغو اشتراک','کدهای تأیید، صورتحساب و پیام‌های ضروری تغییری نمی‌کنند.','اشتراک تبلیغات لغو شد.']
][$language] ?? ['Marketing emails','Unsubscribe','Essential account emails are unaffected.','You have unsubscribed.'];
@endphp
<!doctype html><html lang="{{ $language }}" dir="{{ $language==='fa-IR' ? 'rtl' : 'ltr' }}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{ $copy[0] }}</title><style>body{margin:0;background:#f7f7f6;font:16px/1.7 system-ui;color:#202123;display:grid;min-height:100dvh;place-items:center}main{margin:24px;padding:32px;max-width:460px;background:white;border:1px solid #e8e8e6;border-radius:20px}button{border:0;border-radius:24px;background:#202123;color:white;padding:12px 24px;font:inherit;cursor:pointer}p{color:#626262}</style></head><body><main><h1>{{ $done ? $copy[3] : $copy[0] }}</h1><p>{{ $copy[2] }}</p>@unless($done)<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">{{ $copy[1] }}</button></form>@endunless</main></body></html>
