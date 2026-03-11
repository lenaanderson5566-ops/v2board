# frontend-next

这是基于现有 `public/theme/d1/assets/res_*.js` 编译产物，重建出的可维护前端源码骨架（现代栈）。

## 技术栈
- Vite 5
- React 18
- 原生 React 组件（不依赖 Ant Design / 阿里系组件库）

## 启动
```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4173
```

## 构建
```bash
npm run build
```

## API
默认请求：`/api/v1/user/getSubscribe`

可通过环境变量覆盖后端前缀：
```bash
VITE_API_BASE=https://your-domain.com npm run dev
```
