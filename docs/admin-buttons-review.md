# 原后台业务按钮逐项核对

范围为原后台的全部 16 个菜单，基准构建文件是 `public/assets/admin/res_005.js`。原符号按钮、右键菜单或拖动手柄，在新后台通过文字按钮、更多操作、弹窗或排序控件提供等价入口。并非仅检查用户管理页。

| 模块 | 原操作或等价入口 | 当前连接 | 结果 |
| --- | --- | --- | --- |
| 仪表盘 | 今日节点排行 | `stat/getServerTodayRank` | 已接入并核对 |
| 仪表盘 | 昨日节点排行 | `stat/getServerLastRank` | 已接入并核对 |
| 仪表盘 | 今日用户排行 | `stat/getUserTodayRank` | 已接入并核对 |
| 仪表盘 | 昨日用户排行 | `stat/getUserLastRank` | 已接入并核对 |
| 仪表盘 | 运营历史/刷新 | `stat/getOrder` | 已接入并核对 |
| 仪表盘 | 待回复工单跳转 | `ticket/fetch + status/reply_status` | 已接入并核对 |
| 仪表盘 | 待审核佣金跳转 | `order/fetch + status/commission_status/commission_balance` | 已接入并核对 |
| 仪表盘 | 队列异常/状态入口 | `system/getSystemStatus` | 已接入并核对 |
| 系统设置 | 保存当前设置 | `config/save（仅变更字段）` | 已接入并核对 |
| 系统设置 | 发送测试邮件 | `config/testSendMail` | 已接入并核对 |
| 系统设置 | 设置 Telegram Webhook | `config/setTelegramWebhook` | 已接入并核对 |
| 系统设置 | 显示/隐藏密码 | `本地控件` | 已接入并核对 |
| 系统设置 | 自定义页脚 HTML 保存 | `config/save + custom_footer_html` | 已接入并核对 |
| 支付方式 | 添加 | `payment/save` | 已接入并核对 |
| 支付方式 | 编辑 | `payment/getPaymentForm + payment/save` | 已接入并核对 |
| 支付方式 | 启用/停用 | `payment/show` | 已接入并核对 |
| 支付方式 | 删除 | `payment/drop` | 已接入并核对 |
| 支付方式 | 调整排序/上移/下移/保存 | `payment/sort` | 已接入并核对 |
| 支付方式 | 刷新 | `payment/fetch` | 已接入并核对 |
| 节点管理 | 添加（八类） | `server/{type}/save` | 已接入并核对 |
| 节点管理 | 编辑（八类） | `server/{type}/save` | 已接入并核对 |
| 节点管理 | 复制（八类） | `server/{type}/copy` | 已接入并核对 |
| 节点管理 | 显示/隐藏（八类） | `server/{type}/update` | 已接入并核对 |
| 节点管理 | 删除（八类） | `server/{type}/drop` | 已接入并核对 |
| 节点管理 | 调整排序/上移/下移/保存 | `server/manage/sort` | 已接入并核对 |
| 节点管理 | 安装命令/复制命令 | `getNodes.install_command（仅 v2node）` | 已接入并核对 |
| 节点管理 | 刷新 | `server/manage/getNodes` | 已接入并核对 |
| 权限组 | 添加 | `server/group/save` | 已接入并核对 |
| 权限组 | 编辑 | `server/group/save` | 已接入并核对 |
| 权限组 | 删除 | `server/group/drop` | 已接入并核对 |
| 权限组 | 刷新 | `server/group/fetch` | 已接入并核对 |
| 路由规则 | 添加 | `server/route/save` | 已接入并核对 |
| 路由规则 | 编辑 | `server/route/save` | 已接入并核对 |
| 路由规则 | 删除 | `server/route/drop` | 已接入并核对 |
| 路由规则 | 动作切换/条件联动 | `路由字段联动` | 已接入并核对 |
| 路由规则 | 刷新 | `server/route/fetch` | 已接入并核对 |
| 套餐管理 | 添加 | `plan/save` | 已接入并核对 |
| 套餐管理 | 编辑 | `plan/save` | 已接入并核对 |
| 套餐管理 | 删除 | `plan/drop` | 已接入并核对 |
| 套餐管理 | 展示/隐藏 | `plan/update.show` | 已接入并核对 |
| 套餐管理 | 开启/关闭续费 | `plan/update.renew` | 已接入并核对 |
| 套餐管理 | 更新到现有用户 | `plan/save.force_update` | 已接入并核对 |
| 套餐管理 | 调整排序/上移/下移/保存 | `plan/sort` | 已接入并核对 |
| 套餐管理 | 刷新 | `plan/fetch` | 已接入并核对 |
| 订单管理 | 添加/删除/重置筛选条件 | `本地筛选表单` | 已接入并核对 |
| 订单管理 | 应用/清除筛选 | `order/fetch.filter` | 已接入并核对 |
| 订单管理 | 分配订单 | `order/assign` | 已接入并核对 |
| 订单管理 | 订单详情 | `order/detail` | 已接入并核对 |
| 订单管理 | 查看订单用户 | `users + id 筛选` | 已接入并核对 |
| 订单管理 | 查看邀请人邀请的用户 | `users + invite_user_id 筛选` | 已接入并核对 |
| 订单管理 | 标记已付款 | `order/paid（仅待支付）` | 已接入并核对 |
| 订单管理 | 取消 | `order/cancel（仅待支付）` | 已接入并核对 |
| 订单管理 | 佣金待确认/有效/无效 | `order/update（已发放不可修改）` | 已接入并核对 |
| 订单管理 | 上一页/下一页/刷新 | `order/fetch` | 已接入并核对 |
| 优惠券 | 指定券码创建 | `coupon/generate` | 已接入并核对 |
| 优惠券 | 批量生成并下载 CSV | `coupon/generate + format=csv` | 已接入并核对 |
| 优惠券 | 启用/停用 | `coupon/show` | 已接入并核对 |
| 优惠券 | 删除 | `coupon/drop` | 已接入并核对 |
| 优惠券 | 上一页/下一页/刷新 | `coupon/fetch` | 已接入并核对 |
| 礼品卡 | 创建 | `giftcard/generate` | 已接入并核对 |
| 礼品卡 | 编辑 | `giftcard/generate + id` | 已接入并核对 |
| 礼品卡 | 批量生成并下载 CSV | `giftcard/generate + format=csv` | 已接入并核对 |
| 礼品卡 | 删除 | `giftcard/drop` | 已接入并核对 |
| 礼品卡 | 上一页/下一页/刷新 | `giftcard/fetch` | 已接入并核对 |
| 用户管理 | 高级筛选/搜索/清除 | `user/fetch.filter` | 已接入并核对 |
| 用户管理 | 生成单个/批量用户 | `user/generate` | 已接入并核对 |
| 用户管理 | 编辑 | `user/getUserInfoById + user/update` | 已接入并核对 |
| 用户管理 | 复制订阅链接 | `subscribe_url` | 已接入并核对 |
| 用户管理 | 重置订阅与 UUID | `user/resetSecret` | 已接入并核对 |
| 用户管理 | 分配订单 | `order/assign` | 已接入并核对 |
| 用户管理 | TA 的订单 | `order/fetch + user_id` | 已接入并核对 |
| 用户管理 | TA 的邀请 | `user/fetch + invite_user_id` | 已接入并核对 |
| 用户管理 | TA 的流量记录 | `stat/getStatUser` | 已接入并核对 |
| 用户管理 | 删除 | `user/delUser` | 已接入并核对 |
| 用户管理 | 导出 CSV | `user/dumpCSV` | 已接入并核对 |
| 用户管理 | 发送邮件 | `user/sendMail` | 已接入并核对 |
| 用户管理 | 批量封禁 | `user/ban` | 已接入并核对 |
| 用户管理 | 批量删除 | `user/allDel` | 已接入并核对 |
| 用户管理 | 排序/分页/刷新 | `user/fetch` | 已接入并核对 |
| 公告管理 | 新建 | `notice/save` | 已接入并核对 |
| 公告管理 | 编辑 | `notice/save + id` | 已接入并核对 |
| 公告管理 | 标签适用范围 | `notice/save.tags` | 已接入并核对 |
| 公告管理 | 预览 | `本地 Markdown/HTML 安全预览` | 已接入并核对 |
| 公告管理 | 显示/隐藏 | `notice/show` | 已接入并核对 |
| 公告管理 | 删除 | `notice/drop` | 已接入并核对 |
| 公告管理 | 刷新 | `notice/fetch` | 已接入并核对 |
| 工单管理 | 邮箱搜索/状态/回复状态筛选 | `ticket/fetch` | 已接入并核对 |
| 工单管理 | 重置筛选 | `ticket/fetch` | 已接入并核对 |
| 工单管理 | 查看对话 | `ticket/fetch + id` | 已接入并核对 |
| 工单管理 | 发送回复 | `ticket/reply` | 已接入并核对 |
| 工单管理 | 关闭工单（列表/对话） | `ticket/close` | 已接入并核对 |
| 工单管理 | 每页数量/上一页/下一页/刷新 | `ticket/fetch` | 已接入并核对 |
| 知识库 | 新建 | `knowledge/save` | 已接入并核对 |
| 知识库 | 编辑完整正文/语言 | `knowledge/fetch + id, knowledge/save` | 已接入并核对 |
| 知识库 | 分类建议/自定义分类 | `knowledge/getCategory` | 已接入并核对 |
| 知识库 | 预览 | `knowledge/fetch + id` | 已接入并核对 |
| 知识库 | 显示/隐藏 | `knowledge/show` | 已接入并核对 |
| 知识库 | 删除 | `knowledge/drop` | 已接入并核对 |
| 知识库 | 拖动/上移/下移/保存排序 | `knowledge/sort` | 已接入并核对 |
| 知识库 | 刷新 | `knowledge/fetch` | 已接入并核对 |
| 队列监控 | 系统状态/刷新 | `system/getSystemStatus` | 已接入并核对 |
| 队列监控 | 队列统计/刷新 | `system/getQueueStats` | 已接入并核对 |
| 队列监控 | 工作负载/刷新 | `system/getQueueWorkload` | 已接入并核对 |
| 队列监控 | 主进程/刷新 | `system/getQueueMasters` | 已接入并核对 |
| 主题配置 | 模板选择/模板设置 | `按要求移除；自定义页脚保留在系统设置` | 按要求移除 |

