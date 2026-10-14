# 后台组件与视觉规范

后台使用 React、TypeScript、Lucide 和应用自有 CSS。交互复杂的基础组件逐步采用 Radix Primitives，目前账户菜单、订阅管理标签页及优惠券标签页已接入。保留业务组件和既有 API 契约，不引入 Ant Design。

## 组件边界

- Radix 管理菜单与标签页的语义、键盘操作、焦点恢复和弹层碰撞处理。菜单通过 Portal 放到页面根节点，避免容器遮挡。
- 普通按钮、原生输入框和业务布局继续使用现有 HTML 与 CSS。引入第三方组件解决交互问题，不为简单元素额外加封装。
- `admin-section.tsx` 统一业务页标题与操作提示；提示区区分成功与错误，并提供对应的读屏语义。
- `admin-operation.ts` 共享异步操作状态，并通过同步锁阻止按钮禁用前的快速重复提交。失败保留表单草稿，提交时锁定编辑。
- `billing-price-input.ts` 严格把美元十进制文本转成整数分，保留空白与零的区别，拒绝额外小数、科学计数及溢出；服务端继续独立校验。

## 样式维护

后台颜色和圆角集中在 `admin.css` 的 `body[data-console="admin"]` 变量内。样式只作用于后台；卡片保留可见溢出，避免裁切操作菜单。移动端导航限定宽度，页面保留外边距，价格表单在窄屏切换为单列。减少动画偏好关闭侧栏过渡。

新增布局优先复用 `.panel`、`.panel-head`、`.section-tabs` 和表单结构，避免内联样式及堆叠同一选择器的覆盖规则。

## 后续组件迁移

先覆盖易出现键盘和遮挡问题的交互，再按页面迁移弹窗、确认框和组合选择器。共享弹窗目前还被用户前端使用，迁移前须单独覆盖关闭行为、焦点恢复、嵌套弹层和表单提交测试。

复杂表格可评估 TanStack Table，需保留服务端分页、筛选及排序契约。shadcn/ui 的默认安装需要 Tailwind，当前项目已有 CSS 体系，暂不增加第二套样式系统。

参考：
- https://www.radix-ui.com/primitives/docs/components/dropdown-menu
- https://www.radix-ui.com/primitives/docs/components/tabs
- https://tanstack.com/table/latest/docs/overview
- https://ui.shadcn.com/docs/installation/manual
