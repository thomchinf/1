# PickPick Extract Cloud Function

This folder stores the Tencent Cloud Web Function source for PickPick venue extraction.

## Runtime

- Tencent Cloud SCF Web Function
- Node.js 16.13
- Entry file: `app.js`
- Bootstrap command:

```bash
#!/bin/bash
export PORT=9000
exec /var/lang/node16/bin/node app.js
```

## Environment Variables

Do not commit real keys. Configure these in Tencent Cloud:

```text
JUSTONE_TOKEN
JUSTONE_SHARE_URL=https://api.justoneapi.com/api/xiaohongshu/share-url-transfer/v1
JUSTONE_NOTE_URL=https://api.justoneapi.com/api/xiaohongshu/get-note-detail/v1
JUSTONE_DIANPING_DETAIL_URL
IDATARIVER_API_KEY
IDATARIVER_DIANPING_NOTE_URL=https://apiok.us/api/a294/note/detail/v2
DIANPING_MOBILE_SERVICE_URL=https://1452700938-19erev13jl.ap-guangzhou.tencentscf.com
DEEPSEEK_API_KEY
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-chat
AMAP_KEY
AMAP_GEOCODE_URL=https://restapi.amap.com/v3/geocode/geo
AMAP_POI_URL=https://restapi.amap.com/v3/place/text
```

## Function URL

Current frontend endpoint:

```text
https://1452700938-gzyqz1yprr.ap-guangzhou.tencentscf.com
```

Recommended Tencent Function URL settings:

- Public access
- No authentication
- Methods: `GET, POST, OPTIONS`
- Timeout: at least `30s`
- CORS origin should include the local preview origin, for example `http://127.0.0.1:4187`

The frontend intentionally sends POST without a `Content-Type` header to avoid Function URL preflight issues during local development.

## Geocode Test

Paste this in the browser console. Keep it headerless, matching the frontend request style.

```js
fetch('https://1452700938-gzyqz1yprr.ap-guangzhou.tencentscf.com', {
  method: 'POST',
  body: JSON.stringify({
    type: 'geocode',
    address: '天津红桥区光荣道29号'
  })
})
  .then((response) => response.json())
  .then((result) => {
    console.log('geocode result:', JSON.stringify(result, null, 2));
    console.log('place:', result.data?.place);
    console.log('debug:', result.data?.debug);
  });
```
