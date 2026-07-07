# PickPick

PickPick 是一个原生 HTML/CSS/JavaScript 实现的移动端 PWA，用于对比自习室、咖啡馆等本地场所。

## 本地运行

直接打开 `index.html` 可以查看基础页面。若要测试 PWA 和 Service Worker，请在本目录启动本地 HTTP 服务：

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

然后访问 `http://127.0.0.1:4173/`。

## 开发约束

- 不引入外部框架或 UI 库。
- 所有持久化读写必须通过 `Storage` 模块。
- MVP 使用 localStorage，AI、天气和地图均采用降级或占位实现。
