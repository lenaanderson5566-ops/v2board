import { useState } from "react";
import { admin, request } from "../shared/api";
import { Panel, State, useData } from "../shared/ui";
import type { V10AnalyticsConfiguration } from "../shared/v10-types";
import "./analytics.css";
export function AnalyticsCollectionSettings() {
    const data = useData<{
        settings: V10AnalyticsConfiguration;
        ready: boolean;
    }>(admin("analytics/settings"));
    return (
        <div className="analytics-page">
            <Panel padded title="访问统计 · 隐私与保留设置">
                <p>
                    第一方统计，数据存放在本站数据库。此处只控制自愿共享的访问与体验数据；业务订单和安全日志分别遵循各自的保留规则。
                </p>
                <State
                    loading={data.loading}
                    error={data.error}
                    retry={data.reload}
                >
                    {data.data && (
                        <>
                            {!data.data.ready && (
                                <p className="alert">
                                    访问统计表尚未安装，请先执行更新流程。
                                </p>
                            )}
                            <CollectionSettings
                                key={JSON.stringify(data.data.settings)}
                                settings={data.data.settings}
                                ready={data.data.ready}
                                saved={data.reload}
                            />
                        </>
                    )}
                </State>
                <a href="#/analytics">查看访问与转化报表</a>
            </Panel>
        </div>
    );
}
function CollectionSettings({
    settings,
    ready,
    saved,
}: {
    settings: V10AnalyticsConfiguration;
    ready: boolean;
    saved: () => void;
}) {
    const [enabled, setEnabled] = useState(settings.enabled);
    const [retentionDays, setRetention] = useState<number>(
        settings.retentionDays,
    );
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    return (
        <form
            onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                setBusy(true);
                setMessage("");
                try {
                    await request(admin("analytics/settings"), {
                        enabled,
                        retentionDays,
                    });
                    setMessage(
                        "统计设置已保存。已打开的用户页面将在重新加载后取得新设置；关闭后服务端立即停止入库。",
                    );
                    saved();
                } catch (error) {
                    setMessage(
                        error instanceof Error ? error.message : "保存失败",
                    );
                } finally {
                    setBusy(false);
                }
            }}
            className="analytics-settings"
        >
            <label>
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => setEnabled(event.target.checked)}
                    disabled={!ready || busy}
                />{" "}
                开启访问统计
            </label>
            <label>
                保留时间{" "}
                <select
                    value={retentionDays}
                    disabled={!ready || busy}
                    onChange={(event) =>
                        setRetention(Number(event.target.value))
                    }
                >
                    {[7, 30, 90].map((value) => (
                        <option key={value} value={value}>
                            {value} 天
                        </option>
                    ))}
                </select>
            </label>
            <button type="submit" className="primary" disabled={!ready || busy}>
                {busy ? "保存中…" : "保存设置"}
            </button>
            <p className="muted">
                默认关闭。开启后由用户自主允许或拒绝；尊重浏览器禁止追踪设置。仅记录页面标识、设备类别、语言、引导动作、性能数值、错误类别和短期随机会话，不记录
                IP、邮箱、完整
                UA、网址、表单或支付内容。缩短保留期会逐批清理旧统计，无法恢复。
            </p>
            {message && <p role="status">{message}</p>}
        </form>
    );
}
