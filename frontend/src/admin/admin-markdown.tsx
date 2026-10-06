import MdEditor from "react-markdown-editor-lite";
import DOMPurify from "dompurify";
import { renderMarkdown } from "../shared/markdown";
import "react-markdown-editor-lite/lib/index.css";

export function AdminMarkdown({
    value,
    onChange,
    label,
}: {
    value: string;
    onChange: (value: string) => void;
    label: string;
}) {
    return (
        <div className="admin-markdown" role="group" aria-label={label}>
            <MdEditor
                value={value}
                style={{ height: "500px" }}
                renderHTML={(text) => DOMPurify.sanitize(renderMarkdown(text))}
                onChange={({ text }) => onChange(text)}
                onImageUpload={(file: File) =>
                    new Promise<string>((resolve, reject) => {
                        if (
                            !/^image\/(png|jpeg|gif|webp)$/.test(file.type) ||
                            file.size > 5 * 1024 * 1024
                        ) {
                            reject(
                                new Error(
                                    "请选择不超过 5 MB 的 PNG、JPEG、GIF 或 WebP 图片",
                                ),
                            );
                            return;
                        }
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result));
                        reader.onerror = () =>
                            reject(new Error("无法读取图片"));
                        reader.readAsDataURL(file);
                    })
                }
                config={{
                    view: {
                        menu: true,
                        md: true,
                        html: true,
                        fullScreen: true,
                        hideMenu: true,
                    },
                }}
            />
        </div>
    );
}
