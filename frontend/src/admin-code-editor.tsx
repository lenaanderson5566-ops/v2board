import { useId, useState } from "react";
import AceEditor from "react-ace";
import ace from "ace-builds";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/theme-github";
import "ace-builds/src-noconflict/ext-searchbox";
import jsonWorker from "ace-builds/src-noconflict/worker-json?url";
ace.config.setModuleUrl("ace/mode/json_worker", jsonWorker);
export function AdminCodeEditor({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    const name = useId();
    const [full, setFull] = useState(false),
        [error, setError] = useState("");
    return (
        <div className={`admin-code-editor ${full ? "fullscreen" : ""}`}>
            <div className="actions code-toolbar">
                <button
                    type="button"
                    aria-label="格式化 JSON"
                    onClick={() => {
                        try {
                            onChange(
                                JSON.stringify(
                                    JSON.parse(value || "null"),
                                    null,
                                    2,
                                ),
                            );
                            setError("");
                        } catch (e) {
                            setError((e as Error).message);
                        }
                    }}
                >
                    格式化 JSON
                </button>
                <button type="button" onClick={() => setFull(!full)}>
                    {full ? "退出全屏" : "全屏编辑"}
                </button>
            </div>
            {error && <small role="alert">{error}</small>}
            <AceEditor
                name={name}
                mode="json"
                theme="github"
                width="100%"
                height={full ? "calc(100dvh - 64px)" : "280px"}
                fontSize={14}
                value={value}
                onChange={onChange}
                onLoad={(editor) =>
                    editor.textInput
                        .getElement()
                        .setAttribute("aria-label", label)
                }
                setOptions={{
                    tabSize: 2,
                    useWorker: true,
                    showPrintMargin: false,
                }}
            />
        </div>
    );
}
