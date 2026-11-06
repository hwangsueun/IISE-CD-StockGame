"""Offline merge/precision/privacy contract tests. No database or network calls."""
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("financial_packager", Path(__file__).with_name("package-financial-statements.py"))
PACKAGER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGER)
UNIVERSE = {"STOCK_000001"}


def record(kind="dart_major_accounts", revenue="1000000", multiplier=1000):
    result = {"asset_id": "STOCK_000001", "receipt_no": "20160330000001", "fiscal_year": 2015,
        "period_start": "2015-01-01", "period_end": "2015-12-31", "published_date": "2016-03-30",
        "available_date": "2016-03-31", "fs_div": "CFS", "currency": "KRW", "metric_labels": {"revenue": "매출액"},
        "source": {"kind": kind, "sha256": "a" * 64}}
    result.update({field: None for field in PACKAGER.METRICS})
    result["revenue"] = revenue
    if kind == "dart_document":
        result["source"]["metric_evidence"] = {"revenue": {"raw_amount": "1000", "source_unit": "천원", "multiplier": multiplier, "label": "매출액"}}
    return result


class FinancialPackagingContract(unittest.TestCase):
    def test_api_wins_whole_record_and_preserves_xml_source_evidence(self):
        api, xml = record(revenue="1000499"), record("dart_document")
        merged, audit = PACKAGER.merge_records([api], [xml], UNIVERSE)
        self.assertEqual(audit["blockers"], [])
        self.assertEqual(merged[0]["revenue"], "1000499")
        self.assertTrue(merged[0]["source"]["rounded_source"])
        self.assertEqual(merged[0]["source"]["corroborations"][0]["source"], xml["source"])
        self.assertNotIn("corroborations", api["source"])

    def test_more_than_half_source_unit_blocks_without_silently_accepting(self):
        _, audit = PACKAGER.merge_records([record(revenue="1000501")], [record("dart_document")], UNIVERSE)
        self.assertEqual(audit["blockers"][0]["reason"], "overlap_amount_exceeds_xml_precision")

    def test_exact_half_unit_is_within_contract(self):
        _, audit = PACKAGER.merge_records([record(revenue="1000500")], [record("dart_document")], UNIVERSE)
        self.assertEqual(audit["blockers"], [])

    def test_different_receipt_remains_an_independent_historical_version(self):
        xml = record("dart_document")
        xml.update(receipt_no="20160301000001", published_date="2016-03-01", available_date="2016-03-02")
        merged, audit = PACKAGER.merge_records([record()], [xml], UNIVERSE)
        self.assertEqual(len(merged), 2)
        self.assertEqual(audit["blockers"], [])

    def test_period_start_or_availability_mismatch_blocks_same_key(self):
        xml = record("dart_document")
        xml["period_start"] = "2015-07-01"
        _, audit = PACKAGER.merge_records([record()], [xml], UNIVERSE)
        self.assertTrue(any(item.get("field") == "period_start" for item in audit["blockers"]))

    def test_null_amounts_are_not_transplanted_from_xml(self):
        api = record(revenue=None)
        api["operating_income"] = "10"
        merged, audit = PACKAGER.merge_records([api], [record("dart_document")], UNIVERSE)
        self.assertIsNone(merged[0]["revenue"])
        self.assertEqual(merged[0]["operating_income"], "10")
        self.assertEqual(audit["nulls_preserved"][0]["metrics"], ["revenue"])

    def test_unsupported_only_xml_values_are_explicitly_excluded(self):
        xml = record("dart_document", revenue=None)
        xml["cash_equivalents"] = "1"
        merged, audit = PACKAGER.merge_records([record()], [xml], UNIVERSE)
        self.assertEqual(len(merged), 1)
        self.assertEqual(audit["excluded"][0]["reason"], "unsupported_only_metrics")

    def test_original_amount_and_unit_must_match_native_integer(self):
        fixture = record("dart_document")
        fixture["source"]["metric_evidence"]["revenue"]["raw_amount"] = "999"
        _, audit = PACKAGER.merge_records([record()], [fixture], UNIVERSE)
        self.assertTrue(audit["blockers"])
        xml = record("dart_document")
        xml["source"]["metric_evidence"]["revenue"]["source_unit"] = "원"
        _, audit = PACKAGER.merge_records([record()], [xml], UNIVERSE)
        self.assertIn("xml_unit_multiplier_mismatch", audit["blockers"][0]["reason"])

    def test_private_issuer_fields_and_secret_urls_are_rejected(self):
        for field, value in [("corp_name", "private issuer"), ("endpoint", "https://example.test/?crtfc_key=secret")]:
            api = record()
            api["source"][field] = value
            _, audit = PACKAGER.merge_records([api], [], UNIVERSE)
            self.assertTrue(audit["blockers"])

    def test_input_order_does_not_change_deterministic_bundle_records(self):
        first, second = record("dart_document"), record("dart_document")
        second.update(receipt_no="20160301000001", published_date="2016-03-01", available_date="2016-03-02")
        a, _ = PACKAGER.merge_records([record()], [first, second], UNIVERSE)
        b, _ = PACKAGER.merge_records([record()], [second, first], UNIVERSE)
        self.assertEqual(PACKAGER.canonical_bytes(a), PACKAGER.canonical_bytes(b))


if __name__ == "__main__":
    unittest.main()
