# PickPick Dianping Mobile Detail Function

这是 PickPick 的独立大众点评移动详情页解析服务，用于部署为腾讯云 Python Web 函数。

当前只提供一个接口：

```http
POST /dianping/mobile-detail
Content-Type: application/json
```

请求体支持两种格式。

格式一：完整 cURL，适合直接测试 Python 服务：

```json
{
  "curlText": "从大众点评移动详情页复制的 Copy as cURL(cmd) 完整内容"
}
```

格式二：精简请求，适合由 PickPick 主 Node.js 云函数转发：

```json
{
  "url": "https://m.dianping.com/shop/xxx",
  "headers": {
    "Cookie": "从 cURL 中提取的 Cookie",
    "User-Agent": "从 cURL 中提取的 User-Agent",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://m.dianping.com/"
  }
}
```

返回：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "shop": {
      "provider": "dianping-mobile",
      "sourceUrl": "https://m.dianping.com/shop/xxx",
      "shopId": "xxx",
      "name": "",
      "rating": "",
      "reviewCount": "",
      "avgPriceText": "",
      "scoreDetail": "",
      "category": "",
      "area": "",
      "rankText": "",
      "statusText": "",
      "hours": "",
      "address": "",
      "distanceText": "",
      "services": [],
      "recommendedDishes": [],
      "images": []
    },
    "debug": {}
  }
}
```

## 腾讯云部署操作清单

1. 进入腾讯云控制台。
2. 搜索并进入 `云函数 SCF`。
3. 进入函数列表后，选择和 PickPick 主函数相同的地域，例如 `广州`。
4. 点击 `新建` 或 `新建函数`。
5. 创建方式选择 `从头开始`。
6. 函数类型选择 `Web 函数`。
7. 函数名称填写 `pickpick-dianping-mobile-detail`。
8. 运行环境选择 Python 版本；如果有 `Python 3.10` 优先选 `Python 3.10`，没有就选控制台可用的 Python 3 版本。
9. 提交方法选择 `本地上传文件夹` 或 `在线编辑`。
10. 如果是上传文件夹，上传本目录内的三个文件：`app.py`、`scf_bootstrap`、`requirements.txt`。
11. 如果是在线编辑，创建并粘贴这三个文件，文件名必须保持一致。
12. 确认 `scf_bootstrap` 内容为：

```bash
#!/bin/bash
python3 app.py
```

13. 函数规格先保持默认即可；建议内存 `256MB` 或更高，超时时间设置为 `30 秒`。
14. 触发方式使用 `函数 URL`。
15. 函数 URL 访问类型选择 `公网`。
16. 鉴权方式选择 `免鉴权`、`关闭鉴权` 或 `公开访问`。
17. CORS 开启。
18. 允许方法填写或勾选 `GET,POST,OPTIONS`。
19. 允许 Origin 填写你的前端地址，例如 `http://127.0.0.1:4187`；如果控制台允许，也可以先填正式部署域名。
20. 允许 Header 填写 `content-type`。如果控制台不接受大小写，使用全小写。
21. 保存触发器配置。
22. 点击 `部署` 或 `保存并部署`。
23. 部署完成后，进入函数 URL 或触发器信息页，复制公网 URL。
24. 先在浏览器打开：

```text
你的函数URL/health
```

25. 如果返回下面内容，说明服务启动成功：

```json
{"code":0,"msg":"ok","data":{"service":"dianping-mobile-detail"}}
```

26. 把公网 URL 发给 CodeX，下一步再接入 Node.js 主服务。

## 注意

- 这个函数不保存 Cookie。
- `curlText` 内会包含 Cookie，只建议你自己本地或自己的云函数使用。
- PickPick 前端会把完整 cURL 压缩成 `url + headers` 再发给主云函数，避免腾讯云函数入口出现 `RequestTooLarge`。
