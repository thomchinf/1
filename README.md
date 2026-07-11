# PickPick

PickPick 是一个原生 HTML/CSS/JavaScript 实现的移动端单页 PWA，用于收藏、补全、对比和记录自习室、咖啡馆等本地场所。

## 当前 MVP 能力

- `Star`：搜索、查看详情、新建、编辑、删除场地；从小红书/美团/高德等渠道粘贴信息；保存并提取字段；加入 Pick。
- `Star 1.2`：新建地点后进入信息补全页；支持保存、清空信息、链接/文本提取，并将确认后的地点保存到 Star 库。
- `Pick 2.1`：选择年月日、填写出发位置、查看天气、添加候选场地、设置筛选条件，并进入信息复制流程。
- `Pick 2.2`：按候选场地粘贴多条渠道链接或页面文本，调用后端提取能力补全场地信息。
- `Pick 2.3`：显示地图、出发点和候选场地位置；支持条件过滤、标签高亮/置灰、勾选展示、收藏到 Star。
- `My`：年月日历、长按日期上传日历照片、最近三条记录、记录本滑动翻页、记录照片压缩上传、备注保存。
- `PWA`：包含 manifest、图标、Service Worker、离线缓存和 Web Share Target 配置。

## 后端与 API

前端通过 `BackendClient` 调用腾讯云函数，当前云函数代码保存在 `cloud-functions/pick-extract/app.js`。

云函数当前承担：

- 小红书分享链接/笔记详情解析。
- DeepSeek 字段提取。
- 高德地理编码。
- 前端不可用时保留本地规则降级提取。

前端不要直接调用第三方 API Key。需要更换云函数地址时，只改 `BackendClient.endpoint`。

## 本地运行

直接打开 `index.html` 可以查看页面，但 PWA、Manifest、Service Worker、分享入口建议通过本地 HTTP 服务验证。

推荐使用 Node.js：

```powershell
npx http-server . -a 127.0.0.1 -p 4173 -c-1
```

然后访问：

```text
http://127.0.0.1:4173/
```

如果 4173 端口被占用，可以换成其他端口，例如：

```powershell
npx http-server . -a 127.0.0.1 -p 4187 -c-1
```

## PWA 验证

1. 访问 `http://127.0.0.1:4173/manifest.json`，确认能看到 JSON。
2. 在 Chrome/Edge 中打开 `http://127.0.0.1:4173/`。
3. 打开开发者工具，进入 `Application`。
4. 在 `Manifest` 中确认应用名、图标、启动地址和 Share Target 正常。
5. 在 `Service Workers` 中确认 `sw.js` 已注册并处于 activated 状态。
6. 在 `Cache Storage` 中确认存在 `pickpick-v6` 缓存。
7. 刷新页面后确认 Star、Pick、My 交互仍可用。

## 分享入口验证

浏览器手动构造 URL：

```text
http://127.0.0.1:4173/?title=测试地点&text=适合办公 有插座 10:00-21:00&url=https://example.com
```

预期：

- 页面进入 Star 1.2。
- 标题、文本、链接进入草稿信息。
- 点击保存后 Star 列表出现该地点。

## 数据与缓存

- 业务数据保存在浏览器 `localStorage`。
- 所有业务读写必须通过 `Storage` 模块。
- Service Worker 缓存版本在 `sw.js` 的 `CACHE_NAME` 中维护。
- 如果 PWA 更新后仍显示旧版本，可以在开发者工具中清空该站点的 `Cache Storage` 和 `localStorage` 后刷新。

## 手动回归清单

- Star：空状态、搜索、新建、1.2 补全、保存、清空、删除、加入 Pick。
- Pick 2.1：年月日选择、地址输入、天气反馈、添加地点、条件选择、进入 2.2。
- Pick 2.2：小红书/美团/高德入口、多链接粘贴、保存并提取、返回 2.1、进入 2.3。
- Pick 2.3：地图出发点、场地图标、勾选高亮、标签匹配、收藏到 Star。
- My：年月切换、点击日期、长按日期上传日历照片、记录本照片、备注保存、滑动翻页。
- 刷新恢复：刷新页面后 Star、Pick、My 数据应保留。
- 375px 宽度：底部导航、弹窗、按钮、输入框、卡片内容不横向溢出。

## 开发约束

- 不引入外部框架或 UI 库。
- MVP 主体仍保持 `index.html`、`manifest.json`、`sw.js`、`icons/` 的简单结构。
- 业务代码禁止直接调用 `localStorage.getItem/setItem`，只允许 `Storage` 模块调用。
- 新功能优先沿用现有 `Storage`、`StarManager`、`PickManager`、`HistoryManager`、`AIExtractor`、`WeatherService`、`MapView`、`BackendClient` 和 `UI` 结构。
