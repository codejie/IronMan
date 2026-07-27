import unittest

from akshare_provider.service import HistoryRequest, InstrumentSearchRequest, TechnicalRequest, fetch_history, fetch_instruments, fetch_technical, normalize_bars


class Frame:
    def __init__(self, rows):
        self.rows = rows

    def to_dict(self, orientation):
        assert orientation == "records"
        return self.rows


class FakeAkShare:
    def __init__(self):
        self.calls = []

    def stock_info_a_code_name(self):
        self.calls.append(("stock_list", {}))
        return Frame([
            {"code": "000001", "name": "平安银行"},
            {"code": "600000", "name": "浦发银行"},
        ])

    def stock_zh_a_hist(self, **kwargs):
        self.calls.append(("stock", kwargs))
        return Frame([{"日期": "2026-07-23", "开盘": 10, "收盘": 11, "最高": 12, "最低": 9, "成交量": 100}])

    def index_zh_a_hist(self, **kwargs):
        self.calls.append(("index", kwargs))
        return Frame([{"日期": "2026-07-23", "开盘": 3000, "收盘": 3010, "最高": 3020, "最低": 2990, "成交量": 1000}])

    def fund_etf_hist_em(self, **kwargs):
        self.calls.append(("fund", kwargs))
        return Frame([{"日期": "2026-07-23", "开盘": 1.02, "收盘": 1.05, "最高": 1.06, "最低": 1.01, "成交量": 120000}])

    def index_stock_info(self):
        self.calls.append(("index_list", {}))
        return Frame([
            {"index_code": "000001", "display_name": "上证指数"},
            {"index_code": "399001", "display_name": "深证成指"},
        ])

    def stock_rank_cxg_ths(self, **kwargs):
        self.calls.append(("new_high", kwargs))
        return Frame([{"股票代码": "600000", "股票简称": "浦发银行", "最新价": 10.52}])

    def stock_rank_lxsz_ths(self, **kwargs):
        self.calls.append(("uptrend", kwargs))
        return Frame([{"股票代码": "600000", "连涨天数": 2}, {"股票代码": "000001", "连涨天数": 5}])

    def stock_rank_cxfl_ths(self, **kwargs):
        self.calls.append(("high_volume", kwargs))
        return Frame([{"股票代码": "600000", "放量天数": 2}, {"股票代码": "000001", "放量天数": 5}])

    def stock_rank_ljqs_ths(self, **kwargs):
        self.calls.append(("rise_volume_price", kwargs))
        return Frame([{"股票代码": "600000", "量价齐升天数": 2}, {"股票代码": "000001", "量价齐升天数": 5}])

    def stock_zt_pool_em(self, **kwargs):
        self.calls.append(("limit_up_pool", kwargs))
        return Frame([{"代码": "600000", "名称": "浦发银行", "涨跌幅": 10.01}])


class AkShareProviderContractTest(unittest.TestCase):
    def test_maps_stock_index_and_etf_to_allowlisted_functions(self):
        api = FakeAkShare()
        for asset_type, code in (("stock", "000001"), ("index", "000300"), ("fund", "563230")):
            response = fetch_history(
                HistoryRequest(asset_type=asset_type, exchange="fund" if asset_type == "fund" else "sz", code=code, timeframe="day", limit=20, end_date="2026-07-24", adjust="qfq"),
                api,
            )
            self.assertEqual(response["source"], "akshare")
            self.assertEqual(response["bars"][0]["date"], "2026-07-23")

        self.assertEqual([call[0] for call in api.calls], ["stock", "index", "fund"])
        self.assertEqual(api.calls[2][1]["symbol"], "563230")
        self.assertEqual(api.calls[2][1]["adjust"], "qfq")

    def test_rejects_invalid_rows_after_normalization(self):
        self.assertEqual(normalize_bars(Frame([{"日期": "2026-07-23", "开盘": "bad"}])), [])

    def test_resolves_index_catalog_records_with_their_exchange(self):
        response = fetch_instruments(InstrumentSearchRequest(asset_type="index", query="000001", limit=20), FakeAkShare())

        self.assertEqual(response["source"], "akshare")
        self.assertEqual(response["items"], [{"assetType": "index", "code": "000001", "exchange": "sh", "name": "上证指数"}])

    def test_keeps_same_code_in_different_asset_catalogs_separate(self):
        response = fetch_instruments(InstrumentSearchRequest(asset_type="stock", query="000001", limit=20), FakeAkShare())

        self.assertEqual(response["items"], [{"assetType": "stock", "code": "000001", "exchange": "sz", "name": "平安银行"}])

    def test_maps_technical_rankings_to_allowlisted_akshare_functions(self):
        api = FakeAkShare()
        new_high = fetch_technical(TechnicalRequest(kind="new_high", category=1), api)
        self.assertEqual(new_high["source"], "akshare")
        self.assertIn("新高分类", new_high["columns"])
        self.assertEqual(new_high["rows"][0]["新高分类"], "半年新高")

        for kind, field in (("uptrend", "连涨天数"), ("high_volume", "放量天数"), ("rise_volume_price", "量价齐升天数")):
            response = fetch_technical(TechnicalRequest(kind=kind, days=3), api)
            self.assertEqual(len(response["rows"]), 1)
            self.assertEqual(response["rows"][0][field], 5)

        limit_up = fetch_technical(TechnicalRequest(kind="limit_up_pool", date="2026-07-24"), api)
        self.assertEqual(limit_up["rows"][0]["代码"], "600000")
        self.assertEqual(api.calls[-1], ("limit_up_pool", {"date": "20260724"}))


if __name__ == "__main__":
    unittest.main()
