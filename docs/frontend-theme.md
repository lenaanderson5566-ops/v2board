# 用户端主题维护

用户端与专用 App 的配色基准来自 `FlClash/lib/v2board/theme.dart`。网页主题的唯一颜色入口是 `frontend/src/user/app-theme.css`，它只声明变量，不包含组件属性、交互选择器或布局。

## 职责

- `app-theme.css`：品牌色、文字、背景层级、边框、焦点、状态、图表颜色及旧组件变量别名。
- `shared/console.css`：按钮、表单、开关、语言浮层、弹窗的基础样式及交互状态。使用主题变量，保留原色作为后台默认回退。
- `user/*.css`：页面布局和组件变体，直接使用变量。不要在主题文件末尾叠加页面覆盖。

变量放在 `body[data-console="user"]` 上，使挂载到 body 的 Portal 弹窗也能继承，同时避免进入后台。主题在基础与页面样式之前导入，不依赖“最后加载”获得优先级。

## 按用途选择颜色

| 用途 | 变量 |
| --- | --- |
| 主要操作及选中状态 | `--brand`、`--brand-hover`、`--brand-soft`、`--on-brand` |
| 正文、辅助文字 | `--ink`、`--text-secondary` |
| 卡片、柔和背景、容器层级 | `--surface`、`--surface-soft`、`--surface-tint`、`--surface-raised` |
| 分隔线、输入框边界 | `--line`、`--outline` |
| 键盘/输入焦点 | `--brand`、`--focus-ring` |
| 成功、警告、失败 | `--success`、`--warning`、`--danger` 及对应背景变量 |
| 下载、上传图表 | `--chart-download`、`--chart-upload` |

`--accent`、`--primary`、`--border`、`--muted`、`--bg` 是现有共享组件的兼容别名，只在主题入口定义，不要在各页面重新声明。不要根据旧色值深浅推断用途；正文、选中背景和边框应分别选择语义变量。品牌标识和支付图标保留自身色彩。

## 验证

修改基础组件时同时检查用户端与后台默认样式，包含默认、悬停、焦点、禁用和开关状态，以及挂载到 body 的弹窗。检查桌面/手机布局与 RTL 语言，然后执行 `npm run build` 更新 `public/console` 发布资源。

本次已验证共享组件后台默认颜色与重构前一致，用户端主按钮、输入焦点、开关及 Portal 弹窗正确继承主题；另完成账户页、礼品卡弹窗、官网与登录页的桌面/手机及多语言预览。