共 105 个操作组；“展示/隐藏”“上一页/下一页”等互斥或成组按钮列在同一行。每项的数据与交互均使用 React/TypeScript 实现，不加载旧模板。

## 验证方式

- `npm test`：90 项前端测试，包括排序数组不可变性、不同接口参数格式、不同节点类型重复 ID、筛选参数、下载鉴权和多语言完整性。
- `php tests/console-smoke.php`：184 项后端检查；包含八类节点保存/复制/展示/删除、套餐/支付/知识库/跨协议节点排序、套餐续费及更新现有用户、订单详情/佣金审核、工单筛选/回复/关闭、优惠券/礼品卡下载、权限组/路由/公告 CRUD，以及之前的用户按钮回归。所有数据在事务内回滚。
- 浏览器：使用 `tests/console-ui-fixtures.php setup` 创建隐藏的临时套餐、文章、节点和禁用的支付方式，检查四类排序弹窗、正文加载、预览与保存；结束后执行 `cleanup`。该脚本只允许 `APP_ENV=local`，不创建账号，若测试套餐被用户或订单占用则拒绝清理。
- SMTP 实际投递、Telegram 外部 Webhook 与真实付款不在本地按钮回归中执行。付款/佣金流程只用临时数据验证接口，不进行真实交易。

