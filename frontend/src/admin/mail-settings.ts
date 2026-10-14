import type { Field } from "../shared/ui";
export const mailProviders: Record<string,string> = {smtp:"SMTP",mailgun:"Mailgun API",ses:"Amazon SES API",resend:"Resend API"};
const credentials: Record<string,string> = {email_password:"email_smtp_key_configured",email_mailgun_api_key:"email_mailgun_key_configured",email_resend_api_key:"email_resend_key_configured",email_ses_access_key:"email_ses_key_configured",email_ses_secret_key:"email_ses_key_configured"};
export function mailCredentialField(field: Field, saved: Record<string,unknown>): Field {
    const bulk=field.key.startsWith("email_announcement_");
    const base=bulk ? field.key.replace("email_announcement_","email_") : field.key;
    const baseFlag=credentials[base] || (base.endsWith("_webhook_key") ? base+"_configured" : undefined);
    const flag=bulk ? baseFlag?.replace("email_","email_announcement_") : baseFlag;
    if (!flag) return field;
    const configured=Boolean(saved[flag]);
    return {...field, placeholder: configured ? "********（已设置，留空保留）" : "未设置，请填写",
        hint: `${configured ? "******** · 已设置。输入新值后保存可替换；留空保留已有凭据。" : "尚未设置。"} ${field.hint || ""}`};
}
