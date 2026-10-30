import MarkdownIt from "markdown-it";
// Original articles store Markdown; html:true also preserves existing HTML articles.
const parser = new MarkdownIt({ html: true, linkify: true, typographer: true });
const lineBreakParser = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true });
export const renderMarkdown = (value: unknown, options: { breaks?: boolean } = {}): string =>
    (options.breaks ? lineBreakParser : parser).render(String(value || ""));
