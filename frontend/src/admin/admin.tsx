import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Search } from "lucide-react";
import { admin, date, download, query, request, rows, type Row } from "../shared/api";
import { languageCodes } from "../shared/language-options";
import { Editor, Modal, Pager, Panel, Reload, State, Table, useData, type Field } from "../shared/ui";
import { AdminLogTimeZone } from "./admin-log-time";
import { AdminDisplaySettings } from "./AdminDisplaySettings";
import { AdminLogFilters, type AdminLogKind } from "./AdminLogFilters";
import { ContentComposer } from "./ContentComposer";
import { sortPayload } from "./admin-actions";
import { linkResource, resourceFields, validateResource } from "./admin-linkage";
import { formPresentation } from "./admin-presentation";
import { AdminSwitch } from "./admin-switch";
import { AdminRowMenu } from "./AdminRowMenu";
import { SortButton } from "./admin-tools";
import { adminUserLabel } from "./admin-user-label";
import { adminOrderPlan } from "./admin-order-labels";
import { adminPlanLabel, adminPlanOptions, type AdminPlanDirectory } from "./admin-plan-reference";
import { isMixedPlan, planInView, validateCreditPlan, type PlanView } from "./admin-plan-products";
import { readListView, saveListView } from "./list-view-state";
import { RouteRuleEditor } from "./RouteRuleEditor";
import { readRouteForm } from "./route-form";

const AdminPlanTranslationWorkspace = lazy(() => import("./AdminPlanTranslationWorkspace").then(module => ({
    default: module.AdminPlanTranslationWorkspace,
})));

type ResourceKind =
    | "plans"
    | "groups"
    | "routes"
    | "users"
    | "orders"
    | "notices"
    | "knowledge"
    | "coupons"
    | "giftcards"
    | "risk"
    | "clients"
    | "access-blacklist"
    | "access-blacklist-ua"
    | "online"
    | "access-logs"
    | "access-logs-subscriptions"
    | "access-logs-connections"
    | "access-logs-risk"
    | "system-log"
    | "commissions";

