import { type ReactNode, useEffect, useState } from "react";
import { admin, query, request, type Row } from "../shared/api";
import { Editor, Modal, State, useData } from "../shared/ui";
import { defaultLineFields, nodeLineFields } from "./node-line-fields";
import { useNodeCatalog } from "./node-dictionary";

export function DefaultNodeLineEditor({
    node,
    groups,
    close,
    onSaved,
    navigation,
}: {
    navigation?: (busy: boolean, dirty: boolean) => ReactNode;
    node: Row;
    groups: Row[];
    close: () => void;
    onSaved: () => void;
}) {
    const data = useData<Row>(
        query(admin("server/connections/default"), {
            type: node.type,
            id: node.id,
        }),
        undefined,
        false,
        { refreshOnEvents: false },
    );
    const [dirty, setDirty] = useState(false),
        [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);
    const catalog = useNodeCatalog();
    const fields = nodeLineFields(groups, catalog);
    return (
        <Modal
            variant="drawer"
            wide
            className="node-editor-dialog"
            title={`编辑节点 · ${node.name}`}
            dismissible={!busy}
            close={() => {
                if (
                    !busy &&
                    (!dirty || confirm("默认线路尚未保存，确认放弃修改？"))
                )
                    close();
            }}
        >
            {navigation?.(busy, dirty)}
            <State {...data} retry={data.reload}>
                {data.data && (
                    <>
                        <p className="pad muted">
                            仅保存名称、权限、倍率和展示信息。连接地址在“部署”的域名与解析中维护；协议、监听和证书在“服务配置”中维护。
                        </p>
                        <Editor
                            key={data.data.revision}
                            fields={fields}
                            initial={{
                                ...data.data.values,
                                tags: data.data.values.tags || [],
                            }}
                            submit="保存线路信息"
                            onDirty={() => setDirty(true)}
                            onBusyChange={setBusy}
                            linkValues={(key, value, values) => ({
                                ...values,
                                [key]: value,
                                ...(key === "region_code"
                                    ? { city_code: null }
                                    : {}),
                            })}
                            onSave={async (values) => {
                                if (
                                    Number(values.rate) !==
                                        Number(data.data!.values.rate) &&
                                    data.data!.sharedLines > 0 &&
                                    !confirm(
                                        `此倍率变更将同时影响本服务的 ${data.data!.sharedLines} 条关联线路。确认保存？`,
                                    )
                                )
                                    throw new Error(
                                        "已取消保存，修改仍保留在表单中。",
                                    );
                                const payload = Object.fromEntries(
                                    defaultLineFields.map((key) => [
                                        key,
                                        values[key] ??
                                            (key === "group_id" ||
                                            key === "tags"
                                                ? []
                                                : null),
                                    ]),
                                );
                                await request(
                                    admin("server/connections/default"),
                                    {
                                        type: node.type,
                                        id: node.id,
                                        revision: data.data!.revision,
                                        ...payload,
                                    },
                                    { method: "PATCH" },
                                );
                                setDirty(false);
                                onSaved();
                                close();
                            }}
                        />
                        <div className="pad">
                            <button
                                disabled={busy}
                                onClick={() => {
                                    if (
                                        !dirty ||
                                        confirm(
                                            "重新载入将放弃尚未保存的线路修改，确认继续？",
                                        )
                                    ) {
                                        setDirty(false);
                                        data.reload();
                                    }
                                }}
                            >
                                重新载入线路
                            </button>
                        </div>
                    </>
                )}
            </State>
        </Modal>
    );
}
