import asyncio
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from akshare_provider.main import TechnicalBody, app, technical_ranking
from test_contract import FakeAkShare


class AkShareProviderHttpTest(unittest.TestCase):
    def test_health_is_available_only_as_a_post_contract(self):
        client = TestClient(app)
        response = client.post("/health", json={})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(client.get("/health").status_code, 405)

    def test_technical_ranking_normalizes_a_provider_request(self):
        client = TestClient(app)
        with patch("akshare_provider.main.akshare_api", return_value=FakeAkShare()):
            response = client.post("/v1/technical/ranking", json={"kind": "uptrend", "days": 3})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["source"], "akshare")
        self.assertEqual(response.json()["rows"], [{"股票代码": "000001", "连涨天数": 5}])

    def test_instrument_search_returns_a_type_scoped_catalog(self):
        client = TestClient(app)
        with patch("akshare_provider.main.akshare_api", return_value=FakeAkShare()):
            response = client.post("/v1/market/instruments/search", json={"assetType": "index", "query": "000001"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"], [{"assetType": "index", "code": "000001", "exchange": "sh", "name": "上证指数"}])

    def test_news_endpoint_returns_normalized_body_content(self):
        client = TestClient(app)
        with patch("akshare_provider.main.akshare_api", return_value=FakeAkShare()):
            response = client.post("/v1/news/stock", json={"code": "600000", "limit": 5, "since": "2026-07-01"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"][0]["externalId"], "https://finance.eastmoney.com/a/202607301234567890.html")
        self.assertIn("净利润同比增长", response.json()["items"][0]["content"])

    def test_heavy_technical_requests_are_serialized_in_one_process(self):
        active = 0
        maximum = 0

        def fake_fetch(_request, _api):
            nonlocal active, maximum
            active += 1
            maximum = max(maximum, active)
            time.sleep(0.02)
            active -= 1
            return {"source": "akshare", "columns": ["股票代码"], "rows": []}

        async def run_requests():
            bodies = [TechnicalBody(kind="uptrend"), TechnicalBody(kind="high_volume")]
            return await asyncio.gather(*(technical_ranking(body) for body in bodies))

        with patch("akshare_provider.main.fetch_technical", side_effect=fake_fetch), patch("akshare_provider.main.akshare_api", return_value=FakeAkShare()):
            asyncio.run(run_requests())

        self.assertEqual(maximum, 1)


if __name__ == "__main__":
    unittest.main()
