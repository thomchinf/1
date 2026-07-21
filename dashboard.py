"""
日报看板 - Streamlit应用
V5.0 行业日报系统

功能：
- 日报正文预览（按9行业×3类型分块展示）
- 系统健康自动诊断
- 数据漏斗与调试信息
- 刷新按钮

依赖：streamlit, pandas
启动：streamlit run dashboard.py
"""

import json
import os
from pathlib import Path

import streamlit as st
import pandas as pd

# ============ 配置 ============
DEFAULT_OUTPUT_DIR = Path(__file__).parent / "output"

# ============ 诊断阈值 ============
DIAGNOSTIC_THRESHOLDS = {
    "fetched": {"red": 0, "yellow": 100, "green_min": 100},
    "drop_rate": {"yellow": 50, "red": 80},
    "signal_rate": {"yellow": 40},
    "industry_concentration": {"yellow": 40},
    "fallback_rate": {"red": 20},
    "dedup_rate": {"yellow": 30},
}

# 行业配置
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

INDUSTRY_LEVELS = {
    1: "【关注赛道】",
    2: "【次关注】",
    3: "【其他】",
}

# ============ 工具函数 ============
def load_json(file_path: Path) -> dict | list | None:
    """加载JSON文件"""
    try:
        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return None


def get_status_icon(status: str) -> str:
    """获取状态图标"""
    icons = {
        "important": "🟢",
        "normal": "🟡",
        "brief": "⚪",
        "red": "🔴",
        "yellow": "🟡",
        "green": "🟢",
    }
    return icons.get(status, "⚪")


def check_value(value: float, thresholds: dict, reverse: bool = False) -> str:
    """检查值是否在正常范围"""
    if "red" in thresholds and (value <= thresholds["red"] if not reverse else value >= thresholds["red"]):
        return "red"
    if "yellow" in thresholds and (value <= thresholds["yellow"] if not reverse else value >= thresholds["yellow"]):
        return "yellow"
    return "green"


def check_range(value: float, min_val: float, max_val: float) -> str:
    """检查值是否在范围内"""
    if value < min_val or value > max_val:
        return "yellow"
    return "green"


