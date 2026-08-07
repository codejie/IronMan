from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from hashlib import sha256
from html import unescape
from io import BytesIO
import math
import re
from typing import Any, Callable, Literal, Protocol


AssetType = Literal["stock", "index", "fund"]
Timeframe = Literal["day", "week", "month"]
Adjust = Literal["", "qfq", "hfq"]
TechnicalKind = Literal["new_high", "uptrend", "high_volume", "rise_volume_price", "limit_up_pool"]


class Frame(Protocol):
    def to_dict(self, orient: str) -> list[dict[str, Any]]: ...


class AkShareApi(Protocol):
    def stock_info_a_code_name(self) -> Frame: ...

    def index_stock_info(self) -> Frame: ...

    def stock_zh_a_hist(self, **kwargs: Any) -> Frame: ...

    def index_zh_a_hist(self, **kwargs: Any) -> Frame: ...

    def fund_etf_hist_em(self, **kwargs: Any) -> Frame: ...

    def stock_zh_a_spot_em(self) -> Frame: ...

    def stock_zh_index_spot_em(self) -> Frame: ...

    def fund_etf_spot_em(self) -> Frame: ...

    def stock_rank_cxg_ths(self, **kwargs: Any) -> Frame: ...

    def stock_rank_lxsz_ths(self, **kwargs: Any) -> Frame: ...

    def stock_rank_cxfl_ths(self, **kwargs: Any) -> Frame: ...

    def stock_rank_ljqs_ths(self, **kwargs: Any) -> Frame: ...

    def stock_zt_pool_em(self, **kwargs: Any) -> Frame: ...

    def stock_news_em(self, symbol: str) -> Frame: ...


class ProviderError(Exception):
    """Raised when an allowlisted upstream call cannot produce normalized data."""


@dataclass(frozen=True)
class HistoryRequest:
    asset_type: AssetType
    exchange: str
    code: str
    timeframe: Timeframe
    limit: int
    end_date: str | None
    adjust: Adjust = "qfq"


@dataclass(frozen=True)
class SpotRequest:
  asset_type: AssetType
  exchange: str
  code: str


@dataclass(frozen=True)
class InstrumentSearchRequest:
    asset_type: AssetType
    query: str
    limit: int


@dataclass(frozen=True)
class TechnicalRequest:
    kind: TechnicalKind
    category: int | None = None
    days: int | None = None
    date: str | None = None


@dataclass(frozen=True)
class NewsRequest:
    code: str
    limit: int = 5
    since: str | None = None


@dataclass(frozen=True)
class DisclosureRequest:
    code: str
    exchange: Literal["sh", "sz", "bj"]
    limit: int = 5


class DisclosureClient(Protocol):
    def post(self, url: str, **kwargs: Any) -> Any: ...

    def get(self, url: str, **kwargs: Any) -> Any: ...


PdfTextExtractor = Callable[[bytes], str]


def fetch_news(request: NewsRequest, api: AkShareApi) -> dict[str, Any]:
    code = request.code.strip()
    if not re.fullmatch(r"\d{6}", code):
        raise ProviderError("新闻标的代码必须为 6 位数字")
    limit = validate_news_limit(request.limit)
    since = parse_date(request.since) if request.since else None
    items: list[dict[str, str | None]] = []
    seen: set[str] = set()
    for row in api.stock_news_em(symbol=code).to_dict("records"):
        title = string_value(row, "新闻标题", "标题", "title")
        content = string_value(row, "新闻内容", "内容", "content", "摘要", "新闻摘要")
        if title is None or content is None:
            continue
        published_at = normalized_timestamp(string_value(row, "发布时间", "发布日期", "datetime", "date"))
        if since is not None and published_at is not None and published_at[:10] < since.isoformat():
            continue
        url = string_value(row, "新闻链接", "链接", "url")
        external_id = url or f"{title}:{published_at or ''}"
        if external_id in seen:
            continue
        seen.add(external_id)
        items.append({
            "externalId": external_id,
            "title": clean_text(title),
            "content": clean_text(content)[:20_000],
            "contentHash": sha256(clean_text(content)[:20_000].encode("utf-8")).hexdigest(),
            "publishedAt": published_at,
            "sourceName": string_value(row, "文章来源", "来源", "source") or "东方财富新闻",
            "url": url or f"https://so.eastmoney.com/news/s?keyword={code}",
        })
        if len(items) >= limit:
            break
    return {"source": "akshare_news_em", "items": items}


