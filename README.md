# PickPick

PickPick 是一个原生 HTML/CSS/JavaScript 实现的移动端 PWA，用于收藏、对比和记录自习室、咖啡馆等本地场所。

## 当前 MVP

- `Star`：搜索、查看、新建、编辑、删除场地，并加入 Pick。
- `Pick`：2.1 设置日期、出发地、候选场地和条件；2.2 粘贴渠道链接；2.3 静态地图、条件筛选、结果确认和收藏。
- `My`：月份日历、最近三条记录、记录本翻页、备注保存、图片压缩上传。
- AI、天气和地图均为 MVP 降级实现：AI 使用简单规则/手动补充，天气提示不可用，地图为静态占位。

## 本地运行

直接打开 `index.html` 可以查看页面。若要验证 PWA、Manifest 和 Service Worker，请用本地 HTTP 服务运行。

推荐使用 Node.js：

```powershell
npx http-server . -a 127.0.0.1 -p 4173 -c-1
```

然后访问 `http://127.0.0.1:4173/`。

如果没有 `http-server`，也可以使用任意静态服务器，只要从项目根目录提供 `index.html`、`manifest.json`、`sw.js` 和 `icons/`。

## 数据与缓存

- 数据保存在浏览器 `localStorage`，刷新页面后会保留。
- 首次打开会写入示例场地和一条示例历史记录。
- PWA 缓存名在 `sw.js` 的 `CACHE_NAME` 中维护。更新缓存后，强制刷新或关闭页面重开可获取新版文件。
- 若需要完全重置示例数据，可在浏览器开发者工具中清空该站点的 localStorage 和 Cache Storage。

## 验证清单

- 375px 宽度下检查 Star、Pick、My 三个 Tab 无横向溢出。
- 检查 Star 为空、Pick 候选不足、筛选无结果、My 历史为空时的空状态。
- 检查备注、渠道链接、场地数据刷新后仍能恢复。
- 检查源码中业务模块没有直接调用 `localStorage.getItem/setItem`，只允许在 `Storage` 模块内调用。

## 开发约束

- 不引入外部框架或 UI 库。
- 主要文件保持为 `index.html`、`manifest.json`、`sw.js` 和 `icons/icon.svg`。
- 所有持久化读写必须通过 `Storage` 模块。
- 新增功能优先沿用现有 `Storage`、`StarManager`、`PickManager`、`HistoryManager` 和 `UI` 结构。