export interface Resource {
    kind?: ResourceKind;
    planView?: PlanView;
    logKind?: AdminLogKind;
    title: string;
    fetch: string;
    sort?: string;
    sortKind?: "plans" | "knowledge";
    serverSearch?: boolean;
    save?: string;
    drop?: string;
    fields: Field[];
    columns: [string, string, ((r: Row) => React.ReactNode)?][];
    defaults?: Row;
    actions?: [string, string, Row?][];
    key?: string;
    create?: boolean;
}
export function ResourcePage({
    resource,
    queryParams = {},
    toolbar,
    extraActions,
    headerActions,
    onUserDetails,
    searchable = true,
    pageSize: initialPageSize = 20,
    onPageSizeChange,
    onTotal,
    tableSort,
    onTableSort,
    hiddenColumns = [],
    planDirectory,
}: {
    resource: Resource;
    hiddenColumns?: string[];
    planDirectory?: AdminPlanDirectory;
    queryParams?: Row;
    toolbar?: ReactNode;
    extraActions?: (row: Row, context?: boolean, secondary?: ReactNode) => ReactNode;
    headerActions?: ReactNode;
    onUserDetails?: (row: Row) => void;
    searchable?: boolean;
    pageSize?: number;
    onPageSizeChange?: (size: number) => void;
    onTotal?: (total: number) => void;
    tableSort?: { key: string; direction: string; fields: string[] };
    onTableSort?: (key: string, direction: string) => void;
}) {
    const [localPageSize, setLocalPageSize] = useState(initialPageSize);
    const pageSize = onPageSizeChange ? initialPageSize : localPageSize;
    const { kind, logKind, planView } = resource;
    const orderResource = kind === "orders" || kind === "commissions";
    const viewKey = planView === "credits" ? `${resource.fetch}:credits` : resource.fetch;
    const columnStorageKey = `admin.columns.${viewKey}`;
    const [showDisplay, setShowDisplay] = useState(false);
    const [columnViews, setColumnViews] = useState<Record<string, string[]>>({});
    let storedColumns: string[] | undefined;
    try {
        const saved = JSON.parse(localStorage.getItem(columnStorageKey) || "null");
        if (Array.isArray(saved)) {
            const available = new Set(resource.columns.map(([key]) => key));
            const valid = saved.filter(value => typeof value === "string" && available.has(value));
            // A preference containing only retired columns falls back to the current defaults.
            if (valid.length || saved.length === 0) storedColumns = valid;
        }
    } catch { /* Optional browser preference. */ }
    const selectedColumns = columnViews[columnStorageKey] ?? storedColumns ?? resource.columns.map(([key]) => key);
    const updateColumns = (columns: string[]) => {
        setColumnViews(previous => ({ ...previous, [columnStorageKey]: columns }));
        try { localStorage.setItem(columnStorageKey, JSON.stringify(columns)); } catch { /* Keep in-memory preferences. */ }
    };
    const ownDisplaySettings = kind !== "users";

    const [savedView] = useState(() => {
        const saved = readListView(viewKey);
        return saved.context === JSON.stringify(queryParams) &&
            saved.pageSize === pageSize
            ? saved
            : {};
    });
    const [logFilters, setLogFilters] = useState<Row>(() =>
        savedView.logFilters && typeof savedView.logFilters === "object"
            ? savedView.logFilters
            : {},
    );
    const groups = useData<Row[]>(
        resource.fields.some((f) => f.key === "group_id") ||
            resource.columns.some(([key]) => key === "group_id")
            ? admin("server/group/fetch")
            : "",
    );
    const [editing, setEditing] = useState<Row | null>(null);
    const needsPlanDirectory = resource.fields.some(field =>
        ["plan_id", "limit_plan_ids"].includes(field.key),
    ) || resource.columns.some(([key]) =>
        ["plan_id", "plan_name", "limit_plan_ids"].includes(key),
    );
    const fetchedPlans = useData<Row[]>(
        !planDirectory && needsPlanDirectory ? admin("plan/fetch") : "",
    );
    const plans = planDirectory || fetchedPlans;
    const categories = useData<string[]>(
        kind === "knowledge" ? admin("knowledge/getCategory") : "",
    );
    const editorFields = resource.fields.map((field) =>
        field.key === "category"
            ? { ...field, suggestions: categories.data || [] }
            : field.key === "language"
              ? {
                    ...field,
                    suggestions: languageCodes,
                }
              : field.key === "group_id"
                ? {
                      ...field,
                      label: "权限组",
                      type: "select" as const,
                      options: rows(groups.data).map(
                          (r) => [String(r.id), r.name] as [string, string],
                      ),
                  }
                : field.key === "plan_id"
                  ? {
                        ...field,
                        label: "套餐",
                        hint:
                            kind === "users"
                                ? "选择套餐会同步流量、设备和速率限制；到期时间与余额保持当前输入。"
                                : plans.loading
                                  ? "正在加载套餐目录…"
                                  : plans.error
                                    ? "套餐目录加载失败，已保留原套餐选择，可重试加载。"
                                    : !rows(plans.data).length
                                      ? "请先到套餐管理创建套餐。"
                                      : undefined,
                        type: "select" as const,
                        nullable: true,
                        options: [
                            ["", "不指定套餐"] as [string, string],
                            ...adminPlanOptions(rows(plans.data), editing?.plan_id, plans),
                        ],
                    }
                  : field.key === "limit_plan_ids"
                    ? {
                          ...field,
                          label: "适用套餐（不选择表示全部）",
                          type: "multiselect" as const,
                          options: adminPlanOptions(rows(plans.data), editing?.limit_plan_ids, plans),
                      }
                    : field.key === "limit_period"
                      ? {
                            ...field,
                            label: "适用周期（不选择表示全部）",
                            type: "multiselect" as const,
                            options: [
                                ["month_price", "月付"],
                                ["quarter_price", "季付"],
                                ["half_year_price", "半年付"],
                                ["year_price", "年付"],
                                ["two_year_price", "两年付"],
                                ["three_year_price", "三年付"],
                                ["onetime_price", "额度包"],
                                ["reset_price", "重置流量"],
                            ] as [string, string][],
                        }
                      : field,
    );
    const [page, setPage] = useState(() =>
            Number.isInteger(savedView.page) && savedView.page > 0
                ? savedView.page
                : 1,
        ),
        [search, setSearch] = useState(() =>
            typeof savedView.search === "string" ? savedView.search : "",
        ),
        [error, setError] = useState("");
    const [routeUsage, setRouteUsage] = useState("");
    const [routeFilter, setRouteFilter] = useState("");
    const [showAllPlanProducts, setShowAllPlanProducts] = useState(false);
    const [editorState, setEditorState] = useState({ busy: false, dirty: false });
    const [planTextChanged, setPlanTextChanged] = useState(false);
    const [translationPlan, setTranslationPlan] = useState<Row | null>(null);
    const [translationBusy, setTranslationBusy] = useState(false);
    useEffect(() => {
        saveListView(viewKey, {
            context: JSON.stringify(queryParams),
            pageSize,
            page,
            search,
            logFilters,
        });
    }, [
        viewKey,
        queryParams,
        pageSize,
        page,
        search,
        logFilters,
    ]);
    const d = useData<Row[]>(
        query(resource.fetch, {
            current: page,
            page: page,
            pageSize,
            page_size: pageSize,
            email:
                resource.title.includes("日志") || kind === "online"
                    ? search
                    : undefined,
            keyword:
                resource.serverSearch || resource.title.includes("黑名单")
                    ? search
                    : undefined,
            ...logFilters,
            ...queryParams,
            ...(kind === "routes" ? { backend: "v2box" } : {}),
        }),
    );
    const total = d.total || (Array.isArray(d.data) ? d.data.length : 0);
    useEffect(() => {
        if (d.loading || d.error || !Array.isArray(d.data)) return;
        const last = d.total > 0 ? Math.max(1, Math.ceil(d.total / pageSize)) : 1;
        if (page > last) setPage(last);
    }, [d.loading, d.error, d.data, d.total, pageSize, page]);
    useEffect(() => {
        if (kind !== "clients") return;
        const timer = window.setInterval(() => {
            if (
                document.visibilityState === "visible" &&
                !editing &&
                !d.loading
            )
                d.reload();
        }, 60000);
        return () => window.clearInterval(timer);
    }, [resource, editing, d.loading, d.reload]);
    useEffect(() => {
        onTotal?.(total);
    }, [total, onTotal]);
    const key = resource.key || "id";
    const actionPending = useRef(false);
    const [actionBusy, setActionBusy] = useState(false);
    async function action(path: string, r: Row, extra: Row = {}) {
        if (actionPending.current) return;
        if (
            !confirm(
                kind === "users"
                    ? path.endsWith("resetSecret")
                        ? `重置 ${r.email} 的 UUID 和订阅链接？旧链接和客户端凭据将失效。`
                        : `删除 ${r.email}？该用户的订单、邀请码和工单也会被永久删除。`
                    : planView && path === resource.drop && isMixedPlan(r)
                      ? `删除「${r.name}」？该商品会从周期套餐和额度包列表中移除。`
                      : "确认执行此操作？",
            )
        )
            return;
        actionPending.current = true;
        setActionBusy(true);
        setError("");
        try {
            await request(path, {
                [key]: r[key],
                id: r.id,
                trade_no: r.trade_no,
                ...extra,
            });
            d.reload();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            actionPending.current = false;
            setActionBusy(false);
        }
    }
    const secondaryActionsInMenu = kind === "knowledge" || kind === "notices" ||
        kind === "plans" || kind === "coupons" || kind === "giftcards";
    const secondaryActions = (r: Row) => <>
        {resource.actions?.map(([label, path, extra]) => (
            <button key={label} className={kind === "users" ? "danger" : undefined}
                disabled={actionBusy || d.loading || (kind === "orders" && r.status !== 0)}
                onClick={() => action(path, r, extra)}>{label}</button>
        ))}
        {resource.drop && <button className="danger" disabled={actionBusy || d.loading || kind === "routes" && Number(r.node_count) > 0} title={kind === "routes" && Number(r.node_count) > 0 ? "请先解除服务引用" : undefined} onClick={() => action(resource.drop!, r)}>删除</button>}
    </>;
    const customSecondaryActions = Boolean(extraActions &&
        (kind === "users" || orderResource));
    const fetchedRows = rows(d.data);
    const list = fetchedRows.filter(r => {
        if (planView && !showAllPlanProducts && !planInView(r, planView)) return false;
        if (kind !== "routes") return true;
        if (routeUsage === "used" && !r.node_count || routeUsage === "unused" && r.node_count) return false;
        if (!routeFilter) return true;
        if (routeFilter === "legacy") return r.action !== "sing_box";
        const form = r.action === "sing_box" ? readRouteForm(r.sing_box || {}) : undefined;
        if (routeFilter === "advanced") return r.action === "sing_box" && !form;
        return form && (form.kind === "dns" || form.kind === "default" ? form.kind === routeFilter : form.action === routeFilter);
    }).filter(
        (r) =>
            Boolean(logKind) ||
            resource.serverSearch ||
            !search ||
            kind === "routes" && JSON.stringify(r).toLowerCase().includes(search.toLowerCase()) ||
            Object.values(r).some((v) =>
                String(v ?? "")
                    .toLowerCase()
                    .includes(search.toLowerCase()),
            ),
    );
    return (
        <>
            {(kind === "access-blacklist" || kind === "access-blacklist-ua") && <p className="muted">仅拦截订阅获取请求，不限制网站登录及节点代理流量。</p>}
            {showDisplay && ownDisplaySettings && <AdminDisplaySettings title={`${resource.title}显示设置`}
                columns={resource.columns.filter(([key]) => !hiddenColumns.includes(key))} selected={selectedColumns}
                onChange={updateColumns} onReset={() => updateColumns(resource.columns.map(([key]) => key))} close={() => setShowDisplay(false)} />}
            <Panel
                title={resource.title}
                actions={
                    <>
                        {headerActions}
                        {ownDisplaySettings && <button type="button" onClick={() => setShowDisplay(true)}>显示设置</button>}
                        {planView && (
                            <button type="button" aria-pressed={showAllPlanProducts}
                                onClick={() => setShowAllPlanProducts(current => !current)}>
                                查看全部商品
                            </button>
                        )}
                        {searchable && !logKind && (
                            <div className="search">
                                <Search size={16} />
                                <input
                                    placeholder={
                                        kind === "routes" ? "备注、域名、IP、端口或出口…" : kind === "online" ||
                                        resource.title.includes("日志")
                                            ? "搜索邮箱…"
                                            : "搜索当前列表…"
                                    }
                                    value={search}
                                    onChange={(e) => {
                                        setSearch(e.target.value);
                                        setPage(1);
                                    }}
                                    aria-label="搜索列表"
                                />
                            </div>
                        )}
                        {(
                                <Reload
                                    onClick={d.reload}
                                    loading={d.loading}
                                />
                            )}
                        {resource.save && resource.create !== false && (
                            <button
                                className="primary"
                                onClick={() =>
                                    setEditing({
                                        ...resource.defaults,
                                    })
                                }
                            >
                                <Plus size={16} />
                                {planView ? `新建${resource.title}` : "新建"}
                            </button>
                        )}
                    </>
                }
            >
                {actionBusy && <div className="admin-refresh-note" role="status" data-saving="true">正在提交操作…</div>}
                {logKind && <AdminLogTimeZone />}
                {logKind && (
                    <AdminLogFilters
                        key={logKind}
                        kind={logKind}
                        initialFilters={logFilters}
                        onApply={(filters) => {
                            setLogFilters(filters);
                            setPage(1);
                        }}
                    />
                )}
                {resource.sort && resource.sortKind && (
                    <div className="pad">
                        <SortButton
                            path={resource.sort}
                            kind={resource.sortKind}
                            items={fetchedRows}
                            onSaved={d.reload}
                        />
                        {planView && <small className="muted"> 排序适用于全部商品</small>}
                    </div>
                )}
                {planView === "credits" && (
                    <p className="pad muted">
                        购买额度按批次发放，默认有效期为 12 个月。
                        <a href="#/subscription-settings">额度基础权限组</a>在订阅设置中管理，美元售价在
                        <a href="#/plans-currencies">价格与币种</a>中设置。
                    </p>
                )}
                {toolbar}
                {kind === "routes" && (
                    <div className="pad">
                        <div className="actions">
                            <label>规则筛选<select value={routeFilter} onChange={e => setRouteFilter(e.target.value)}><option value="">全部规则</option><option value="reject">阻断</option><option value="route">直连 / 代理转发</option><option value="dns">DNS 分流</option><option value="default">默认出口</option><option value="advanced">高级配置</option><option value="legacy">旧格式兼容</option></select></label>
                            <label>引用筛选<select value={routeUsage} onChange={e => setRouteUsage(e.target.value)}><option value="">全部引用状态</option><option value="used">已引用</option><option value="unused">未引用</option></select></label>
                            <button onClick={d.reload}>刷新规则</button>
                            <span className="muted">{list.length} / {(d.data || []).length} 条规则</span>
                        </div>
                        <p className="muted">
                            常用规则直接填写匹配内容和处理方式；复杂组合使用高级 JSON。修改会同步影响引用它的服务，正在使用的规则不能删除，可先复制再调整。
                        </p>
                    </div>
                )}
                {kind === "online" && (
                    <p className="pad muted">
                        基于节点有效上报窗口内的记录，受流量阈值影响。用户{" "}
                        {d.meta?.users ?? "—"} · IP {d.meta?.ips ?? "—"} ·
                        上报记录 {d.total} · 查询时间 {date(d.meta?.updated_at)}
                        。按用户、节点和 IP 展示，不代表实时连接数或实际设备数；节点未上报时可能不显示。
                    </p>
                )}
                {kind === "access-logs-risk" && (
                    <p className="admin-log-note muted">
                        近 30 天，同一用户、规则、IP 和处理结果按固定 10
                        分钟窗口合并；总数为合并后的事件数。点击用户查看原始活动。
                    </p>
                )}
                <State {...d} retry={d.reload}>
                    {error && <div className="alert">{error}</div>}
                    <Table
                        data={list}
                        columns={resource.columns
                            .filter(([key]) => !hiddenColumns.includes(key) && (!ownDisplaySettings || selectedColumns.includes(key)))
                            .map(([key, label, render]) => {
                                if (kind === "users" && key === "id" && onUserDetails)
                                    return [key, label, (r: Row) => <button className="link" onClick={() => onUserDetails(r)}>{adminUserLabel({user_id:r.id,email:r.email})}</button>] as [string,string,(r:Row)=>ReactNode];
                                if (key === "plan_id" || key === "plan_name")
                                    return [key, label, (r: Row) => orderResource ? adminOrderPlan(r, plans) : adminPlanLabel(r, plans)] as [string, string, (r: Row) => ReactNode];
                                if (key === "limit_plan_ids")
                                    return [key, label, (r: Row) => (Array.isArray(r[key]) && r[key].length)
                                        ? r[key].map((id: unknown) => adminPlanLabel({ plan_id: id }, plans)).join("、")
                                        : "全部套餐"] as [string, string, (r: Row) => ReactNode];
                                if (key === "group_id" && !render)
                                    return [
                                        key,
                                        label,
                                        (r: Row) => {
                                            if (r.group_id == null) return "—";
                                            const group = rows(
                                                groups.data,
                                            ).find(
                                                (g) =>
                                                    String(g.id) ===
                                                    String(r.group_id),
                                            );
                                            return (
                                                group?.name ||
                                                `未知权限组 (#${r.group_id})`
                                            );
                                        },
                                    ] as [
                                        string,
                                        string,
                                        (r: Row) => ReactNode,
                                    ];
                                if (
                                    (key === "show" || key === "renew") &&
                                    (kind === "plans" || kind === "knowledge" || kind === "notices" || kind === "coupons")
                                )
                                    return [
                                        key,
                                        label,
                                        (r: Row) => (
                                            <AdminSwitch
                                                label={`${r.name || r.title || r.id} ${label}`}
                                                checked={Number(r[key]) === 1}
                                                onChange={async (checked) => {
                                                    const path =
                                                        kind === "plans"
                                                            ? "plan/update"
                                                            : kind === "knowledge"
                                                              ? "knowledge/show"
                                                              : kind === "notices"
                                                                ? "notice/show"
                                                                : "coupon/show";
                                                    await request(
                                                        admin(path),
                                                        kind === "plans"
                                                            ? {
                                                                  id: r.id,
                                                                  [key]: checked
                                                                      ? 1
                                                                      : 0,
                                                              }
                                                            : { id: r.id },
                                                    );
                                                    d.reload();
                                                }}
                                            />
                                        ),
                                    ] as [
                                        string,
                                        string,
                                        (r: Row) => ReactNode,
                                    ];
                                return [key, label, render] as [
                                    string,
                                    string,
                                    ((r: Row) => ReactNode)?,
                                ];
                            })}
                        onReorder={
                            resource.sort && resource.sortKind && !search &&
                            (!planView || list.length === fetchedRows.length)
                                ? async (items) => {
                                      try {
                                          await request(
                                              resource.sort!,
                                              sortPayload(
                                                  resource.sortKind!,
                                                  items,
                                              ),
                                          );
                                          d.reload();
                                      } catch (e) {
                                          setError((e as Error).message);
                                      }
                                  }
                                : undefined
                        }
                        sort={tableSort}
                        onSort={onTableSort}
                        actions={
                            resource.save ||
                            resource.drop ||
                            resource.actions ||
                            extraActions
                                ? (r, context) => (
                                      <>
                                          {resource.save &&
                                              (resource.create !== true ||
                                                  kind === "coupons") && (
                                                  <button
                                                      onClick={async () => {
                                                          const item = { ...r };
                                                          if (
                                                              kind === "users"
                                                          ) {
                                                              try {
                                                                  Object.assign(
                                                                      item,
                                                                      (
                                                                          await request(
                                                                              query(
                                                                                  admin(
                                                                                      "user/getUserInfoById",
                                                                                  ),
                                                                                  {
                                                                                      id: r.id,
                                                                                  },
                                                                              ),
                                                                          )
                                                                      ).data,
                                                                  );
                                                                  item.invite_user_email =
                                                                      item
                                                                          .invite_user
                                                                          ?.email ||
                                                                      "";
                                                              } catch (e) {
                                                                  setError(
                                                                      (
                                                                          e as Error
                                                                      ).message,
                                                                  );
                                                                  return;
                                                              }
                                                          }
                                                          if (
                                                              resource.title ===
                                                              "知识库管理"
                                                          ) {
                                                              try {
                                                                  Object.assign(
                                                                      item,
                                                                      (
                                                                          await request(
                                                                              query(
                                                                                  resource.fetch,
                                                                                  {
                                                                                      id: r.id,
                                                                                  },
                                                                              ),
                                                                          )
                                                                      ).data,
                                                                  );
                                                              } catch (e) {
                                                                  setError(
                                                                      (
                                                                          e as Error
                                                                      ).message,
                                                                  );
                                                                  return;
                                                              }
                                                          }
                                                          if (
                                                              resource.title ===
                                                              "用户管理"
                                                          ) {
                                                              item.transfer_enable =
                                                                  Number(
                                                                      item.transfer_enable,
                                                                  ) /
                                                                  1073741824;
                                                              item.u =
                                                                  Number(
                                                                      item.u ||
                                                                          0,
                                                                  ) /
                                                                  1073741824;
                                                              item.d =
                                                                  Number(
                                                                      item.d ||
                                                                          0,
                                                                  ) /
                                                                  1073741824;
                                                              delete item.password;
                                                          }
                                                          setEditing(item);
                                                      }}
                                                  >
                                                      编辑
                                                  </button>
                                              )}
                                          {!customSecondaryActions && !secondaryActionsInMenu ? secondaryActions(r) : null}
                                          {kind === "routes" && r.action === "sing_box" && <button onClick={() => setEditing({ ...r, id: undefined, copiedFrom: r.id, remarks: `${r.remarks} · 副本`, node_count: 0, used_by: [] })}>复制</button>}
                                          {extraActions?.(r, context, customSecondaryActions ? secondaryActions(r) : undefined)}
                                          {secondaryActionsInMenu && (resource.actions || resource.drop) && (
                                              <AdminRowMenu context={context} label={`${r.title || r.name || `#${r.id}`} 更多操作`}>
                                                  {secondaryActions(r)}
                                              </AdminRowMenu>
                                          )}
                                      </>
                                  )
                                : undefined
                        }
                    />
                    {(total > 0 || !d.loading) && (
                        <Pager
                            page={page}
                            total={d.total || list.length}
                            size={d.total > 0 ? pageSize : Math.max(pageSize, list.length)}
                            loading={d.loading}
                            onSizeChange={d.total > 0 ? (size) => {
                                setPage(1);
                                if (onPageSizeChange) onPageSizeChange(size);
                                else setLocalPageSize(size);
                            } : undefined}
                            onChange={setPage}
                        />
                    )}
                </State>
            </Panel>
            {editing && (
                <Modal
                    variant={
                        kind === "plans" || kind === "users" || kind === "knowledge" || kind === "notices"
                            ? "drawer"
                            : "modal"
                    }
                    wide={
                        kind === "knowledge" ||
                        kind === "notices" || kind === "routes"
                    }
                    title={
                        editing[key]
                            ? `编辑 · ${resource.title}`
                            : `新建 · ${resource.title}`
                    }
                    guardChanges={kind !== "routes"}
                    dismissible={!editorState.busy}
                    close={() => {
                        if (kind === "routes" && (editorState.busy || editorState.dirty && !confirm("路由修改尚未保存，确认放弃？"))) return;
                        setEditing(null);
                        setPlanTextChanged(false);
                    }}
                >
                    {kind === "coupons" && editing.id && (
                        <p className="alert" role="note">
                            修改仅影响今后领取的券。已领取的券保留原优惠和有效期，历史订单不变。剩余库存是当前可继续发放的数量；停用入口不会撤销已领取的券。
                        </p>
                    )}
                    {planView && editing.id && (isMixedPlan(editing) || !planInView(editing, planView)) && (
                        <p className="pad muted" role="note">
                            两种售卖方式共用商品名称、流量和接入设置。价格按当前页签保存。
                        </p>
                    )}
                    <State
                        loading={groups.loading}
                        error={groups.error}
                        retry={() => {
                            groups.reload();
                            plans.reload?.();
                        }}
                    >
                        {plans.error && resource.fields.some(field => ["plan_id", "limit_plan_ids"].includes(field.key)) && (
                            <div className="alert" role="alert">套餐目录加载失败，已保留原套餐选择。<button type="button" onClick={() => plans.reload?.()}>重试加载套餐</button></div>
                        )}
                        {kind === "notices" ? (
                            <ContentComposer
                                kind="notice"
                                initial={editing}
                                onSave={async (body) => {
                                    await request(resource.save!, body);
                                    d.reload();
                                    setEditing(null);
                                }}
                            />
                        ) : kind === "routes" && editing.action === "sing_box" ? (
                            <RouteRuleEditor initial={editing} onStateChange={setEditorState} onSave={async body => { await request(resource.save!, body); d.reload(); setEditing(null); }} />
                        ) : (
                            <Editor
                                fields={formPresentation(
                                    editorFields.filter(
                                        (field) =>
                                            field.key !== "force_update" ||
                                            Boolean(editing.id),
                                    ),
                                    kind || "",
                                    planView,
                                )}
                                initial={editing}
                                onlyChanged={kind === "users"}
                                submit={kind === "plans" && (planTextChanged || !editing[key]) ? "保存并检查翻译" : undefined}
                                onValuesChange={kind === "plans" ? values => setPlanTextChanged(
                                    ["name", "content"].some(field => String(values[field] || "") !== String(editing[field] || "")),
                                ) : undefined}
                                onBusyChange={busy => setEditorState(current => ({ ...current, busy }))}
                                resolveFields={(fields, values) =>
                                    resourceFields(
                                        kind || "",
                                        fields,
                                        values,
                                    )
                                }
                                linkValues={(key, next, values) =>
                                    linkResource(
                                        kind || "",
                                        rows(plans.data),
                                        key,
                                        next,
                                        values,
                                    )
                                }
                                validate={values => validateResource(values) ??
                                    (planView === "credits" ? validateCreditPlan(values) : undefined)}
                                onSave={async (body) => {
                                    const clean: Row = {};
                                    resource.fields.forEach((field) => {
                                        if (
                                            body[field.key] !== undefined &&
                                            !(
                                                field.key === "password" &&
                                                !body.password
                                            )
                                        )
                                            clean[field.key] = body[field.key];
                                    });
                                    if (editing[key]) clean[key] = editing[key];
                                    if (kind === "users") {
                                        const keys = Object.keys(clean).filter(field => field !== key);
                                        if (!keys.length) {
                                            setEditing(null);
                                            return;
                                        }
                                        const versions = editing.edit_versions;
                                        if (!versions || keys.some(field => !versions[field])) {
                                            throw new Error("请重新打开用户编辑窗口，再提交修改。");
                                        }
                                        clean.edit_versions = Object.fromEntries(keys.map(field => [field, versions[field]]));
                                        ["transfer_enable", "u", "d"].forEach(
                                            (field) => {
                                                if (clean[field] != null)
                                                    clean[field] = Math.round(
                                                        Number(clean[field]) *
                                                            1073741824,
                                                    );
                                            },
                                        );
                                    }
                                    if (kind === "routes") clean.backend = "v2box";
                                    if (resource.defaults)
                                        Object.entries(
                                            resource.defaults,
                                        ).forEach(([k, v]) => {
                                            if (!(k in clean)) clean[k] = v;
                                        });
                                    if (kind === "routes") delete clean.route_template;
                                    if (
                                        (kind === "coupons" || kind === "giftcards") &&
                                        (editing[key] ||
                                            Number(clean.generate_count) <= 1)
                                    )
                                        delete clean.generate_count;
                                    if (
                                        (kind === "coupons" ||
                                            kind === "giftcards") &&
                                        !editing[key] &&
                                        Number(clean.generate_count) > 1
                                    )
                                        await download(
                                            resource.save!,
                                            clean,
                                            kind === "coupons"
                                                ? "coupons.csv"
                                                : "giftcards.csv",
                                        );
                                    else {
                                        const result = await request(resource.save!, clean);
                                        if (kind === "plans" && result.meta?.translation_source_changed && result.meta?.plan_id) {
                                            setTranslationPlan({ id: result.meta.plan_id, name: clean.name });
                                        }
                                        if (planView && !planInView({ ...editing, ...clean }, planView)) {
                                            setShowAllPlanProducts(true);
                                        }
                                    }
                                    setEditing(null);
                                    setPlanTextChanged(false);
                                    d.reload();
                                }}
                            />
                        )}
                    </State>
                </Modal>
            )}
            {translationPlan && <Modal title={`套餐翻译 · ${translationPlan.name}`} variant="drawer" wide guardChanges
                dismissible={!translationBusy} close={() => setTranslationPlan(null)}>
                <Suspense fallback={<p className="pad" role="status">正在加载页面…</p>}>
                    <AdminPlanTranslationWorkspace key={translationPlan.id} plan={String(translationPlan.id)}
                        autoStart onBusyChange={setTranslationBusy} />
                </Suspense>
            </Modal>}
        </>
    );
}
