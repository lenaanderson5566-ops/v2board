import {
    ArrowUpRight,
    Check,
    Sparkles,
    TicketPercent,
    MonitorSmartphone,
} from "lucide-react";

/** Decorative, theme-aware illustration; no remote assets or layout shifts. */
export function JourneyIllustration({
    kind = "start",
}: {
    kind?: "start" | "coupon";
}) {
    const Icon = kind === "coupon" ? TicketPercent : MonitorSmartphone;
    return (
        <div className={`journey-art journey-art-${kind}`} aria-hidden="true">
            <div className="journey-art-orbit" />
            <div className="journey-art-sheet">
                <Icon size={38} />
                <span />
                <span />
            </div>
            <span className="journey-art-seal">
                {kind === "coupon" ? (
                    <Sparkles size={20} />
                ) : (
                    <Check size={20} />
                )}
            </span>
            <span className="journey-art-arrow">
                <ArrowUpRight size={22} />
            </span>
        </div>
    );
}