# ============ 诊断引擎 ============
def run_diagnostics(stats: dict, report_data: list) -> list[dict]:
    """运行健康诊断"""
    results = []

    # 1. 抓取量
    fetched = stats.get("fetched", 0)
    status = check_value(fetched, {"red": 0, "yellow": 100})
    results.append({
        "id": 1,
        "name": "抓取量",
        "status": status,
        "value": fetched,
        "suggestion": "检查RSS源/网络" if status != "green" else "-",
    })

    # 2. 丢弃率
    fetched = stats.get("fetched", 0)
    dropped = stats.get("dropped", 0)
    drop_rate = (dropped / fetched * 100) if fetched > 0 else 0
    status = check_value(drop_rate, {"yellow": 50, "red": 80})
    results.append({
        "id": 2,
        "name": "丢弃率",
        "status": status,
        "value": f"{drop_rate:.1f}%",
        "suggestion": "放宽过滤规则或扩充关键词" if status != "green" else "-",
    })

    # 3. 信号词依赖
    signal_hit = stats.get("signal_hit", 0)
    filtered = stats.get("filtered", 0)
    signal_rate = (signal_hit / filtered * 100) if filtered > 0 else 0
    status = check_value(signal_rate, {"yellow": 40})
    results.append({
        "id": 3,
        "name": "信号词命中",
        "status": status,
        "value": f"{signal_rate:.1f}%" if filtered > 0 else "N/A",
        "suggestion": "检查关键词配置" if status != "green" else "-",
    })

    # 4. 行业集中度
    if report_data:
        industry_counts = {}
        for item in report_data:
            industry = item.get("industry", "其他")
            industry_counts[industry] = industry_counts.get(industry, 0) + 1
        if industry_counts:
            max_count = max(industry_counts.values())
            total = len(report_data)
            top_rate = (max_count / total * 100) if total > 0 else 0
            status = check_value(top_rate, {"yellow": 40})
            top_industry = max(industry_counts.items(), key=lambda x: x[1])[0] if industry_counts else "N/A"
            results.append({
                "id": 4,
                "name": "行业集中度",
                "status": status,
                "value": f"{top_rate:.1f}% ({top_industry})",
                "suggestion": "检查行业关键词配置" if status != "green" else "-",
            })
        else:
            results.append({"id": 4, "name": "行业集中度", "status": "green", "value": "N/A", "suggestion": "-"})
    else:
        results.append({"id": 4, "name": "行业集中度", "status": "green", "value": "N/A", "suggestion": "-"})

    # 5. 兜底触发率
    fallback_count = stats.get("fallback_count", 0)
    final = stats.get("final", 0)
    fallback_rate = (fallback_count / final * 100) if final > 0 else 0
    status = check_value(fallback_rate, {"red": 20})
    results.append({
        "id": 5,
        "name": "兜底触发率",
        "status": status,
        "value": f"{fallback_rate:.1f}%" if final > 0 else "N/A",
        "suggestion": "检查LLM输出或加强Prompt" if status != "green" else "-",
    })

    # 6. 内容类型分布
    if report_data:
        type_counts = {"product": 0, "company": 0, "trend": 0}
        for item in report_data:
            ct = item.get("content_type", "trend")
            if ct in type_counts:
                type_counts[ct] += 1
        total = len(report_data)
        missing_types = [k for k, v in type_counts.items() if v == 0]
        status = "yellow" if len(missing_types) > 1 else "green"
        results.append({
            "id": 6,
            "name": "内容类型分布",
            "status": status,
            "value": f"趋势{type_counts['trend']}/公司{type_counts['company']}/产品{type_counts['product']}",
            "suggestion": f"缺少{','.join(missing_types)}类型" if missing_types else "-",
        })
    else:
        results.append({"id": 6, "name": "内容类型分布", "status": "green", "value": "N/A", "suggestion": "-"})

    # 7. 去重率
    deduped = stats.get("deduped", 0)
    filtered = stats.get("filtered", 0)
    dedup_rate = ((filtered - deduped) / filtered * 100) if filtered > 0 else 0
    status = check_value(dedup_rate, {"yellow": 30})
    results.append({
        "id": 7,
        "name": "去重率",
        "status": status,
        "value": f"{dedup_rate:.1f}%",
        "suggestion": "调整去重阈值" if status != "green" else "-",
    })

    return results


