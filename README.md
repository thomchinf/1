# 小喇叭 - 行业AI资讯日报系统

## 免责声明

1. 本项目**仅用于个人学习**，严禁用于任何商业用途或非法活动
2. 使用本项目前，必须遵守目标网站的robots.txt协议和服务条款
3. 使用者需自行承担因违反法律法规或网站规定而产生的一切法律责任
4. 项目作者不对任何使用本项目导致的法律纠纷承担责任

---

一个面向中文简报场景的AI资讯日报项目。系统通过Web控制台配置数据源、筛选条件和生成参数，自动抓取国内外资讯，完成筛选、去重、分类、摘要，并输出Word、Markdown和统计文件。

## 核心功能

- **多源抓取**：支持32个RSS/HTML数据源，覆盖AI、科技、电商、汽车等多个行业
- **智能过滤**：三层关键词过滤（信号词/行业词/组合词）
- **LLM摘要**：调用大模型生成结构化摘要（含行业分类、主体提取、重要性评分）
- **行业分类**：按9大行业×3种内容类型（趋势/公司/产品）组织日报
- **健康诊断**：看板系统实时监控数据质量和系统状态
- **多格式导出**：支持Word、Markdown格式输出

## 报告结构

```
📊 行业日报

【关注赛道】
  一、电子商务 → 趋势/公司/产品
  二、智能汽车 → 趋势/公司/产品
  三、企业服务 → 趋势/公司/产品
  四、人工智能 → 趋势/公司/产品

【次关注】
  五、旅游出行 → 趋势/公司/产品
  六、生活服务 → 趋势/公司/产品
  七、文娱传媒 → 趋势/公司/产品

【其他】
  八、硬科技 → 趋势/公司/产品
  九、新能源 → 趋势/公司/产品
```

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

主要依赖：
- `dashscope` - 阿里云百炼API
- `streamlit` - 看板界面
- `jieba` - 中文分词
- `pandas` - 数据处理
- `python-docx` - Word文档生成
- `feedparser` - RSS解析
- `requests` - HTTP请求
- `beautifulsoup4` - HTML解析

### 2. 配置环境变量

创建 `.env` 文件：

```env
DASHSCOPE_API_KEY=你的API密钥
DASHSCOPE_API_BASE=https://ws-xxx.compatible-mode/v1
```

### 3. 运行日报生成

```bash
python run_daily_news.py
```

### 4. 启动看板

```bash
streamlit run dashboard.py
```

## 项目结构

```
AiNewsFind/
├── ai_news_agent/              # 核心模块
│   ├── config.py               # 配置加载
│   ├── doc_generator.py        # Word生成
│   ├── fetchers.py             # 数据抓取
│   ├── filters.py              # 过滤规则（含三层关键词）
│   ├── llm.py                  # LLM调用（含Pydantic校验）
│   ├── models.py               # 数据模型
│   ├── pipeline.py             # 主流程
│   └── utils.py                # 工具函数
├── config/
│   ├── default_config.yaml     # 默认配置
│   └── saved_web_config.yaml   # Web控制台保存的配置
├── web_ui/                     # FastAPI Web控制台
├── output/                     # 生成文档输出目录
├── logs/                       # 运行日志目录
├── run_daily_news.py           # 底层流水线脚本入口
├── run_scheduler.py            # 定时任务入口
├── run_web_ui.py               # Web控制台启动入口
├── dashboard.py                # Streamlit看板
└── requirements.txt            # 依赖
```

## 数据流

```
抓取 → 关键词过滤 → LLM分析 → 校验+兜底 → 内容类型推断 → 去重 → 报告组装 → 导出
```

## 配置说明

### 数据源配置

编辑 `config/default_config.yaml` 中的 `sources` 部分：

```yaml
sources:
  - name: "数据源名称"
    kind: "rss"  # 或 "html"
    url: "RSS地址或网页URL"
    locale: "zh"  # 或 "en"
    source_weight: 1.2  # 权重影响文章优先级
    max_items: 10       # 最大抓取数量
```

### 行业关键词配置

编辑 `ai_news_agent/filters.py` 中的关键词配置：

- `INDUSTRY_KEYWORDS` - 行业关键词（9个行业）
- `TOPIC_KEYWORDS` - 主题词
- `SIGNAL_KEYWORDS` - 信号词（优先级最高，无视时效）

### LLM配置

```yaml
llm:
  enabled: true
  model: qwen-turbo
  api_key_env: DASHSCOPE_API_KEY
  temperature: 0.2
  timeout: 60      # 超时秒数
  retry_times: 2   # 重试次数
```

## 成本控制

- 单日预算上限：20元
- 日处理量：50-150篇文章
- 单篇token估算：1500-2000

## 看板功能

启动看板后可查看：

- **日报正文预览**：按行业×类型分组展示
- **系统健康诊断**：7项检查指标
- **数据漏斗**：抓取→过滤→去重→最终入库
- **行业分布**：各行业文章数量统计

## 定时运行

定时任务使用 `config/default_config.yaml` 中的 `schedule.daily_time`，默认是 `09:00`。

```bash
python run_scheduler.py
```

## 生成结果

成功生成后，`output/` 下会出现类似文件：

```text
每日AI资讯_20260721_0900.docx
每日AI资讯_20260721_0900.md
每日AI资讯_20260721_0900_stats.txt
```

日志文件默认输出到：

```text
logs/ai_news_agent.log
```

## 已知说明

- 当前版本优先保证可运行、可配置和可扩展，没有为每个资讯站点单独做深度反爬适配。
- 对于需要登录、强反爬或强JS渲染的网站，后续可以按站点追加更强的抓取逻辑。
- 外部站点偶发超时或断连时，系统会记录日志并继续处理其他数据源。
- 部分投资者关系页面（如京东、小米、蔚来）可能有访问限制，可通过其他渠道补充。

## License

MIT License
