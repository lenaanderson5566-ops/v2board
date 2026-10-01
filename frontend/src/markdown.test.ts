import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown";
describe("legacy article compatibility", () => {
    it("renders original Markdown headings, emphasis and lists", () => {
        const html = renderMarkdown(
            "# 使用说明\n\n**开始**\n\n- 第一步\n- 第二步",
        );
        expect(html).toContain("<h1>使用说明</h1>");
        expect(html).toContain("<strong>开始</strong>");
        expect(html).toContain("<li>第二步</li>");
    });
    it("retains articles already authored as HTML", () => {
        expect(renderMarkdown("<p>现有 <strong>HTML</strong></p>")).toContain(
            "<p>现有 <strong>HTML</strong></p>",
        );
    });
    it("renders the original editor table syntax", () => {
        expect(
            renderMarkdown("| 标题 | 值 |\n| --- | --- |\n| 内容 | 1 |"),
        ).toContain("<table>");
    });
    it("does not turn a JavaScript Markdown URL into a link", () => {
        expect(renderMarkdown("[click](javascript:alert(1))")).not.toContain(
            'href="javascript:',
        );
    });
});
