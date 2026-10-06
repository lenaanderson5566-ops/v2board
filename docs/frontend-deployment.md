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

得到三份产物：

- `public/console`：Laravel 当前部署使用，包含两端入口和完整生产清单。
- `frontend/dist/user`：用户端独立发布包，只包含用户入口可达的资源。
- `frontend/dist/admin`：后台独立发布包，包含后台样式、字体及编辑器资源。

独立发布包均以 `index.html` 为首页，各自包含需要的公共资源，不依赖另一应用的发布目录。用户发布包不包含后台 JS、后台样式、后台字体或后台配置。`npm run package:frontends` 可从已有生产清单重新生成独立包。

## 当前 Laravel 部署

继续部署仓库的 `public/console`、PHP 和 Blade 文件。用户页面选择 `index.html` 清单入口，后台选择 `admin.html` 入口。服务器通过公开字段白名单注入运行配置，仍支持 `/`、`/app`、原后台路径、网站自动登录和原 iOS 流程。

```sh
php artisan console:verify --host=fastdog.ws
```

此次改造不会自动变更线上域名或部署架构。

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

现有 CORS 默认行为保留以兼容已部署客户端；独立部署时应填写实际来源。API 使用 Authorization，不发送浏览器 cookies；V10 用户 API、原管理 API 和权限校验保持原契约。浏览器会话按应用和后端来源隔离，避免不同后端复用登录令牌。

后端 V2Board 的站点 URL 应指向用户网站，以便续费和一次性网页登录链接进入正确网站；后端自身 `APP_URL` 使用后端地址。反向代理、TLS、支付回调、订阅路径仍由后端处理，需要按实际部署验证。

## 本地开发与运行配置

`npm run dev` 启动 Vite。用户入口为 `/`，后台入口为 `/admin.html`。没有 Laravel 页面注入时，需要对应的公开运行配置文件；可用导出命令生成，也可通过 `frontend/.env.local` 的 `VITE_CONFIG_URL` 指向本地配置。配置中没有 `landing` 时，用户 `/app` 自动进入账户页面。

`VITE_API_BASE_URL` 可作为后端地址默认值；集成部署默认继续使用同源 API。生产仅接受 HTTPS 后端来源，本地开发允许 localhost HTTP。`VITE_` 变量是公开配置，不能放密码、Token 或私钥。代码读取运行配置后才加载应用，配置错误会显示启动错误，不会默默切换应用模式。

公开配置导出和静态包是部署准备工具，不会上传文件或修改线上服务。
