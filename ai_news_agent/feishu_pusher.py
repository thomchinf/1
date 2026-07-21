"""
飞书群机器人推送模块
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import requests


class FeishuPusher:
    """飞书群机器人推送器"""

    def __init__(self, webhook_url: str, timeout: int = 10) -> None:
        self.webhook_url = webhook_url
        self.timeout = timeout

    def push_text(self, text: str) -> bool:
        """推送文本消息"""
        payload = {
            "msg_type": "text",
            "content": {"text": text}
        }
        return self._send(payload)

    def push_card(self, card_content: dict[str, Any]) -> bool:
        """推送卡片消息"""
        payload = {
            "msg_type": "interactive",
            "card": card_content
        }
        return self._send(payload)

    def push_daily_report(self, stats: dict, report_data: list, output_path: Path | None = None) -> bool:
        """推送日报摘要卡片"""
        # 统计各行业文章数
        industry_counts = {}
        for item in report_data:
            ind = item.get("industry", "其他")
            industry_counts[ind] = industry_counts.get(ind, 0) + 1

        # 构建行业分布文本
        industry_text = "\n".join([
            f"• {k}: {v}篇"
            for k, v in sorted(industry_counts.items(), key=lambda x: -x[1])
        ]) or "暂无数据"

        # 构建文章列表（取前5篇）
        articles_text = ""
        for i, item in enumerate(report_data[:5], 1):
            title = item.get("title", "无标题")[:30]
            industry = item.get("industry", "")
            score = item.get("score", 0)
            articles_text += f"{i}. [{industry}] {title} (评分:{score})\n"

        card = {
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": "📊 小喇叭日报已生成"},
                "template": "blue"
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": f"**今日数据概览**\n"
                                   f"• 抓取: {stats.get('fetched', 0)}条\n"
                                   f"• 过滤: {stats.get('filtered', 0)}条\n"
                                   f"• 去重: {stats.get('deduped', 0)}条\n"
                                   f"• 入选: {len(report_data)}条\n"
                                   f"• 兜底触发: {stats.get('fallback_count', 0)}次"
                    }
                },
                {"tag": "hr"},
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": f"**行业分布**\n{industry_text}"
                    }
                },
                {"tag": "hr"},
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": f"**精选文章**\n{articles_text}"
                    }
                }
            ]
        }

        # 如果有Word文件路径，添加下载链接
        if output_path and output_path.exists():
            card["elements"].append({"tag": "hr"})
            card["elements"].append({
                "tag": "note",
                "elements": [
                    {"tag": "plain_text", "content": f"📎 完整日报: {output_path.name}"}
                ]
            })

        return self.push_card(card)

    def _send(self, payload: dict[str, Any]) -> bool:
        """发送消息到飞书"""
        try:
            response = requests.post(
                self.webhook_url,
                json=payload,
                timeout=self.timeout,
                headers={"Content-Type": "application/json"}
            )
            result = response.json()
            if result.get("code") == 0 or result.get("StatusCode") == 0:
                return True
            else:
                print(f"飞书推送失败: {result}")
                return False
        except Exception as e:
            print(f"飞书推送异常: {e}")
            return False


# 全局推送器实例（延迟初始化）
_pusher: FeishuPusher | None = None


def get_pusher(config: dict[str, Any] | None = None) -> FeishuPusher | None:
    """获取飞书推送器实例"""
    global _pusher

    if _pusher is not None:
        return _pusher

    if config is None:
        return None

    feishu_config = config.get("feishu", {})
    if not feishu_config.get("enabled"):
        return None

    webhook_url = feishu_config.get("webhook_url")
    if not webhook_url:
        return None

    _pusher = FeishuPusher(
        webhook_url=webhook_url,
        timeout=feishu_config.get("timeout", 10)
    )
    return _pusher


def reset_pusher() -> None:
    """重置推送器实例（用于重新加载配置）"""
    global _pusher
    _pusher = None
