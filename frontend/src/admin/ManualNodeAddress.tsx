import { useState, useEffect } from "react";
import { admin, query, request, type Row } from "../shared/api";
import { Editor, State, useData } from "../shared/ui";

export function ManualNodeAddress({
    node,
    onChanged,
    onDirty,
    onBusyChange,
    disabled = false,
}: {
    disabled?: boolean;
    node: Row;
    onChanged?: () => void;
    onDirty?: (value: boolean) => void;
    onBusyChange?: (value: boolean) => void;
}) {
    const data = useData<Row>(
        query(admin("server/connections/address"), {
            type: node.type,
            id: node.id,
        }),
        undefined,
        false,
        { refreshOnEvents: false },
    );
    const [dirty, setDirty] = useState(false),
        [busy, setBusy] = useState(false);
    useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
    useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
    return (
        <section className="admin-deployment-card">
            <h4>手动连接地址</h4>
            <State {...data} retry={data.reload}>
                {data.data?.values &&
                    (data.data.managed ? (
                        <p>此节点已启用域名管理，请重新载入域名设置后修改。</p>
                    ) : (
                        <>
                            <p className="muted">
                                此地址写入用户订阅；监听端口、TLS SNI
                                和证书在“服务配置”维护。保存连接地址不联动修改 DNS 或证书，请核对转发与证书后保存。
                            </p>
                            {data.data.serverName && (
                                <p>TLS SNI：{data.data.serverName}</p>
                            )}
                            <fieldset
                                disabled={disabled}
                                style={{ border: 0, padding: 0, margin: 0 }}
                            >
                                <Editor
                                    key={data.data.revision}
                                    fields={[
                                        {
                                            key: "host",
                                            label: "连接地址",
                                            required: true,
                                        },
                                        {
                                            key: "port",
                                            label: "连接端口",
                                            required: true,
                                            hint: "支持单端口；支持端口跳跃的协议可填写 443,8443 或 20000-30000。",
                                        },
                                    ]}
                                    initial={data.data.values}
                                    submit="保存连接地址"
                                    onDirty={() => setDirty(true)}
                                    onBusyChange={setBusy}
                                    onSave={async (values) => {
                                        if (
                                            !confirm(
                                                "确认更新用户订阅中的连接地址？请确保连接端口、转发及证书已就绪。",
                                            )
                                        )
                                            throw new Error(
                                                "已取消保存，修改仍保留在表单中。",
                                            );
                                        await request(
                                            admin("server/connections/address"),
                                            {
                                                type: node.type,
                                                id: node.id,
                                                revision: data.data!.revision,
                                                host: values.host,
                                                port: values.port,
                                                confirm: true,
                                            },
                                            { method: "PATCH" },
                                        );
                                        setDirty(false);
                                        data.reload();
                                        onChanged?.();
                                    }}
                                />
                                <div className="pad">
                                    <button
                                        disabled={busy}
                                        onClick={() => {
                                            if (
                                                dirty &&
                                                !confirm(
                                                    "重新载入将放弃尚未保存的连接地址，确认继续？",
                                                )
                                            )
                                                return;
                                            setDirty(false);
                                            data.reload();
                                        }}
                                    >
                                        重新载入连接地址
                                    </button>
                                </div>
                            </fieldset>
                        </>
                    ))}
            </State>
        </section>
    );
}