def fetch_disclosures(
    request: DisclosureRequest,
    client: DisclosureClient,
    *,
    pdf_text_extractor: PdfTextExtractor | None = None,
) -> dict[str, Any]:
    code = request.code.strip()
    if not re.fullmatch(r"\d{6}", code):
        raise ProviderError("公告标的代码必须为 6 位数字")
    limit = validate_news_limit(request.limit)
    column = "sse" if request.exchange == "sh" else "szse"
    response = client.post(
        "https://www.cninfo.com.cn/new/hisAnnouncement/query",
        data={
            "pageNum": 1,
            "pageSize": limit,
            "column": column,
            "tabName": "fulltext",
            "plate": "",
            "stock": f"{code},",
            "searchkey": "",
            "secid": "",
            "category": "",
            "trade": "",
            "seDate": "",
            "sortName": "",
            "sortType": "",
            "isHLtitle": "true",
        },
        headers={"user-agent": "IronMan/0.1 disclosure-provider", "x-requested-with": "XMLHttpRequest"},
        timeout=10,
    )
    response.raise_for_status()
    payload = response.json()
    announcements = payload.get("announcements", []) if isinstance(payload, dict) else []
    if not isinstance(announcements, list):
        raise ProviderError("巨潮资讯公告列表格式无效")

    items: list[dict[str, Any]] = []
    for announcement in announcements[:limit]:
        if not isinstance(announcement, dict):
            continue
        announcement_id = string_value(announcement, "announcementId", "id")
        title = string_value(announcement, "announcementTitle", "title")
        adjunct = string_value(announcement, "adjunctUrl", "url")
        if announcement_id is None or title is None or adjunct is None:
            continue
        url = cninfo_static_url(adjunct)
        published_at = normalized_timestamp(announcement.get("announcementTime"))
        item: dict[str, Any] = {
            "externalId": announcement_id,
            "title": clean_text(unescape(title)),
            "publishedAt": published_at,
            "sourceName": "巨潮资讯",
            "url": url,
            "content": "",
            "contentHash": None,
            "availability": "failed",
            "error": None,
        }
        try:
            document = client.get(
                url,
                headers={"user-agent": "IronMan/0.1 disclosure-provider"},
                timeout=15,
            )
            document.raise_for_status()
            content = document.content
            if len(content) > 8_000_000:
                raise ProviderError("公告附件超过 8 MB 限制")
            content_type = str(document.headers.get("content-type", "")).lower()
            if "pdf" in content_type or url.lower().endswith(".pdf"):
                extractor = pdf_text_extractor or extract_pdf_text
                text = extractor(content)
            else:
                text = extract_html_text(content.decode("utf-8", errors="ignore"))
            text = clean_text(text)[:30_000]
            if len(text) < 40:
                raise ProviderError("公告正文没有可用文本层")
            item["content"] = text
            item["contentHash"] = sha256(text.encode("utf-8")).hexdigest()
            item["availability"] = "available"
        except Exception as error:
            item["error"] = str(error) or "公告正文解析失败"
        items.append(item)
    return {"source": "cninfo_disclosure", "items": items}


def fetch_history(request: HistoryRequest, api: AkShareApi) -> dict[str, Any]:
    end = parse_date(request.end_date) if request.end_date else date.today()
    limit = validate_limit(request.limit)
    start = end - timedelta(days=max(limit * 3, 90))
    params = {
        "symbol": request.code,
        "period": period_name(request.timeframe),
        "start_date": start.strftime("%Y%m%d"),
        "end_date": end.strftime("%Y%m%d"),
    }

    if request.asset_type == "stock":
        frame = api.stock_zh_a_hist(**params, adjust=request.adjust)
    elif request.asset_type == "index":
        frame = api.index_zh_a_hist(**params)
    elif request.asset_type == "fund":
        frame = api.fund_etf_hist_em(**params, adjust=request.adjust)
    else:
        raise ProviderError("不支持的 AKShare 标的类型")

    bars = normalize_bars(frame)[-limit:]
    if not bars:
        raise ProviderError("AKShare 未返回可用的历史行情")
    return {"source": "akshare", "bars": bars}


def fetch_spot(request: SpotRequest, api: AkShareApi) -> dict[str, Any]:
    if request.asset_type == "stock":
        frame = api.stock_zh_a_spot_em()
    elif request.asset_type == "index":
        frame = api.stock_zh_index_spot_em()
    elif request.asset_type == "fund":
        frame = api.fund_etf_spot_em()
    else:
        raise ProviderError("不支持的 AKShare 标的类型")

    row = next((item for item in frame.to_dict("records") if string_value(item, "代码", "code") == request.code), None)
    if row is None:
        raise ProviderError("AKShare 未返回指定标的的现货行情")
    price = number_value(row, "最新价", "最新", "收盘", "price")
    if price is None:
        raise ProviderError("AKShare 现货行情缺少最新价")
    return {
        "source": "akshare",
        "quote": {
            "code": request.code,
            "price": price,
            "open": number_value(row, "今开", "开盘", "open"),
            "high": number_value(row, "最高", "high"),
            "low": number_value(row, "最低", "low"),
            "previousClose": number_value(row, "昨收", "昨收盘", "previous_close"),
            "volume": number_value(row, "成交量", "volume"),
        },
    }


