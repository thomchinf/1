from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

try:
    import jieba
except ImportError:
    jieba = None

from .models import Article
from .utils import normalize_title, split_sentences, text_contains_keywords, trim_text


# ============ V5.0：三层关键词配置 ============
INDUSTRY_KEYWORDS = [
    "电子商务", "智能汽车", "企业服务", "人工智能",
    "旅游出行", "生活服务", "文娱传媒", "硬科技", "新能源"
]

TOPIC_KEYWORDS = [
    "自动驾驶", "大模型", "SaaS", "数字化", "本地生活",
    "短视频", "直播", "动力电池", "光伏", "芯片", "半导体",
    "零售", "电商", "外卖", "出行", "酒店", "旅游", "AI", "云计算",
    "ERP", "CRM", "B2B", "社交", "内容", "传媒", "储能", "风电",
    "机器人", "智能座舱", "跨境", "出海", "直播带货",
    "即时零售", "到店", "到家", "网约车", "创新药", "医疗器械"
]

SIGNAL_KEYWORDS = [
    "融资", "并购", "收购", "裁员", "破产", "清算",
    "禁令", "制裁", "重大突破", "IPO", "上市",
    "财报发布", "高层变动", "董事长", "CEO"
]

# ============ V5.0：行业兜底关键词映射 ============
INDUSTRY_FALLBACK_MAP = {
    "电商": "电子商务", "零售": "电子商务", "购物": "电子商务",
    "淘宝": "电子商务", "京东": "电子商务", "拼多多": "电子商务",
    "SHEIN": "电子商务", "Temu": "电子商务",
    "自动驾驶": "智能汽车", "智能座舱": "智能汽车",
    "蔚来": "智能汽车", "理想": "智能汽车", "小鹏": "智能汽车",
    "小米汽车": "智能汽车", "特斯拉": "智能汽车",
    "SaaS": "企业服务", "PaaS": "企业服务", "钉钉": "企业服务",
    "企业微信": "企业服务", "飞书": "企业服务", "ERP": "企业服务", "CRM": "企业服务",
    "AI": "人工智能", "大模型": "人工智能", "深度学习": "人工智能",
    "ChatGPT": "人工智能", "OpenAI": "人工智能",
    "商汤": "人工智能", "智谱": "人工智能", "百川": "人工智能",
    "机票": "旅游出行", "酒店": "旅游出行", "携程": "旅游出行",
    "同程": "旅游出行", "飞猪": "旅游出行", "滴滴": "旅游出行", "哈啰": "旅游出行",
    "外卖": "生活服务", "到店": "生活服务", "到家": "生活服务",
    "美团": "生活服务", "饿了么": "生活服务", "58同城": "生活服务", "贝壳": "生活服务",
    "视频": "文娱传媒", "短视频": "文娱传媒", "抖音": "文娱传媒",
    "快手": "文娱传媒", "B站": "文娱传媒", "小红书": "文娱传媒",
    "直播": "文娱传媒", "社交": "文娱传媒",
    "芯片": "硬科技", "半导体": "硬科技", "通信": "硬科技",
    "机器人": "硬科技", "大疆": "硬科技", "中芯国际": "硬科技",
    "光伏": "新能源", "储能": "新能源", "动力电池": "新能源",
    "宁德时代": "新能源", "隆基": "新能源", "阳光电源": "新能源"
}

# ============ V5.0：内容类型推断关键词 ============
PRODUCT_TYPE_KEYWORDS = ["发布", "上线", "推出", "更新", "功能", "版本", "产品", "升级", "下架"]
COMPANY_TYPE_KEYWORDS = ["融资", "并购", "收购", "裁员", "破产", "高层变动", "CEO", "董事长"]
TREND_TYPE_KEYWORDS = ["趋势", "数据", "报告", "规模", "增速", "渗透率", "预测", "展望", "行业", "市场"]