## 修复的故障

1. 知识库列表原来未返回语言字段，分类建议和排序入口也缺失；现补全列表元数据，保留完整详情加载，增加分类建议和数值排序保存。
2. 四类排序入口缺失；新增拖动、上移、下移与明确保存。节点排序按“类型 + ID”区分记录。
3. 套餐续费开关与 `force_update` 入口缺失；恢复并明确现有用户同步范围。
4. 订单邮箱搜索原来比较错误，找不到用户还会返回全部订单；现匹配正确用户集合。工单未知邮箱也不再返回其他用户记录。
5. 优惠券/礼品卡下载受强制 JSON 中间件影响；显式 `format=csv` 保持 JSON 兼容，并用标准 CSV 转义、BOM 与公式单元格保护。
6. 队列主进程原接口返回裸集合，普通请求封装读取不到数据；现返回标准 `data`，恢复工作负载与主进程显示。
7. 非待支付订单的付款/取消按钮禁用；已发放佣金在界面与后端都不能再次审核。

## 交互差异

排序同时支持行拖动与排序弹窗；右键菜单和“更多操作”均保留。金额按原后台以元编辑，提交转换为整数分，空价格保持不提供该周期。仪表盘恢复历史趋势图与今日/昨日四个排行图，同时保留数据表。公告和知识库恢复原 Markdown 工具栏、双栏编辑与安全预览，并兼容已有 HTML。生成用户仅放在用户管理内。主题配置移除，自定义页脚 HTML 保留。逐页外观与控件记录见 `admin-layout-review.md`。

`admin-parity.html` 与 `admin-parity.json` 已同步更新。报告中入口存在与功能测试分开解释，外部服务不以本地接口成功代替真实投递/结算验收。
