type UaStat = { ua: string; count_24h: number };

export function ClientUaStats({ items }: { items: UaStat[] }) {
    if (!items.length) return <>暂无记录</>;
    const row = (item: UaStat) => (
        <div className="admin-ua-text" key={item.ua}>
            {item.ua}{" "}
            <span className="muted">· 24 小时 {item.count_24h} 次</span>
        </div>
    );
    if (items.length === 1) return row(items[0]);
    return (
        <details className="admin-ua-stats">
            <summary>{items.length} 种 UA · 查看明细</summary>
            <small className="muted">
                最近 30 天出现过的 UA；次数为最近 24 小时。
            </small>
            {items.map(row)}
        </details>
    );
}
