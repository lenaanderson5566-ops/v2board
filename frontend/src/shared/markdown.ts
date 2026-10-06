import MarkdownIt from "markdown-it";
// Original articles store Markdown; html:true also preserves existing HTML articles.
const parser = new MarkdownIt({ html: true, linkify: true, typographer: true });
export const renderMarkdown = (value: unknown): string =>
    parser.render(String(value || ""));