# ============ V5.0：9个行业配置 ============
INDUSTRIES = [
    {"key": "e_commerce", "name": "电子商务", "level": 1},
    {"key": "smart_car", "name": "智能汽车", "level": 1},
    {"key": "enterprise", "name": "企业服务", "level": 1},
    {"key": "ai", "name": "人工智能", "level": 1},
    {"key": "travel", "name": "旅游出行", "level": 2},
    {"key": "life_service", "name": "生活服务", "level": 2},
    {"key": "entertainment", "name": "文娱传媒", "level": 2},
    {"key": "hard_tech", "name": "硬科技", "level": 3},
    {"key": "new_energy", "name": "新能源", "level": 3},
]

# ============ 中间方案：标签池 ============
TAG_POOL = [
    "政策发布", "宏观经济", "监管动向", "国际关系",
    "行业趋势", "竞争格局", "供应链变化", "技术路线",
    "公司战略", "产品发布", "人事变动", "财报数据",
    "融资动态", "合作签约", "合规风险", "社会责任"
]

# ============ 中间方案：标签→维度映射 ============
TAG_TO_DIMENSION = {
    # 宏观 (Macro)
    "政策发布": "macro", "宏观经济": "macro", "监管动向": "macro", "国际关系": "macro",
    # 中观 (Meso)
    "行业趋势": "meso", "竞争格局": "meso", "供应链变化": "meso", "技术路线": "meso",
    # 微观 (Micro)
    "公司战略": "micro", "产品发布": "micro", "人事变动": "micro",
    "财报数据": "micro", "融资动态": "micro", "合作签约": "micro",
    "合规风险": "micro", "社会责任": "micro"
}

SECTION_KEYS = [
    "ai_application",
    "ai_model",
    "ai_safety",
    "ai_investment",
    "research_paper",
]

VENUE_KEYWORDS = ["neurips", "icml", "cvpr", "iclr", "aaai", "acl", "emnlp", "arxiv"]

# ============ 中间方案：去重历史文件 ============
HISTORY_FILE = Path("output/history_titles.json")


def should_keep_article(article: Article, filtering: dict[str, Any], assume_relevant: bool) -> bool:
    """V5.0：四步优先级过滤逻辑"""
    # 排除关键词
    exclude_keywords = filtering.get("exclude_keywords", [])
    text = f"{article.title} {article.snippet} {article.body_text[:200]}".casefold()
    if any(keyword.casefold() in text for keyword in exclude_keywords):
        return False

    if article.forced_category or assume_relevant:
        return True

    # 步骤①：信号词命中（无视时效）
    if any(sig in text for sig in SIGNAL_KEYWORDS):
        return True

    # 步骤②：行业关键词命中
    if any(ind in text for ind in INDUSTRY_KEYWORDS):
        return True

    # 步骤③：行业关键词 + 主题词组合
    has_industry = any(ind in text for ind in INDUSTRY_KEYWORDS)
    has_topic = any(tp in text for tp in TOPIC_KEYWORDS)
    if has_industry and has_topic:
        return True

    # 步骤④：以上均不满足，丢弃
    return False


def deduplicate_articles(articles: list[Article]) -> list[Article]:
    """中间方案：MD5指纹 + Jaccard相似度双层去重"""
    unique: list[Article] = []
    normalized_titles: list[str] = []
    seen_urls: set[str] = set()

    ordered = sorted(
        articles,
        key=lambda item: (item.source_weight, len(item.body_text), item.importance_score),
        reverse=True,
    )

    for article in ordered:
        normalized = normalize_title(article.title)
        if article.url in seen_urls:
            continue
        if not normalized:
            continue
        if normalized in normalized_titles:
            continue

        if any(SequenceMatcher(None, normalized, prior).ratio() >= 0.93 for prior in normalized_titles):
            continue

        normalized_titles.append(normalized)
        seen_urls.add(article.url)
        unique.append(article)

    return unique


def load_history() -> list[dict]:
    """加载去重历史记录"""
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_history(history: list[dict]) -> None:
    """保存去重历史记录（只保留最近500条）"""
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history[-500:], f, ensure_ascii=False)


