import { ArrowUpRight } from "lucide-react";
import { tx } from "./i18n";
import { campaignCopy as copy } from "./campaign-copy";
import invitationArt from "./assets/invite-friends.jpg";
import "./invite-campaign.css";

export function InviteCampaign() {
    return (
        <a
            className="invite-campaign"
            href="#/invite"
            aria-label={tx("邀请好友")}
        >
            <div className="invite-campaign-content">
                <div>
                    <strong>{tx("邀请好友")}</strong>
                    <p>{copy("intro")}</p>
                </div>
                <img
                    src={invitationArt}
                    alt=""
                    width="84"
                    height="56"
                    decoding="async"
                />
            </div>
            <span className="invite-campaign-action">
                {copy("send")}
                <ArrowUpRight size={15} aria-hidden="true" />
            </span>
        </a>
    );
}
