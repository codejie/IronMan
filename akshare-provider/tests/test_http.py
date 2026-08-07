import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from akshare_provider.main import app
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


if __name__ == "__main__":
    unittest.main()
