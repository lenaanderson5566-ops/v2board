import type { Row } from "../shared/api";
import { AccountMenu } from "./AccountMenu";
import { AnnouncementCenter } from "./AnnouncementCenter";

export default function WorkspaceHeaderControls({ user, logout }: {
    user: Row;
    logout: () => void;
}) {
    return <>
        <AnnouncementCenter />
        <AccountMenu user={user} logout={logout} />
    </>;
}