def is_duplicate_by_history(title: str, history: list[dict], threshold: float = 0.85) -> bool:
    """中间方案：检查是否与历史文章重复"""
    # 第一层：MD5精确指纹
    fingerprint = hashlib.md5(title.encode("utf-8")).hexdigest()
    if any(h.get("fp") == fingerprint for h in history):
        return True

    # 第二层：Jaccard相似度（用jieba分词）
    if jieba is None:
        return False

    try:
        words1 = set(jieba.cut(title))
    except Exception:
        words1 = set(title)

    # 只比较最近50条，节省CPU
    for item in history[-50:]:
        try:
            words2 = set(item.get("words", []))
            if not words2:
                continue
            intersection = len(words1 & words2)
            union = len(words1 | words2)
            if union > 0 and intersection / union > threshold:
                return True
        except Exception:
            continue

    return False


def update_history(articles: list[Article]) -> None:
    """更新去重历史记录"""
    history = load_history()
    for art in articles:
        try:
            words = list(jieba.cut(art.title)) if jieba else []
        except Exception:
            words = []
        history.append({
            "fp": hashlib.md5(art.title.encode("utf-8")).hexdigest(),
            "words": words,
            "date": art.published_at.isoformat() if art.published_at else None
        })
    save_history(history)


def infer_category(article: Article, filtering: dict[str, Any]) -> str:
    if article.forced_category:
        return article.forced_category

    category_keywords = filtering.get("category_keywords", {})
    text = f"{article.title} {article.summary} {article.body_text} {article.snippet}".casefold()
    headline_text = f"{article.title} {article.snippet}".casefold()
    scores = {
        key: text_contains_keywords(text, keywords)
        for key, keywords in category_keywords.items()
        if key in SECTION_KEYS
    }

    paper_signal = text_contains_keywords(
        text,
        ["论文", "paper", "arxiv", "neurips", "icml", "cvpr", "iclr", "aaai", "acl", "emnlp"],
    )
    headline_paper_signal = text_contains_keywords(
        headline_text,
        ["论文", "paper", "arxiv", "neurips", "icml", "cvpr", "iclr", "aaai", "acl", "emnlp"],
    )
    investment_signal = text_contains_keywords(
        text,
        [
            "融资",
            "投资",
            "并购",
            "收购",
            "上市",
            "funding",
            "acquisition",
            "valuation",
            "series a",
            "series b",
            "seed",
            "raise",
            "raises",
            "raised",
            "investor",
            "investors",
            "backed",
            "backs",
            "deal",
            "m&a",
        ],
    )
    headline_investment_signal = text_contains_keywords(
        headline_text,
        [
            "融资",
            "投资",
            "并购",
            "收购",
            "上市",
            "funding",
            "acquisition",
            "valuation",
            "series a",
            "series b",
            "seed",
            "raise",
            "raises",
            "raised",
            "investor",
            "investors",
            "backed",
            "backs",
            "deal",
            "m&a",
        ],
    )

    if any(keyword in text for keyword in VENUE_KEYWORDS):
        scores["research_paper"] = scores.get("research_paper", 0) + 3

    if (
        "融资" in text
        or "investment" in text
        or "funding" in text
        or "acquisition" in text
        or "raise" in text
        or "raised" in text
        or "investor" in text
        or "backed" in text
        or "m&a" in text
    ):
        scores["ai_investment"] = scores.get("ai_investment", 0) + 2

    if "安全" in text or "safety" in text or "security" in text or "policy" in text:
        scores["ai_safety"] = scores.get("ai_safety", 0) + 2

    if paper_signal == 0 or headline_paper_signal == 0:
        scores["research_paper"] = 0
    if investment_signal < 2 or headline_investment_signal == 0:
        scores["ai_investment"] = 0

    category = max(scores.items(), key=lambda item: item[1])[0] if scores else "ai_model"
    return category if scores.get(category, 0) > 0 else "ai_model"


