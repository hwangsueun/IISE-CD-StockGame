"""Offline source-contract checks; no API calls, keys, or database required."""
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("financial_collector", Path(__file__).with_name("collect-financial-statements.py"))
COLLECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COLLECTOR)


def response(receipt="20211210000418", period="2015.01.01 ~ 2015.12.31"):
    rows = []
    for label, value in [("매출액", "1,000"), ("영업이익", "-100"), ("당기순이익(손실)", "0")]:
        rows.append({"corp_code": "00000001", "stock_code": "000001", "bsns_year": "2015", "rcept_no": receipt,
            "fs_div": "CFS", "sj_div": "IS", "account_nm": label, "currency": "KRW", "thstrm_dt": period, "thstrm_amount": value})
    return {"business_year": 2015, "filename": "test.raw.json", "sha256": "a" * 64, "payload": {"status": "000", "list": rows}}


class FinancialSourceContract(unittest.TestCase):
    def test_late_receipt_does_not_become_available_in_original_fiscal_year(self):
        records, _ = COLLECTOR.normalize_responses([response()], {"000001": "00000001"})
        self.assertEqual(records[0]["published_date"], "2021-12-10")
        self.assertEqual(records[0]["available_date"], "2021-12-11")
        self.assertEqual(records[0]["fiscal_year"], 2015)
        self.assertEqual((records[0]["revenue"], records[0]["operating_income"], records[0]["net_income"]), ("1000", "-100", "0"))

    def test_short_fiscal_period_is_preserved_instead_of_assuming_january(self):
        records, _ = COLLECTOR.normalize_responses([response("20180402000954", "2017.07.01 ~ 2017.12.31")], {"000001": "00000001"})
        self.assertEqual(records[0]["period_start"], "2017-07-01")
        self.assertEqual(records[0]["period_end"], "2017-12-31")
        self.assertEqual(records[0]["fiscal_year"], 2017)

    def test_future_period_or_mixed_currency_is_excluded(self):
        for fixture in [response("20170928000001", "2017.07.01 ~ 2017.12.31"), response()]:
            if fixture["payload"]["list"][0]["rcept_no"].startswith("2021"):
                fixture["payload"]["list"][0]["currency"] = "USD"
            records, audit = COLLECTOR.normalize_responses([fixture], {"000001": "00000001"})
            self.assertEqual(records, [])
            self.assertTrue(audit)

    def test_full_total_profit_is_distinct_from_parent_and_pretax_values(self):
        selected, audit = COLLECTOR.extract_full_metrics([
            {"sj_div": "IS", "account_id": "ifrs-full_ProfitLoss", "account_nm": "당기순이익", "thstrm_amount": "100"},
            {"sj_div": "IS", "account_id": "ifrs-full_ProfitLossAttributableToOwnersOfParent", "account_nm": "지배기업 순이익", "thstrm_amount": "90"},
            {"sj_div": "IS", "account_id": "ifrs-full_ProfitLossBeforeTax", "account_nm": "법인세차감전 순이익", "thstrm_amount": "120"},
        ])
        self.assertEqual(selected["net_income"]["amount"], "100")
        self.assertEqual(audit, [])

    def test_custom_roman_numbered_label_is_matched_without_rewriting_original_label(self):
        selected, _ = COLLECTOR.extract_full_metrics([
            {"sj_div": "IS", "account_id": "-표준계정코드 미사용-", "account_nm": "VIII. 당기순이익", "thstrm_amount": "100"},
        ])
        self.assertEqual(selected["net_income"]["amount"], "100")
        self.assertEqual(selected["net_income"]["account_label"], "VIII. 당기순이익")

    def test_different_full_receipt_cannot_fill_missing_major_metric(self):
        major, _ = COLLECTOR.normalize_responses([response()], {"000001": "00000001"})
        major[0]["revenue"] = None
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            raw = json.dumps({"status": "000", "list": [{"rcept_no": "20221210000418", "currency": "KRW",
                "corp_code": "00000001", "bsns_year": "2015", "sj_div": "IS", "account_id": "ifrs_Revenue",
                "account_nm": "매출액", "thstrm_amount": "999"}]}).encode()
            raw_file = directory / "full.json"
            COLLECTOR.private_write(raw_file, raw)
            manifest = directory / "cache.json"
            COLLECTOR.write_json(manifest, {"files": [{"stock_code": "000001", "business_year": 2015, "fs_div": "CFS",
                "raw_path": str(raw_file), "sha256": hashlib.sha256(raw).hexdigest()}]})
            with redirect_stdout(io.StringIO()):
                records, _, audit = COLLECTOR.supplement_records(major, {"000001": "00000001"}, "fake-secret", directory, manifest)
            self.assertIsNone(records[0]["revenue"])
            self.assertEqual(audit[0]["reason"], "full_receipt_currency_corporation_or_year_mismatch")
            self.assertEqual(raw_file.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                COLLECTOR.private_write(raw_file, b"overwrite")

    def test_zero_negative_and_missing_values_remain_distinct(self):
        self.assertEqual(COLLECTOR.amount(0), "0")
        self.assertEqual(COLLECTOR.amount("0"), "0")
        self.assertEqual(COLLECTOR.amount("(123,456)"), "-123456")
        self.assertIsNone(COLLECTOR.amount(None))
        self.assertIsNone(COLLECTOR.amount(""))
        with self.assertRaises(ValueError):
            COLLECTOR.amount("1.5")


if __name__ == "__main__":
    unittest.main()
