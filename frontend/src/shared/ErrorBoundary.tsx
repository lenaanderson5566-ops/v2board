import React, { type ReactNode } from "react";
import { tx } from "./i18n";
// Startup recovery must not depend on rich-content parsers or form modules.
export class ErrorBoundary extends React.Component<
    { children: ReactNode; message?: string },
    { error: string }
> {
    state = { error: "" };
    static getDerivedStateFromError(e: Error) {
        return { error: e.message };
    }
    render() {
        return this.state.error ? (
            <section className="panel">
                <div className="panel-head">
                    <h2>{tx("页面暂时无法加载")}</h2>
                    <div className="actions" />
                </div>
                <div className="pad">
                    <p>{this.props.message || tx("无法完成操作，请刷新页面后重试。")}</p>
                    <button onClick={() => location.reload()}>
                        {tx("重新加载")}
                    </button>
                </div>
            </section>
        ) : (
            this.props.children
        );
    }
}