def fetch_instruments(request: InstrumentSearchRequest, api: AkShareApi) -> dict[str, Any]:
    query = request.query.strip()
    if not query:
        raise ProviderError("标的检索关键词不能为空")
    limit = validate_catalog_limit(request.limit)

    if request.asset_type == "stock":
        items = normalize_catalog(
            api.stock_info_a_code_name(),
            asset_type="stock",
            code_keys=("代码", "code"),
            name_keys=("名称", "name"),
            exchange_for=stock_exchange,
        )
    elif request.asset_type == "index":
        items = normalize_catalog(
            api.index_stock_info(),
            asset_type="index",
            code_keys=("index_code", "指数代码", "代码", "code"),
            name_keys=("display_name", "指数名称", "名称", "name"),
            exchange_for=index_exchange,
        )
    elif request.asset_type == "fund":
        items = normalize_catalog(
            api.fund_etf_spot_em(),
            asset_type="fund",
            code_keys=("代码", "基金代码", "code"),
            name_keys=("名称", "基金简称", "name"),
            exchange_for=lambda _code: "fund",
        )
    else:
        raise ProviderError("不支持的 AKShare 标的类型")

    needle = query.casefold()
    matched = [item for item in items if needle in item["code"].casefold() or needle in item["name"].casefold()]
    return {"source": "akshare", "items": matched[:limit]}


def fetch_technical(request: TechnicalRequest, api: AkShareApi) -> dict[str, Any]:
    if request.kind == "new_high":
        category = normalize_category(request.category)
        frame = api.stock_rank_cxg_ths(symbol=NEW_HIGH_SYMBOLS[category])
        columns, rows = normalize_table(frame)
        label = NEW_HIGH_LABELS[category]
        rows = [{**row, "新高分类": label} for row in rows]
        if "新高分类" not in columns:
            columns.append("新高分类")
    elif request.kind == "uptrend":
        columns, rows = normalize_table(api.stock_rank_lxsz_ths())
        rows = filter_ranked_rows(rows, "连涨天数", request.days)
    elif request.kind == "high_volume":
        columns, rows = normalize_table(api.stock_rank_cxfl_ths())
        rows = filter_ranked_rows(rows, "放量天数", request.days)
    elif request.kind == "rise_volume_price":
        columns, rows = normalize_table(api.stock_rank_ljqs_ths())
        rows = filter_ranked_rows(rows, "量价齐升天数", request.days)
    elif request.kind == "limit_up_pool":
        columns, rows = normalize_table(api.stock_zt_pool_em(date=normalize_market_date(request.date)))
    else:
        raise ProviderError("不支持的技术数据类型")

    return {"source": "akshare", "columns": columns, "rows": rows}


def normalize_bars(frame: Frame) -> list[dict[str, float | str]]:
    bars: list[dict[str, float | str]] = []
    for row in frame.to_dict("records"):
        date_value = normalized_date(string_value(row, "日期", "date"))
        open_price = number_value(row, "开盘", "open")
        close = number_value(row, "收盘", "close")
        high = number_value(row, "最高", "high")
        low = number_value(row, "最低", "low")
        volume = number_value(row, "成交量", "volume")
        if date_value is None or None in (open_price, close, high, low, volume):
            continue
        bars.append({"date": date_value, "open": open_price, "close": close, "high": high, "low": low, "volume": volume})
    return sorted(bars, key=lambda item: str(item["date"]))


def normalize_table(frame: Frame) -> tuple[list[str], list[dict[str, str | int | float | None]]]:
    columns: list[str] = []
    rows: list[dict[str, str | int | float | None]] = []
    for raw_row in frame.to_dict("records"):
        row: dict[str, str | int | float | None] = {}
        for key, raw_value in raw_row.items():
            column = str(key)
            if column not in columns:
                columns.append(column)
            row[column] = table_value(raw_value)
        rows.append(row)
    return columns, rows


def normalize_catalog(
    frame: Frame,
    *,
    asset_type: AssetType,
    code_keys: tuple[str, ...],
    name_keys: tuple[str, ...],
    exchange_for: Any,
) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for row in frame.to_dict("records"):
        code = string_value(row, *code_keys)
        name = string_value(row, *name_keys)
        if code is None or name is None:
            continue
        key = (code, asset_type)
        if key in seen:
            continue
        seen.add(key)
        items.append({"assetType": asset_type, "code": code, "exchange": exchange_for(code), "name": name})
    return items


