import { lazy, Suspense } from "react";
import { ResourcePage } from "./admin";
import { resources } from "./admin-resources";

const OperationsDetails = lazy(() => import("./OperationsAnalytics").then(module => ({
    default: module.OperationsDetails,
})));

export default function AdminResourceRoute({ path }: { path: string }) {
    if (!Object.hasOwn(resources, path)) {
        return (
            <section className="panel pad">
                <h2>页面未找到</h2>
                <p className="muted">链接可能已变更，请从左侧导航选择功能。</p>
                <a href="#/overview">返回仪表盘</a>
            </section>
        );
    }
    return (
        <>
            <ResourcePage resource={resources[path]} />
            {path === "access-logs-subscriptions" && (
                <Suspense fallback={<p className="pad" role="status">正在加载页面…</p>}>
                    <OperationsDetails section="security" />
                </Suspense>
            )}
        </>
    );
}
