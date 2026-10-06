import React, { type ReactNode } from "react";
import { Panel } from "./ui";
import { tx } from "./i18n";
export class ErrorBoundary extends React.Component<
    { children: ReactNode },
    { error: string }
> {
    state = { error: "" };
    static getDerivedStateFromError(e: Error) {
        return { error: e.message };
    }
    render() {
        return this.state.error ? (
            <Panel title={tx("页面暂时无法加载")}>
                <div className="pad">
                    <p>{this.state.error}</p>
                    <button onClick={() => location.reload()}>
                        {tx("重新加载")}
                    </button>
                </div>
            </Panel>
        ) : (
            this.props.children
        );
    }
}
