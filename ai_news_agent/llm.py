from __future__ import annotations

import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from pydantic import BaseModel, Field

from .filters import infer_industry_fallback, infer_entity_fallback, infer_content_type
from .models import Article
from .utils import extract_json_objects, split_sentences, trim_text

try:
    import dashscope
except ImportError:  # pragma: no cover
    dashscope = None


# ============ V5.0：LLM输出Schema ============
class ArticleAnalysis(BaseModel):
    """V5.0：LLM分析输出Schema"""
    industry: str = Field(description="行业分类，必须是9个行业之一")
    entity: str = Field(description="核心公司名或产品名")
    summary: str = Field(description="100-200字中文摘要")
    importance_score: int = Field(description="重要性评分0-100", ge=0, le=100)


# ============ V5.0：辅助函数 ============
def clean_entity(entity: str, industry: str) -> str:
    """清洗entity字段，移除无效字符和格式"""
    # 1. 空值检查
    if not entity or entity in ("无", "None", "null", ""):
        return industry

    # 2. 去除首尾空白
    entity = entity.strip()

    # 3. 只保留中文字符、英文字母、数字、小数点、连接符
    cleaned = re.sub(r'[^一-龥a-zA-Z0-9.·-]', '', entity)

    # 4. 清洗后为空则用行业名
    if not cleaned:
        return industry

    # 5. 长度截断（超过20字符）
    if len(cleaned) > 20:
        cleaned = cleaned[:20]

    return cleaned


def normalize_summary(summary: str, content: str, min_len: int = 50, max_len: int = 200) -> str:
    """规范化summary长度"""
    # 1. 空值检查
    if not summary or not summary.strip():
        summary = content[:100] if content else ""

    summary = summary.strip()

    # 2. 低于最小长度：拼接正文前100字
    if len(summary) < min_len:
        extra = content[:100] if content else ""
        summary = summary + "。" + extra if summary else extra

    # 3. 高于最大长度：截断并加省略号
    if len(summary) > max_len:
        summary = summary[:max_len] + "..."

    return summary


