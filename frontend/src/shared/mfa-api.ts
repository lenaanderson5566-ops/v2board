import { admin, boot, request } from "./api";
import type { V10MfaChallenge, V10MfaState } from "./v10-types";

export function mfaState() {
    return boot.mode === "admin" ? admin("security/mfa") : "user/security/mfa";
}
export function mfaStart() {
    return boot.mode === "admin"
        ? admin("security/mfa/challenges")
        : "user/security/mfa/challenges";
}
export function mfaEmail() {
    return "passport/mfa/emails";
}
export function mfaFinish() {
    return "passport/mfa/verifications";
}
export type { V10MfaChallenge, V10MfaState };
export async function sendMfaEmail(challengeId: string) {
    await request(mfaEmail(), { challengeId });
}
