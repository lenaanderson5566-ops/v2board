import { useState } from "react";
import { request, date, type Row } from "./api";
import { tx } from "./i18n";
import { Panel, State, Table, useData } from "./ui";
export function AccountSessions() {
    const sessions = useData<Row[]>("user/getActiveSession");
    const [error, setError] = useState("");
    const [removing, setRemoving] = useState<string | null>(null);
    return (
        <section className="subscription-security">
            {error && (
                <p role="alert" className="alert">
                    {error}
                </p>
            )}
            <Panel title={tx("活跃会话")}>
                <State {...sessions}>
                    <Table
                        data={Object.entries(sessions.data || {}).map(
                            ([id, value]) => ({ ...value, id }),
                        )}
                        columns={[
                            ["ip", tx("IP 地址")],
                            ["ua", tx("客户端")],
                            [
                                "login_at",
                                tx("登录时间"),
                                (r) => date(r.login_at),
                            ],
                        ]}
                        actions={(r) => (
                            <button
                                disabled={removing !== null}
                                onClick={async () => {
                                    setRemoving(String(r.id));
                                    setError("");
                                    try {
                                        await request(
                                            "user/removeActiveSession",
                                            { session_id: r.id },
                                        );
                                        sessions.reload();
                                    } catch (e) {
                                        setError((e as Error).message);
                                    } finally {
                                        setRemoving(null);
                                    }
                                }}
                            >
                                {tx("移除")}
                            </button>
                        )}
                    />
                </State>
            </Panel>
        </section>
    );
}
