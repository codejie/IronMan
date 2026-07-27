from __future__ import annotations

from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .service import (
    HistoryRequest,
    InstrumentSearchRequest,
    ProviderError,
    SpotRequest,
    TechnicalRequest,
    fetch_history,
    fetch_instruments,
    fetch_spot,
    fetch_technical,
)

app = FastAPI(title="IronMan AKShareProvider", version="0.1.0")


class HistoryBody(BaseModel):
    asset_type: Literal["stock", "index", "fund"] = Field(alias="assetType")
    exchange: Literal["sh", "sz", "bj", "fund"]
    code: str = Field(min_length=1, max_length=24)
    timeframe: Literal["day", "week", "month"]
    limit: int = Field(ge=1, le=640)
    end_date: str | None = Field(default=None, alias="endDate")
    adjust: Literal["", "qfq", "hfq"] = "qfq"


class SpotBody(BaseModel):
    asset_type: Literal["stock", "index", "fund"] = Field(alias="assetType")
    exchange: Literal["sh", "sz", "bj", "fund"]
    code: str = Field(min_length=1, max_length=24)


class InstrumentSearchBody(BaseModel):
    asset_type: Literal["stock", "index", "fund"] = Field(alias="assetType")
    query: str = Field(min_length=1, max_length=120)
    limit: int = Field(default=50, ge=1, le=50)


class TechnicalBody(BaseModel):
    kind: Literal["new_high", "uptrend", "high_volume", "rise_volume_price", "limit_up_pool"]
    category: int | None = Field(default=None, ge=0, le=3)
    days: int | None = Field(default=None, ge=1, le=30)
    date: str | None = Field(default=None, max_length=10)


def akshare_api():
    try:
        import akshare
    except ImportError as error:
        raise HTTPException(status_code=503, detail="AKShareProvider 依赖未安装，请先执行 bun run akshare:setup") from error
    return akshare


@app.post("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ironman-akshare-provider"}


@app.post("/v1/market/history")
def history(body: HistoryBody) -> dict:
    try:
        return fetch_history(
            HistoryRequest(
                asset_type=body.asset_type,
                exchange=body.exchange,
                code=body.code,
                timeframe=body.timeframe,
                limit=body.limit,
                end_date=body.end_date,
                adjust=body.adjust,
            ),
            akshare_api(),
        )
    except ProviderError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail="AKShare 上游行情请求失败") from error


@app.post("/v1/market/spot")
def spot(body: SpotBody) -> dict:
    try:
        return fetch_spot(SpotRequest(asset_type=body.asset_type, exchange=body.exchange, code=body.code), akshare_api())
    except ProviderError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail="AKShare 上游现货请求失败") from error


@app.post("/v1/market/instruments/search")
def search_instruments(body: InstrumentSearchBody) -> dict:
    try:
        return fetch_instruments(InstrumentSearchRequest(asset_type=body.asset_type, query=body.query, limit=body.limit), akshare_api())
    except ProviderError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail="AKShare 上游标的目录请求失败") from error


@app.post("/v1/technical/ranking")
def technical_ranking(body: TechnicalBody) -> dict:
    try:
        return fetch_technical(TechnicalRequest(kind=body.kind, category=body.category, days=body.days, date=body.date), akshare_api())
    except ProviderError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail="AKShare 上游技术榜单请求失败") from error