# ============ 中间方案：标签推断函数 ============
def infer_tag(article: Article) -> str:
    """根据文章内容推断最匹配的标签（从TAG_POOL中选择）"""
    text = f"{article.title} {article.snippet}".casefold()

    # 关键词→标签映射
    keyword_to_tag = {
        "政策": "政策发布", "监管": "监管动向", "法规": "监管动向", "关税": "监管动向",
        "宏观经济": "宏观经济", "经济": "宏观经济",
        "国际关系": "国际关系", "外交": "国际关系", "贸易战": "国际关系",
        "趋势": "行业趋势", "行业": "行业趋势", "市场": "行业趋势",
        "竞争": "竞争格局", "格局": "竞争格局", "市场份额": "竞争格局",
        "供应链": "供应链变化", "产业链": "供应链变化",
        "技术": "技术路线", "研发": "技术路线", "突破": "技术路线",
        "战略": "公司战略", "布局": "公司战略", "转型": "公司战略",
        "产品": "产品发布", "发布": "产品发布", "推出": "产品发布",
        "人事": "人事变动", "任命": "人事变动", "离职": "人事变动", "CEO": "人事变动", "董事长": "人事变动",
        "财报": "财报数据", "营收": "财报数据", "业绩": "财报数据", "亏损": "财报数据",
        "融资": "融资动态", "投资": "融资动态", "并购": "融资动态", "收购": "融资动态", "IPO": "融资动态", "上市": "融资动态",
        "合作": "合作签约", "签约": "合作签约", "战略合作": "合作签约",
        "合规": "合规风险", "风险": "合规风险", "审查": "合规风险", "调查": "合规风险",
        "社会责任": "社会责任", "ESG": "社会责任", "公益": "社会责任",
    }

    for keyword, tag in keyword_to_tag.items():
        if keyword in text:
            return tag

    # 兜底：返回默认标签
    return "行业趋势"


def get_dimension_from_tags(tags: list[str]) -> str:
    """根据标签列表获取维度（macro/meso/micro）"""
    for tag in tags:
        dimension = TAG_TO_DIMENSION.get(tag)
        if dimension:
            return dimension
    return "meso"  # 默认归入中观


def score_article(article: Article, filtering: dict[str, Any]) -> float:
    now = datetime.now(timezone.utc)
    score = article.source_weight * 35
    reference_text = f"{article.title} {article.summary} {article.body_text} {article.snippet}"

    for key, keywords in filtering.get("category_keywords", {}).items():
        if key in SECTION_KEYS:
            score += min(text_contains_keywords(reference_text, keywords), 4) * 2

    if article.published_at:
        published_at = article.published_at if article.published_at.tzinfo else article.published_at.replace(tzinfo=timezone.utc)
        age_hours = max((now - published_at).total_seconds() / 3600, 0)
        if age_hours <= 24:
            score += 25
        elif age_hours <= 72:
            score += 15
        elif age_hours <= 168:
            score += 8

    score += min(len(article.body_text) / 400, 10)
    score += min(len(article.key_points), 4) * 2

    if article.category == "ai_investment":
        score += 6
    if article.category == "research_paper":
        score += 4

    return round(score, 2)


def build_fallback_summary(
    article: Article,
    min_chars: int = 100,
    max_chars: int = 300,
) -> tuple[str, list[str]]:
    source_text = article.body_text or article.snippet or article.title
    sentences = split_sentences(source_text, limit=8)
    if not sentences:
        return trim_text(article.title, max_chars), [trim_text(article.title, 60)]

    selected_sentences: list[str] = []
    current_length = 0
    for sentence in sentences:
        selected_sentences.append(sentence)
        current_length = len("；".join(selected_sentences))
        if current_length >= min_chars:
            break
    if not selected_sentences:
        selected_sentences = sentences[:2]

    summary = "；".join(selected_sentences).strip("；")
    if not summary.endswith(("。", "！", "？")):
        summary += "。"

    key_points = [trim_text(sentence, 48) for sentence in sentences[:3]]
    return trim_text(summary, max_chars), key_points


