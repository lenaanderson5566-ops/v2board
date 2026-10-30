import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { currentDevice } from "../shared/user-experience";
import { e } from "../shared/experience-copy";
import { Modal } from "../shared/ui";
import { EmbeddedBrowserNotice } from "./EmbeddedBrowserNotice";
import "./browser-handoff-help.css";

export function BrowserHandoffHelp({ context, disabled = false }: {
    context: "payment" | "setup";
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    if (!currentDevice().embedded) return null;
    return <div className="browser-handoff-help">
        <button type="button" aria-haspopup="dialog" disabled={disabled}
            onClick={() => setOpen(true)}>
            <ExternalLink size={15} aria-hidden="true" />
            {e(context === "payment" ? "browserPaymentHelp" : "browserSetupHelp")}
        </button>
        {open && <Modal title={e("browserHelpTitle")} close={() => setOpen(false)} className="browser-help-modal">
            <div className="pad"><EmbeddedBrowserNotice compact /></div>
        </Modal>}
    </div>;
}
