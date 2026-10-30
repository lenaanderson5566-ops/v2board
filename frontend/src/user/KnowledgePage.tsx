import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { trackAction } from "./product-analytics";
import { HelpGuides, ContactSupport } from "./HelpGuides";
import { tx, locale, languages } from "../shared/i18n";
import { rows, query } from "../shared/api";
import { useData, State, Panel, Empty, Html, Modal } from "../shared/ui";

export function Knowledge() {
    const [language, setLanguage] = useState(locale()),
        [keyword, setKeyword] = useState(""),
        [search, setSearch] = useState(""),
        [id, setId] = useState<number | null>(null);
    const interfaceLanguage = locale();
    useEffect(() => setLanguage(interfaceLanguage), [interfaceLanguage]);
    useEffect(() => {
        const timer = window.setTimeout(() => setSearch(keyword.trim()), 300);
        return () => window.clearTimeout(timer);
    }, [keyword]);
    const d = useData(query("user/knowledge/fetch", { language, keyword: search })),
        article = useData(
            id
                ? query("user/knowledge/fetch", { id })
                : "",
        );
    return (
        <>
            <Panel
                title={tx("帮助中心")}
                className="knowledge-search-panel"
                actions={
                    <>
                        <select
                            aria-label={tx("文档语言")}
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                        >
                            {languages.map((l) => (
                                <option value={l.code} key={l.code}>
                                    {l.name}
                                </option>
                            ))}
                        </select>
                        <input
                            type="search"
                            placeholder={tx("searchAll", { ns: "help", defaultValue: "Search questions and documents" })}
                            aria-label={tx("searchAll", { ns: "help", defaultValue: "Search questions and documents" })}
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                        />
                    </>
                }
            >
                {null}
            </Panel>
            <HelpGuides search={keyword} onSearchChange={setKeyword} showSearch={false} />
            <Panel title={tx("使用文档")}>
                <State {...d} retry={d.reload}>
                    {Object.entries(d.data || {}).length ? (
                        Object.entries(d.data || {}).map(
                            ([category, items]) => (
                                <div className="pad" key={category}>
                                    <h3>{category}</h3>
                                    {rows(items).map((item) => (
                                        <button
                                            className="article-link"
                                            key={item.id}
                                            onClick={() => { trackAction("help_open","knowledge"); setId(item.id); }}
                                        >
                                            <span>{item.title}</span>
                                            <ArrowUpRight size={16} />
                                        </button>
                                    ))}
                                </div>
                            ),
                        )
                    ) : (
                        <Empty text={tx("暂无相关文档")} />
                    )}
                </State>
            </Panel>
            <ContactSupport />
            {id && (
                <Modal
                    title={article.data?.title || tx("文档")}
                    close={() => setId(null)}
                >
                    <State {...article} retry={article.reload}>
                        <div className="pad">
                            <Html markdown value={article.data?.body} />
                        </div>
                    </State>
                </Modal>
            )}
        </>
    );
}