# ============ Streamlit 页面 ============
def main():
    st.set_page_config(
        page_title="AI资讯日报看板",
        page_icon="📊",
        layout="wide",
    )

    st.title("📊 AI资讯日报看板")
    st.caption("V5.0 行业日报系统")

    # 侧边栏 - 设置
    st.sidebar.title("设置")
    output_dir = st.sidebar.text_input(
        "输出目录",
        value=str(DEFAULT_OUTPUT_DIR),
    )
    output_path = Path(output_dir)

    if st.sidebar.button("🔄 刷新数据"):
        st.rerun()

    if not output_path.exists():
        st.error(f"目录不存在：{output_path}")
        return

    stats = load_json(output_path / "stats.json")
    report_data = load_json(output_path / "report_data.json")
    duplicates_log = load_json(output_path / "duplicates_log.json")

    if stats is None and report_data is None:
        st.warning("尚未生成日报，请先运行日报生成脚本")
        return

    # ===== 日报正文预览 =====
    st.header("📄 日报正文预览")

    if report_data:
        # V5.0：按行业+级别分组
        by_level = {1: [], 2: [], 3: []}
        for item in report_data:
            industry = item.get("industry", "其他")
            content_type = item.get("content_type", "trend")
            # 找到行业级别
            level = 3
            for ind in INDUSTRIES:
                if ind["name"] == industry:
                    level = ind["level"]
                    break
            by_level[level].append({**item, "_industry": industry, "_type": content_type})

        for level in [1, 2, 3]:
            level_label = INDUSTRY_LEVELS[level]
            level_items = by_level[level]
            if level_items:
                st.subheader(level_label)
                # 按行业分组显示
                industry_items = {}
                for item in level_items:
                    ind = item.get("_industry", "其他")
                    industry_items.setdefault(ind, []).append(item)

                for ind_name, ind_articles in industry_items.items():
                    with st.expander(f"**{ind_name}** ({len(ind_articles)}篇)", expanded=True):
                        for i, item in enumerate(ind_articles, 1):
                            status_icon = get_status_icon(item.get("status", "normal"))
                            entity = item.get("entity", "")
                            title = item.get("title", "无标题")
                            if entity:
                                title += f" [主体: {entity}]"
                            st.markdown(f"**{i}. {status_icon} {title}**")
                            col1, col2, col3 = st.columns([1, 1, 1])
                            with col1:
                                st.caption(f"🏷️ {item.get('content_type', '趋势')}")
                            with col2:
                                st.caption(f"📊 {item.get('score', 0)}分")
                            with col3:
                                st.caption(f"📰 {item.get('source', '未知')}")
                            with st.container():
                                summary = item.get("summary", "")
                                st.write(summary[:200] + "..." if len(summary) > 200 else summary)
                                st.caption(f"🔗 {item.get('url', '')}")
                            st.divider()
    else:
        st.info("暂无日报数据")

    # ===== 系统健康诊断 =====
    st.header("🩺 系统健康诊断")

    if stats:
        diagnostics = run_diagnostics(stats, report_data or [])

        red_count = sum(1 for d in diagnostics if d["status"] == "red")
        yellow_count = sum(1 for d in diagnostics if d["status"] == "yellow")

        if red_count == 0 and yellow_count == 0:
            st.success("所有指标正常")
        else:
            if red_count > 0:
                st.error(f"🔴 {red_count}项异常")
            if yellow_count > 0:
                st.warning(f"🟡 {yellow_count}项警告")

        diag_df = pd.DataFrame(diagnostics)
        diag_df["状态"] = diag_df["status"].apply(get_status_icon)
        diag_df = diag_df[["id", "name", "value", "状态", "suggestion"]]
        diag_df.columns = ["序号", "检查项", "当前值", "状态", "建议"]
        st.table(diag_df)
    else:
        st.info("暂无统计数据")

    # ===== 数据漏斗与调试信息 =====
    with st.expander("📈 数据漏斗与调试信息"):
        if stats:
            col1, col2, col3, col4 = st.columns(4)
            with col1:
                st.metric("抓取", stats.get("fetched", 0))
            with col2:
                st.metric("过滤", stats.get("filtered", 0))
            with col3:
                st.metric("去重", stats.get("deduped", 0))
            with col4:
                st.metric("最终", stats.get("final", 0))

            st.subheader("漏斗明细")
            funnel_df = pd.DataFrame([
                {"阶段": "抓取", "数量": stats.get("fetched", 0)},
                {"阶段": "过滤后", "数量": stats.get("filtered", 0)},
                {"阶段": "去重后", "数量": stats.get("deduped", 0)},
                {"阶段": "最终入库", "数量": stats.get("final", 0)},
            ])
            st.table(funnel_df)
        else:
            st.info("暂无统计数据")

        # 行业分布
        if report_data:
            st.subheader("行业分布")
            industry_counts = {}
            for item in report_data:
                ind = item.get("industry", "其他")
                industry_counts[ind] = industry_counts.get(ind, 0) + 1
            if industry_counts:
                ind_df = pd.DataFrame(
                    list(industry_counts.items()),
                    columns=["行业", "数量"]
                ).sort_values("数量", ascending=False)
                st.table(ind_df)
            else:
                st.info("暂无行业数据")

        # 去重拦截明细
        if duplicates_log:
            st.subheader("去重拦截明细（最近5条）")
            dup_df = pd.DataFrame(duplicates_log[:5])
            st.table(dup_df)
        else:
            st.info("暂无去重拦截记录")

    # 底部信息
    st.divider()
    st.caption(f"数据目录：{output_path}")
    if stats:
        st.caption(f"最后更新：{stats.get('generated_at', '未知')}")


if __name__ == "__main__":
    main()