def extract_finance_info(article: Article) -> dict[str, str]:
    text = f"{article.title} {article.body_text} {article.summary}"
    amount_pattern = re.compile(
        r"((?:\d+(?:\.\d+)?)\s*(?:亿美元|万美元|亿元|万元|万美金|million|billion|M|B))",
        flags=re.IGNORECASE,
    )
    round_pattern = re.compile(
        r"(天使轮|种子轮|Pre-A|Pre-B|A\+?轮|B\+?轮|C\+?轮|D\+?轮|战略融资|并购|收购|IPO|Series\s+[A-Z])",
        flags=re.IGNORECASE,
    )
    investor_pattern = re.compile(
        r"(?:由|获|led by)\s*([^，。；;]{2,60})(?:领投|投资|参投|invest)",
        flags=re.IGNORECASE,
    )

    company = article.title.split("：")[0].split(":")[0].strip()
    info = {
        "company": trim_text(company, 30),
        "amount": "",
        "round": "",
        "investors": "",
        "business": trim_text(article.summary or article.snippet, 50),
    }

    amount_match = amount_pattern.search(text)
    round_match = round_pattern.search(text)
    investor_match = investor_pattern.search(text)

    if amount_match:
        info["amount"] = amount_match.group(1)
    if round_match:
        info["round"] = round_match.group(1)
    if investor_match:
        info["investors"] = trim_text(investor_match.group(1), 30)
    return info


def extract_paper_info(article: Article) -> dict[str, str]:
    text = f"{article.title} {article.body_text} {article.summary}".casefold()
    venue = next((keyword.upper() for keyword in VENUE_KEYWORDS if keyword in text), "arXiv" if "arxiv" in text else "")
    takeaways = split_sentences(article.summary or article.body_text or article.snippet, limit=2)
    return {
        "venue": venue,
        "institution": "",
        "takeaway": trim_text("；".join(takeaways), 60),
    }


# ============ V5.0：兜底推断函数 ============
def infer_industry_fallback(article: Article) -> str:
    """根据标题关键词兜底推断行业"""
    text = f"{article.title} {article.snippet}".casefold()
    for keyword, industry in INDUSTRY_FALLBACK_MAP.items():
        if keyword in text:
            return industry
    return "其他"


def infer_entity_fallback(article: Article, industry: str) -> str:
    """根据标题兜底推断主体（公司名/产品名），匹配不到则用行业名"""
    # 公司名列表（常见大公司）
    company_keywords = [
        "阿里巴巴", "腾讯", "字节跳动", "华为", "比亚迪", "宁德时代",
        "美团", "拼多多", "小米", "SHEIN", "Temu", "京东", "抖音",
        "蔚来", "理想", "小鹏", "特斯拉", "小米汽车",
        "阿里云", "钉钉", "企业微信", "飞书",
        "商汤", "智谱", "百川", "OpenAI", "ChatGPT",
        "携程", "同程", "飞猪", "滴滴", "哈啰",
        "美团", "饿了么", "58同城", "贝壳",
        "抖音", "快手", "B站", "小红书",
        "大疆", "中芯国际",
        "宁德时代", "隆基", "阳光电源"
    ]
    for company in company_keywords:
        if company in article.title:
            return company
    return industry


def infer_content_type(article: Article) -> str:
    """V5.0：推断内容类型（产品动态/公司动态/行业趋势）"""
    text = article.title.casefold()

    # 优先级1：产品词 → 产品动态
    if any(kw in text for kw in PRODUCT_TYPE_KEYWORDS):
        return "product"

    # 优先级2：公司名 → 公司动态
    company_keywords = [
        "阿里巴巴", "腾讯", "字节跳动", "华为", "比亚迪", "宁德时代",
        "美团", "拼多多", "小米", "SHEIN", "Temu", "京东", "抖音",
        "蔚来", "理想", "小鹏", "特斯拉", "小米汽车",
        "阿里云", "钉钉", "企业微信", "飞书",
        "商汤", "智谱", "百川", "OpenAI", "ChatGPT",
        "携程", "同程", "飞猪", "滴滴", "哈啰",
        "美团", "饿了么", "58同城", "贝壳",
        "抖音", "快手", "B站", "小红书",
        "大疆", "中芯国际",
        "宁德时代", "隆基", "阳光电源"
    ]
    if any(company in article.title for company in company_keywords):
        return "company"

    # 优先级3：宏观词 → 行业趋势
    if any(kw in text for kw in TREND_TYPE_KEYWORDS):
        return "trend"

    # 兜底：行业趋势
    return "trend"