def filter_ranked_rows(rows: list[dict[str, str | int | float | None]], field: str, minimum_days: int | None) -> list[dict[str, str | int | float | None]]:
    threshold = normalize_days(minimum_days)
    if threshold <= 1:
        return rows
    return [row for row in rows if numeric_cell(row.get(field)) >= threshold]


def table_value(value: Any) -> str | int | float | None:
    if value is None:
        return None
    if hasattr(value, "item"):
        try:
            value = value.item()
        except ValueError:
            pass
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float)):
        number = float(value)
        if not math.isfinite(number):
            return None
        return int(number) if number.is_integer() else number
    text = str(value).strip()
    return text or None


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise ProviderError("行情截止日期必须为 yyyy-mm-dd") from error


def validate_limit(value: int) -> int:
    if value < 1 or value > 640:
        raise ProviderError("行情条数必须在 1 到 640 之间")
    return value


def validate_catalog_limit(value: int) -> int:
    if value < 1 or value > 50:
        raise ProviderError("标的检索数量必须在 1 到 50 之间")
    return value


def validate_news_limit(value: int) -> int:
    if value < 1 or value > 10:
        raise ProviderError("资料条数必须在 1 到 10 之间")
    return value


NEW_HIGH_SYMBOLS = ("创月新高", "半年新高", "一年新高", "历史新高")
NEW_HIGH_LABELS = ("月创新高", "半年新高", "一年新高", "历史新高")


def normalize_category(value: int | None) -> int:
    category = 0 if value is None else value
    if category < 0 or category >= len(NEW_HIGH_SYMBOLS):
        raise ProviderError("创新高分类必须在 0 到 3 之间")
    return category


def normalize_days(value: int | None) -> int:
    days = 1 if value is None else value
    if days < 1 or days > 30:
        raise ProviderError("连续天数必须在 1 到 30 之间")
    return days


def normalize_market_date(value: str | None) -> str:
    if value is None or value.strip() == "":
        target = previous_weekday(date.today())
    else:
        raw = value.strip().replace("/", "-")
        try:
            target = datetime.strptime(raw, "%Y%m%d").date() if "-" not in raw else date.fromisoformat(raw)
        except ValueError as error:
            raise ProviderError("涨停股池日期必须为 yyyy-mm-dd") from error
    return target.strftime("%Y%m%d")


def previous_weekday(target: date) -> date:
    while target.weekday() >= 5:
        target -= timedelta(days=1)
    return target


def numeric_cell(value: str | int | float | None) -> float:
    if value is None:
        return float("-inf")
    try:
        return float(str(value).replace(",", "").strip())
    except ValueError:
        return float("-inf")


def period_name(timeframe: Timeframe) -> str:
    return {"day": "daily", "week": "weekly", "month": "monthly"}[timeframe]


def stock_exchange(code: str) -> str:
    if code.startswith(("4", "8")):
        return "bj"
    return "sh" if code.startswith(("5", "6", "9")) else "sz"


def index_exchange(code: str) -> str:
    return "sh" if code.startswith("000") else "sz"


def string_value(row: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def normalized_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            number = float(value)
            if number > 10_000_000_000:
                number /= 1000
            return datetime.fromtimestamp(number).replace(microsecond=0).isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip().replace("/", "-")
    if not text:
        return None
    candidate = text.replace("T", " ")
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(candidate[:19], pattern).isoformat()
        except ValueError:
            continue
    return None


def clean_text(value: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", value, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def extract_html_text(value: str) -> str:
    return clean_text(value)


def extract_pdf_text(content: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise ProviderError("PDF 正文解析依赖未安装，请执行 bun run akshare:setup") from error
    reader = PdfReader(BytesIO(content))
    if len(reader.pages) > 20:
        raise ProviderError("公告 PDF 页数超过 20 页限制")
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def cninfo_static_url(value: str) -> str:
    path = value.strip().lstrip("/")
    if path.startswith("http://static.cninfo.com.cn/"):
        return "https://" + path[len("http://"):]
    if path.startswith("https://static.cninfo.com.cn/"):
        return path
    if not path or ".." in path or path.startswith(("http://", "https://")):
        raise ProviderError("巨潮公告附件地址无效")
    return f"https://static.cninfo.com.cn/{path}"


def number_value(row: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = row.get(key)
        if value is None or isinstance(value, bool):
            continue
        try:
            result = float(str(value).replace(",", "").strip())
        except ValueError:
            continue
        if result == result and result not in (float("inf"), float("-inf")):
            return result
    return None


def normalized_date(value: str | None) -> str | None:
    if value is None:
        return None
    candidate = value.replace("/", "-")[:10]
    try:
        return date.fromisoformat(candidate).isoformat()
    except ValueError:
        return None
