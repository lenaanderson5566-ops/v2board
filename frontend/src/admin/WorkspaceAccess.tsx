import type { ReactNode } from "react";
import { Grid2X2 } from "lucide-react";
import "./workspace-access.css";

export function WorkspaceAccess({ children }: { children: ReactNode }) {
    return (
        <main className="workspace-access" lang="en-US" dir="ltr">
            <div className="workspace-access-shell">
                <div className="workspace-access-art" aria-hidden="true" />
                <div className="workspace-access-content">
                    <div className="workspace-access-mark" aria-hidden="true"><Grid2X2 size={21} /></div>
                    {children}
                </div>
            </div>
        </main>
    );
}
