# 用户端、后台与独立部署

## 目录和依赖

```
frontend/src/
  user/       用户应用入口、页面、业务组件和专属样式
  admin/      后台入口、管理页面、编辑器和专属样式
  shared/     公共 UI、请求、国际化和工具
  locales/    公共翻译资源
  assets/     公共素材
```

两端分别从 `src/user/main.ts`、`src/admin/main.ts` 启动。公共代码不能引用任一应用；用户端和后台不能互相引用。构建检查同时校验源码依赖、动态页面加载及输出文件，违规直接使构建失败。共用工单视图已从用户业务文件拆出，后台无需加载整份用户应用。

Vite 采用[多页面入口](https://v6.vite.dev/guide/build#multi-page-app)。执行：

```sh
cd frontend
npm ci
npm run test
npm run build
```

发布时使用默认 Vite 生产配置构建，并将完整 `public/console`（含 `.vite` 清单与 `build-provenance.json`）随源码提交。用户端和后台分别编译，资源分布在 `assets/user` 与 `assets/admin`。普通 `npm run build` 根据两端各自的源码指纹判断重建范围。只改后台页面时复用用户端产物，只改用户端页面时复用后台产物。共享组件、构建配置、正式语言包和依赖锁文件变化时同时构建两端。

页面专用样式放在各自的 `src/user` 和 `src/admin`，基础控件样式继续共用。用户端公开引导使用从源文件提取的小词库，后台页面在渲染前加载当前会话语言的完整词库。修改用户隐私链接或公开引导的专用样式只影响用户端构建。节点地区字典、节点预设及支付目录 JSON 由后台打包，更新时只编译后台。两端使用的支付图标仍计入共享输入。

已有构建可复用时，`npm run build` 会按端核对独立包的首页、清单引用的全部资源和构建报告。从 Git 拉取更新或独立包缺少文件时，命令从已验证的 `public/console` 刷新受影响的包，保留 `_headers` 等由站点维护的根目录文件。提取优先使用发布目录中该端的运行配置，其次沿用独立包内已导出的配置。从头编译两端可运行 `npm run build -- --force`。从 `frontend` 执行 `node scripts/build-console.mjs --verify` 可只读核对两端源码与完整发布目录的指纹。GitHub Actions 在 Linux 强制重建前校验已提交的产物，校验允许 Windows 和 Linux 检出的文本换行差异。

得到三份产物：

- `public/console`：Laravel 当前部署使用，包含两端入口和完整生产清单。
- `frontend/dist/user`：用户端独立发布包，只包含用户入口可达的资源。
- `frontend/dist/admin`：后台独立发布包，包含后台样式、字体及编辑器资源。

从现有构建单独提取后台包可运行 `npm run package:frontends -- admin`。将参数换为 `user` 可提取用户包，省略参数会提取两端。

独立发布包均以 `index.html` 为首页，各自包含需要的公共资源，不依赖另一应用的发布目录。用户发布包不包含后台 JS、后台样式、后台字体或后台配置。`npm run package:frontends` 可从已有生产清单重新生成独立包。

## 当前 Laravel 部署

继续部署仓库的 `public/console`、PHP 和 Blade 文件。用户页面选择 `index.html` 清单入口，后台选择 `admin.html` 入口。服务器通过公开字段白名单注入运行配置，仍支持 `/`、`/app`、原后台路径、网站自动登录和原 iOS 流程。

```sh
php artisan console:verify --host=fastdog.ws
```

此次改造不会自动变更线上域名或部署架构。

### 调整后台登录入口

在后台打开「系统设置 → 账户与注册 → 账户安全」，修改「后台入口路径」并保存。填写随机的单段路径，建议至少 24 个字母或数字，不加开头的斜杠。保存后，在另一个窗口打开 `https://你的域名/新路径#/login` 验证登录，并检查旧地址已不再展示后台。设置同时变更管理 API 的 `/api/v1/新路径/` 前缀。

如果需要从服务器恢复入口，先备份站点配置，在 `config/fastai.php` 的配置数组里修改 `secure_path`。仅有旧版 `config/v2board.php` 的部署使用现有站点配置文件。修改后执行 `php artisan route:clear` 和 `php artisan config:cache`，有常驻 PHP 进程时按部署方式重载。

随机路径用于减少扫描。需要限制谁能看到登录页时，把后台页面及管理接口放在受 VPN 或访问策略保护的入口，保留用户端共用的登录接口和支付回调。独立静态部署也要保护后台站点及其 `admin-config.json`，换路径后重新导出运行配置。

## 独立静态部署

下面的域名均为示例，需要换成实际域名。在仓库根目录导出对应应用的公开运行配置：

```sh
php artisan console:export-runtime --mode=user --api-origin=https://api.example.com --output=frontend/dist/user
php artisan console:export-runtime --mode=admin --api-origin=https://api.example.com --output=frontend/dist/admin
```

分别将 `dist/user` 与 `dist/admin` 上传至用户网站和后台网站。配置文件分别为 `user-config.json` 和 `admin-config.json`，只部署到各自的网站；不要将整个 Laravel 配置、`.env` 或密钥复制到前端。导出只包含公开前端字段，用户配置不包含后台路径。站点配置改变后重新导出；运行配置建议使用 `Cache-Control: no-cache`，带哈希的静态资源可长期缓存。

静态服务器需要将 `/app`（包括 `/app/`）回退到用户 `index.html`，以保留账户入口和一次性登录链接的跳转；页面内导航继续使用 hash。API 请求应到后端，不能被静态页面回退规则覆盖。不同前端托管平台的实际回退规则需在部署时配置。

在后端 `.env` 设置允许的前端来源，然后更新配置缓存：

```dotenv
FRONTEND_ALLOWED_ORIGINS=https://www.example.com,https://admin.example.com
```

```sh
php artisan config:cache
```

浏览器使用 `credentials: include`，携带 API 域的 host-only HttpOnly Cookie 和 `X-Browser-Client: user|admin`；写操作还需内存中的 `X-CSRF-Token` 与精确匹配的 Origin。当前 CORS 由 `BrowserOrigins` 和 `CORS` 中间件执行，只接受站点来源及明确允许的前端来源，`*` 不允许浏览器携带凭据。用户与后台 Cookie 分离；原生客户端继续使用 Bearer。

前端与 API 必须使用 HTTPS 且属于同一站点（例如同一主域的子域名），以符合 SameSite=Lax；任意跨站域名即使加入 CORS 也不能完成此 Cookie 登录。不同站点需通过同站 API 网关接入，不能沿用旧的 localStorage/Bearer 部署方式。设置生产 `APP_ENV`，保持 Secure Cookie，部署细节见 [浏览器会话](browser-sessions.md)。

FastAI 后端的站点 URL 应指向用户网站，以便续费和一次性网页登录链接进入正确网站；后端自身 `APP_URL` 使用后端地址。反向代理、TLS、支付回调、订阅路径仍由后端处理，需要按实际部署验证。

## 本地开发与运行配置

`npm run dev` 启动 Vite。用户入口为 `/`，后台入口为 `/admin.html`。没有 Laravel 页面注入时，需要对应的公开运行配置文件；可用导出命令生成，也可通过 `frontend/.env.local` 的 `VITE_CONFIG_URL` 指向本地配置。配置中没有 `landing` 时，用户 `/app` 自动进入账户页面。

`VITE_API_BASE_URL` 可作为后端地址默认值；集成部署默认继续使用同源 API。生产仅接受 HTTPS 后端来源，本地开发允许 localhost HTTP。`VITE_` 变量是公开配置，不能放密码、Token 或私钥。代码读取运行配置后才加载应用，配置错误会显示启动错误，不会默默切换应用模式。

公开配置导出和静态包是部署准备工具，不会上传文件或修改线上服务。