class NewsAnalyzer:
    def __init__(self, config: dict[str, Any], logger, progress_callback=None) -> None:
        self.config = config
        self.logger = logger
        self.progress_callback = progress_callback
        llm_config = config.get("llm", {})
        self.enabled = bool(llm_config.get("enabled", True))
        self.model = llm_config.get("model", "qwen-turbo")
        self.api_key_env = llm_config.get("api_key_env", "DASHSCOPE_API_KEY")
        self.temperature = llm_config.get("temperature", 0.2)
        self.top_p = llm_config.get("top_p", 0.8)
        self.max_workers = int(llm_config.get("max_workers", 4))
        self.timeout = int(llm_config.get("timeout", 60))
        self.retry_times = int(llm_config.get("retry_times", 2))
        self.circuit_break_threshold = int(llm_config.get("circuit_break_threshold", 5))
        self.circuit_break_pause = int(llm_config.get("circuit_break_pause", 30))
        self._api_key = os.getenv(self.api_key_env, "")
        self._llm_available = self.enabled and bool(self._api_key) and dashscope is not None
        self._consecutive_failures = 0

    @property
    def llm_available(self) -> bool:
        return self._llm_available

    def analyze_articles(self, articles: list[Article]) -> list[Article]:
        if not articles:
            return []

        if not self._llm_available:
            self.logger.info("未检测到可用的 Qwen API，切换到规则模式。")
            return [self._apply_fallback(article) for article in articles]

        results: list[Article] = []
        total = max(len(articles), 1)
        completed = 0

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_map = {executor.submit(self._analyze_single_with_retry, article): article for article in articles}
            for future in as_completed(future_map):
                article = future_map[future]
                try:
                    results.append(future.result())
                except Exception as exc:  # noqa: BLE001
                    self.logger.warning("Qwen 分析失败，已回退到规则模式：%s | %s", article.url, exc)
                    results.append(self._apply_fallback(article))
                completed += 1
                self._report_progress(completed, total, f"Qwen 分析处理中（{completed}/{total}）...")
        return results

    def _analyze_single_with_retry(self, article: Article) -> Article:
        """带重试和熔断的LLM分析"""
        for attempt in range(self.retry_times + 1):
            try:
                result = self._analyze_single(article)
                self._consecutive_failures = 0
                return result
            except Exception as exc:
                if attempt < self.retry_times:
                    self.logger.warning("LLM调用失败，重试中（第%d次）：%s", attempt + 2, exc)
                    import time
                    time.sleep(2)
                else:
                    self.logger.warning("LLM调用连续失败，触发兜底：%s", exc)
                    self._consecutive_failures += 1
                    if self._consecutive_failures >= self.circuit_break_threshold:
                        self.logger.warning("连续%d次失败，暂停%d秒", self.circuit_break_threshold, self.circuit_break_pause)
                        import time
                        time.sleep(self.circuit_break_pause)
                        self._consecutive_failures = 0
                    raise
        return self._apply_fallback(article)

    def _analyze_single(self, article: Article) -> Article:
        """V5.0：LLM分析单篇文章"""
        system_prompt = (
            "你是一名AI产业资讯分析助手。请根据给定资讯，输出严格的JSON对象，不要输出任何解释、markdown或代码块。"
        )
        user_prompt = f"""请判断以下文章属于哪个行业（只选一个）：
电子商务、智能汽车、企业服务、人工智能、旅游出行、生活服务、文娱传媒、硬科技、新能源

同时提取文章中最核心的公司名或产品名作为主体：
- 如果是公司动态类，提取公司名
- 如果是产品动态类，提取产品名
- 如果没有明确的主体，则输出行业名本身
- 只输出1个最核心的主体

按以下标准对文章重要性打分（0-100）：
85-100分：重大事件（重大政策出台、巨头并购、颠覆性技术突破）
70-84分：重要动态（头部公司财报发布、核心高管变动、战略调整）
50-69分：一般新闻（普通产品更新、常规业务进展）
50分以下：简讯（日常运营动态、非关键信息）

输出JSON格式：
{{"industry": "行业名", "entity": "主体名", "summary": "摘要", "importance_score": 分数}}

文章标题：{article.title}
来源：{article.source_name}
发布时间：{article.published_at.isoformat() if article.published_at else "未知"}
正文内容：{trim_text(article.body_text, 2000)}
"""

        response = dashscope.Generation.call(
            api_key=self._api_key,
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            result_format="message",
            temperature=self.temperature,
            top_p=self.top_p,
            timeout=self.timeout,
        )

        content = self._extract_message_content(response)

        # V5.0：Pydantic校验
        try:
            payloads = extract_json_objects(content)
            payload = payloads[0] if payloads else {}
            if not payload:
                raise ValueError(f"无法解析LLM返回内容：{content[:200]}")

            # Pydantic校验
            analysis = ArticleAnalysis(**payload)

            # V5.0：新字段赋值
            article.industry = analysis.industry
            article.entity = clean_entity(analysis.entity, analysis.industry)
            article.summary = normalize_summary(analysis.summary, article.body_text)
            article.importance_score = float(analysis.importance_score)

            # V5.0：内容类型推断
            article.content_type = infer_content_type(article)

        except Exception as exc:
            self.logger.warning("Pydantic校验失败，触发兜底：%s", exc)
            raise

        # 兜底：用规则补充
        if not getattr(article, 'industry', None):
            article.industry = infer_industry_fallback(article)
        if not getattr(article, 'entity', None):
            article.entity = infer_entity_fallback(article, article.industry)
        if not getattr(article, 'summary', None):
            article.summary = normalize_summary("", article.body_text)
        if not getattr(article, 'content_type', None):
            article.content_type = infer_content_type(article)

        # V5.0：元数据
        article.metadata["quality_reason"] = "LLM分析"
        article.metadata["fallback_triggered"] = False

        return article

    def _apply_fallback(self, article: Article) -> Article:
        """V5.0：兜底处理"""
        # 兜底推断
        article.industry = infer_industry_fallback(article)
        article.entity = infer_entity_fallback(article, article.industry)
        article.summary = normalize_summary("", article.body_text)
        article.importance_score = 50.0  # 兜底默认50分
        article.content_type = infer_content_type(article)

        # V5.0：元数据
        article.metadata["quality_reason"] = "规则兜底"
        article.metadata["fallback_triggered"] = True

        return article

    def _extract_message_content(self, response: Any) -> str:
        if response is None:
            return ""
        if isinstance(response, dict):
            return (
                response.get("output", {})
                .get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
        if hasattr(response, "output"):
            choices = getattr(response.output, "choices", [])
            if choices:
                message = getattr(choices[0], "message", None)
                if message is not None:
                    content = getattr(message, "content", "")
                    if isinstance(content, list):
                        return "".join(
                            str(item.get("text", "")) if isinstance(item, dict) else str(item)
                            for item in content
                        )
                    return str(content)
        return str(response)

    def _report_progress(self, completed: int, total: int, message: str) -> None:
        if not self.progress_callback:
            return
        progress = 58 + int((completed / max(total, 1)) * 16)
        self.progress_callback(
            {
                "progress": progress,
                "stage": "analyzing",
                "message": message,
                "details": {"completed_articles": completed, "total_articles": total},
            }
        )
