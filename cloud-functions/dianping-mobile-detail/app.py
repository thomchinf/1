import json
import os
import re
import shlex
import socket
import http.client
import urllib.error
import urllib.request
from html import unescape
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


PORT = int(os.environ.get("PORT") or "9000")
VERSION = "force-utf8-partial-20260715"


class VisibleTextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip_stack = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip_stack.append(tag)
        if tag in ("br", "p", "div", "li", "section", "article", "h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if self.skip_stack and self.skip_stack[-1] == tag:
            self.skip_stack.pop()
        if tag in ("p", "div", "li", "section", "article", "h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_data(self, data):
        if self.skip_stack:
            return
        text = normalize_space(data)
        if text:
            self.parts.append(text)

    def text(self):
        return "\n".join(self.parts)


def normalize_space(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def mojibake_score(value):
    text = str(value or "")
    suspicious = (
        "锛銆鐢鍦鍚鍜浜楼绗涓浼惀闂緤鐤鎰忓紡鍏嶈垂"
        "鍙瀹墿鎷搧婢濈編寮暋楀競琛浼亾氬甫鏃堕棿"
        "璇勫垎鏈嶅姟姒滃崟"
    )
    pua_count = len(re.findall(r"[\ue000-\uf8ff]", text))
    suspicious_count = sum(text.count(char) for char in suspicious)
    return suspicious_count * 20 + pua_count * 40 + text.count("\ufffd") * 20 + text.count("锟斤拷") * 80


def repair_mojibake_text(value):
    text = str(value or "")
    if not text or mojibake_score(text) <= 0:
        return text

    best = text
    best_score = mojibake_score(text)
    for encoding in ("gb18030", "gbk"):
        try:
            fixed = text.encode(encoding, errors="replace").decode("utf-8", errors="replace")
        except (LookupError, UnicodeError):
            continue
        score = mojibake_score(fixed)
        if score < best_score:
            best = fixed
            best_score = score
    return best


def repair_mojibake(value):
    if isinstance(value, str):
        return repair_mojibake_text(value)
    if isinstance(value, list):
        return [repair_mojibake(item) for item in value]
    if isinstance(value, dict):
        return {key: repair_mojibake(item) for key, item in value.items()}
    return value


def first_match(text, patterns):
    for pattern in patterns:
        match = re.search(pattern, text, re.S)
        if match:
            return normalize_space(match.group(1))
    return ""


def parse_curl_cmd(text):
    cleaned = str(text or "").replace("^\r\n", " ").replace("^\n", " ").replace("^", "")
    tokens = shlex.split(cleaned, posix=False)
    url = ""
    headers = {}
    i = 0
    while i < len(tokens):
        token = tokens[i].strip()
        lowered = token.lower()
        unquoted = token.strip('"')
        if lowered in ("curl", "curl.exe"):
            i += 1
            continue
        if unquoted.startswith(("http://", "https://")) and not url:
            url = unquoted
            i += 1
            continue
        if lowered in ("-h", "--header") and i + 1 < len(tokens):
            header = tokens[i + 1].strip().strip('"')
            if ":" in header:
                key, value = header.split(":", 1)
                headers[key.strip()] = value.strip()
            i += 2
            continue
        if lowered in ("-b", "--cookie") and i + 1 < len(tokens):
            headers["Cookie"] = tokens[i + 1].strip().strip('"')
            i += 2
            continue
        i += 1
    return url, sanitize_headers(headers)


def sanitize_headers(headers):
    output = {}
    skip = {"host", "connection", "content-length", "accept-encoding"}
    for key, value in (headers or {}).items():
        clean_key = str(key or "").strip()
        if not clean_key or clean_key.lower() in skip:
            continue
        clean_value = str(value or "").strip()
        clean_value = re.sub(r"\s+", " ", clean_value)
        clean_value = re.sub(r"\^([%#@&|<>()\"'])", r"\1", clean_value)
        clean_value = clean_value.replace('\\"', '"').strip()
        if clean_value:
            output[clean_key] = clean_value
    if "User-Agent" not in output and "user-agent" not in {key.lower() for key in output}:
        output["User-Agent"] = (
            "Mozilla/5.0 (Linux; Android 15; Pixel 9) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/150.0.0.0 Mobile Safari/537.36"
        )
    return output


def get_compact_request(payload):
    curl_text = str(payload.get("curlText") or payload.get("curl") or "").strip()
    if curl_text:
        url, headers = parse_curl_cmd(curl_text)
        return url, headers, "curlText"

    mobile = payload.get("dianpingMobile") if isinstance(payload.get("dianpingMobile"), dict) else {}
    url = str(payload.get("url") or mobile.get("url") or "").strip()
    headers = {}

    for source in (mobile.get("headers"), payload.get("headers")):
        if isinstance(source, dict):
            headers.update(source)

    cookie = payload.get("cookie") or mobile.get("cookie")
    if cookie:
        headers["Cookie"] = cookie

    user_agent = payload.get("userAgent") or mobile.get("userAgent")
    if user_agent:
        headers["User-Agent"] = user_agent

    return url, sanitize_headers(headers), "compact"


def get_between_list(lines, start_markers, end_markers, max_items=30):
    start = -1
    for index, line in enumerate(lines):
        if line in start_markers:
            start = index + 1
            break
    if start < 0:
        return []
    output = []
    stop_words = set(end_markers)
    for line in lines[start:]:
        if line in stop_words:
            break
        if re.search(r"^\(?\d+\)?$|^\d+人推荐$|^查看更多$|^网友推荐$|^到店$", line):
            continue
        if re.search(r"菜单\(\d+\)|大众点评|App内打开|团购|买单", line):
            break
        if line and line not in output:
            output.append(line)
        if len(output) >= max_items:
            break
    return output


def extract_images(html):
    urls = re.findall(r"https?://[^\"'\s;)]+?\.(?:jpg|jpeg|png|webp)(?:[@%?][^\"'\s;)]*)?", html, re.I)
    cleaned = []
    for url in urls:
        url = unescape(url).replace("\\u002F", "/").strip()
        url = re.split(r"(?:\);|;|&quot;)", url)[0].strip()
        if "base64" in url or "data:image" in url:
            continue
        if any(token in url for token in ["dpfile.com/app", "travelcube", "dpmobile/", "scarlett/", "dpgroup/", "ingee/"]):
            continue
        if not any(token in url for token in ["biztone/", "qcloud.dpfile.com/pc/", "ugcshaitu/", "msmerchant/"]):
            continue
        if url not in cleaned:
            cleaned.append(url)
    return cleaned[:24]


def html_to_lines(html):
    parser = VisibleTextParser()
    parser.feed(html)
    raw_lines = parser.text().split("\n")
    lines = [normalize_space(unescape(line)) for line in raw_lines]
    return [line for line in lines if line]


def parse_mobile_detail(html, source_url):
    lines = html_to_lines(html)
    joined = "\n".join(lines)
    title = first_match(html, [r"<title[^>]*>(.*?)</title>"])
    title = normalize_space(unescape(re.sub(r"<[^>]+>", "", title)))
    shop_id = first_match(source_url, [r"/shop/([^/?#]+)"])

    name = ""
    if title.startswith("【") and "】" in title:
        name = title.split("】", 1)[0].replace("【", "").strip()
    if not name:
        name = first_match(joined, [r"输入商户名\n打开App\n\d+\n([^\n]+)"])

    rating = ""
    for index, line in enumerate(lines):
        if re.fullmatch(r"\d(?:\.\d)?", line) and index + 1 < len(lines) and re.search(r"\d+条", lines[index + 1]):
            rating = line
            break

    review_count = first_match(joined, [r"\n(\d+条)\n[¥￥]\d+/人", r"\n(\d+条评价)\n"])
    avg_price = first_match(joined, [r"\n([¥￥]\d+/人)\n", r"人均[:：]?\s*([¥￥]?\d+/人)"])
    score_detail = first_match(joined, [r"\n(口味:[^\n]+服务:[^\n]+)\n"])
    area = ""
    category = ""
    if score_detail and score_detail in lines:
        score_index = lines.index(score_detail)
        area = lines[score_index + 1] if score_index + 1 < len(lines) else ""
        category = lines[score_index + 2] if score_index + 2 < len(lines) else ""

    rank_text = first_match(joined, [r"\n([^\n]+榜 · 第\d+名)\n"])
    status_text = first_match(joined, [r"\n(营业中|休息中|暂停营业)\n"])
    hours = ""
    if status_text and status_text in lines:
        status_index = lines.index(status_text)
        if status_index + 1 < len(lines) and re.search(r"\d{1,2}:\d{2}", lines[status_index + 1]):
            hours = lines[status_index + 1]
    if not hours:
        hours = first_match(joined, [r"\n(\d{1,2}:\d{2}-\d{1,2}:\d{2})\n"])

    services = []
    if hours and hours in lines:
        start = lines.index(hours) + 1
        for line in lines[start:start + 8]:
            if re.search(r"路|道|街|号|交口|底商|距地铁|到店|推荐菜", line):
                break
            if line:
                services.append(line)

    address = ""
    for line in lines:
        if re.search(r"(路|街|号|交口|底商|大厦|广场|中心|商场)", line) and not re.search(r"榜|团购|电话_地址|距地铁|沿线|第\d+名", line):
            address = line
            break

    distance_text = first_match(joined, [r"\n(距[^\n]+)\n"])
    recommended_dishes = get_between_list(
        lines,
        ["推荐菜"],
        ["菜单(2)", "菜单", "大众点评 App内打开", "评价", "团购"],
        max_items=30,
    )

    return repair_mojibake({
        "provider": "dianping-mobile",
        "sourceUrl": source_url,
        "shopId": shop_id,
        "name": name,
        "rating": rating,
        "reviewCount": review_count,
        "avgPriceText": avg_price,
        "scoreDetail": score_detail,
        "category": category,
        "area": area,
        "rankText": rank_text,
        "statusText": status_text,
        "hours": hours,
        "address": address,
        "distanceText": distance_text,
        "services": services,
        "recommendedDishes": recommended_dishes,
        "images": extract_images(html),
        "debug": {
            "title": title,
            "lineCount": len(lines),
        },
    })


def decode_response_body(body, declared_charset=""):
    return body.decode("utf-8", errors="replace"), "utf-8"


def fetch_text(url, headers):
    request = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=20) as response:
        read_error = ""
        try:
            body = response.read()
        except http.client.IncompleteRead as error:
            body = error.partial or b""
            read_error = f"IncompleteRead: {len(body)} bytes read"
        charset = response.headers.get_content_charset() or ""
        text, encoding = decode_response_body(body, charset)
        return response.status, response.geturl(), text, encoding, read_error


def response_json(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        response_json(self, 200, {"code": 0, "msg": "ok", "data": None})

    def do_GET(self):
        if self.path == "/health":
            response_json(self, 200, {"code": 0, "msg": "ok", "data": {"service": "dianping-mobile-detail", "version": VERSION}})
            return
        response_json(self, 404, {"code": 404, "msg": "not found", "data": None})

    def do_POST(self):
        if self.path.rstrip("/") != "/dianping/mobile-detail":
            response_json(self, 404, {"code": 404, "msg": "not found", "data": None})
            return
        raw_body = self.rfile.read(int(self.headers.get("Content-Length") or "0")).decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw_body or "{}")
        except json.JSONDecodeError:
            response_json(self, 400, {"code": 400, "msg": "invalid json", "data": None})
            return

        url, headers, request_mode = get_compact_request(payload)
        debug = {
            "url": url,
            "requestMode": request_mode,
            "hasCookie": any(key.lower() == "cookie" for key in headers),
            "headerNames": list(headers.keys()),
            "statusCode": None,
            "finalUrl": "",
            "decodedEncoding": "",
            "readError": "",
            "error": "",
        }
        if not url:
            debug["error"] = "empty url"
            response_json(self, 400, {"code": 400, "msg": "missing url or curlText", "data": {"shop": None, "debug": debug}})
            return

        try:
            status_code, final_url, html, decoded_encoding, read_error = fetch_text(url, headers)
            debug["statusCode"] = status_code
            debug["finalUrl"] = final_url
            debug["decodedEncoding"] = decoded_encoding
            debug["readError"] = read_error
            shop = parse_mobile_detail(html, final_url)
            response_json(self, 200, {"code": 0, "msg": "ok", "data": {"shop": shop, "debug": debug}})
        except urllib.error.HTTPError as error:
            debug["statusCode"] = error.code
            debug["finalUrl"] = error.geturl()
            debug["error"] = f"HTTPError: {error.code}"
            response_json(self, 200, {"code": 0, "msg": "request failed", "data": {"shop": None, "debug": debug}})
        except (urllib.error.URLError, socket.timeout, TimeoutError, Exception) as error:
            debug["error"] = f"{type(error).__name__}: {str(error)[:300]}"
            response_json(self, 200, {"code": 0, "msg": "request error", "data": {"shop": None, "debug": debug}})

    def log_message(self, format, *args):
        return


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"dianping mobile detail service listening on 0.0.0.0:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
