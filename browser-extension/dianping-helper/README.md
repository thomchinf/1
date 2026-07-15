# PickPick Dianping Helper

这是 PickPick 的大众点评浏览器扩展 MVP，用于替代手动复制 `Copy as cURL(cmd)`。

## 当前能力

- 在大众点评店铺详情页识别店铺 URL。
- 自动读取当前浏览器里的大众点评 Cookie。
- 自动构造 `url + headers` 精简请求。
- 调用 PickPick 主云函数提取店铺信息。
- 展示名称、地址、时间、价格、分类、菜品和图片数量。
- 支持复制完整 JSON 或纯文本结果。
- 支持发送到已打开的 PickPick 页面，自动填入当前 Star 1.2 或 Pick 2.2 场地。

## 安装

1. 打开 Chrome 或 Edge。
2. 进入扩展管理页：
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本目录：

```text
D:\Desktop\pickpick-dianping-helper
```

## 使用

1. 登录大众点评。
2. 打开某个店铺详情页，例如：

```text
https://www.dianping.com/shop/xxxx
```

或：

```text
https://m.dianping.com/shop/xxxx
```

3. 点击浏览器工具栏里的 `PickPick Dianping Helper`。
4. 点击“提取当前店铺”。
5. 结果正常后，点击“发送到 PickPick”。
6. 如果 PickPick 是通过本地文件 `file:///.../index.html` 打开的，需要在扩展详情里开启“允许访问文件网址”。
7. 也可以点击“复制 JSON”或“复制文本”作为兜底。

## 注意

- 这个 MVP 不保存 Cookie，只在点击提取时读取并发送给自己的 PickPick 云函数。
- 如果大众点评要求验证，需要先在浏览器里完成验证，再点击提取。
- 第一阶段先不自动回填 PickPick 当前页面；下一阶段再接入“发送到当前 Star/Pick”。
