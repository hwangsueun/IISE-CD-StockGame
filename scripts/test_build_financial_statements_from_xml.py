import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path


spec = importlib.util.spec_from_file_location("financial_xml", Path(__file__).with_name("build-financial-statements-from-xml.py"))
financial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(financial)


def table(title="연결 손익계산서", values=None, unit="백만원", period=("2013.01.01", "2013.12.31"), fixed="Y"):
    values = values or [("매출액", "14,165,102"), ("영업이익(손실)", "(227,349)"), ("당기순이익", "0")]
    return "\n".join([
        f"<P>{title}</P>", f"<P>제66기 {period[0]} 부터 {period[1]} 까지</P>",
        "<P>제65기 2012.01.01 부터 2012.12.31 까지</P>", f"<P>(단위 : {unit})</P>",
        f'<TABLE AFIXTABLE="{fixed}">', "<TR><TD></TD><TD>제66기</TD><TD>제65기</TD></TR>",
        *[f"<TR><TD>{label}</TD><TD>{value}</TD><TD>999</TD></TR>" for label, value in values], "</TABLE>",
    ])


class FinancialXmlTests(unittest.TestCase):
    def extract(self, body, start="2013년 01월 01일", end="2013년 12월 31일", published="20140331", encoding="utf-8"):
        receipt = published + "002980"
        xml = f'<?xml version="1.0" encoding="utf-8"?><DOCUMENT>\n<P>사업연도 {start} 부터 {end} 까지</P>\n{body}\n</DOCUMENT>'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"2013_{receipt}.zip"
            with zipfile.ZipFile(path, "w") as archive:
                # The main member must win even when a different attachment comes first.
                archive.writestr(f"{receipt}_00761.xml", "<DOCUMENT><P>첨부</P></DOCUMENT>")
                archive.writestr(f"{receipt}.xml", xml.encode(encoding))
            return financial.extract_document(path, {"stock_code": "000660", "rcept_no": receipt,
                                                    "rcept_date": published, "report_name": "사업보고서 (2013.12)"})

    def test_exact_values_losses_real_zero_and_no_comparative_backdating(self):
        records, _ = self.extract(table())
        row = records[0]
        self.assertEqual(row["revenue"], "14165102000000")
        self.assertEqual(row["operating_income"], "-227349000000")
        self.assertEqual(row["net_income"], "0")
        self.assertIsNone(row["total_assets"])
        self.assertEqual(row["published_date"], "2014-03-31")
        self.assertEqual(row["available_date"], "2014-04-01")
        self.assertEqual(row["fiscal_year"], 2013)
        self.assertEqual(len(records), 1)

    def test_large_integer_precision_and_dash_are_preserved(self):
        records, _ = self.extract(table(values=[("매출액", "9,007,199,254,740,993"), ("영업이익", "-"), ("당기순이익", "0")], unit="원"))
        self.assertEqual(records[0]["revenue"], "9007199254740993")
        self.assertIsNone(records[0]["operating_income"])

    def test_cp949_bytes_despite_utf8_declaration_and_main_member(self):
        records, _ = self.extract(table(), encoding="cp949")
        self.assertEqual(records[0]["source"]["encoding"], "cp949")
        self.assertTrue(records[0]["source"]["xml_member"].endswith("002980.xml"))

    def test_distinct_consolidated_and_separate_values(self):
        records, _ = self.extract(table() + "\n" + table(title="손익계산서", values=[("매출액", "123")]))
        rows = {r["fs_div"]: r for r in records}
        self.assertEqual(rows["CFS"]["revenue"], "14165102000000")
        self.assertEqual(rows["OFS"]["revenue"], "123000000")

    def test_non_statement_table_and_foreign_unit_not_assumed_krw(self):
        records, _ = self.extract(table(fixed="N") + "\n" + table(unit="USD"))
        self.assertEqual(records, [])

    def test_actual_six_month_period_is_not_forced_to_calendar_year(self):
        records, _ = self.extract(table(period=("2017.07.01", "2017.12.31")),
                                  start="2017년 07월 01일", end="2017년 12월 31일", published="20180402")
        self.assertEqual(records[0]["period_start"], "2017-07-01")
        self.assertEqual(records[0]["fiscal_year"], 2017)
        self.assertEqual(records[0]["available_date"], "2018-04-03")

    def test_future_period_rejected(self):
        records, audit = self.extract(table(period=("2017.07.01", "2017.12.31")),
                                     start="2017년 07월 01일", end="2017년 12월 31일", published="20170928")
        self.assertEqual(records, [])
        self.assertEqual(audit[0]["reason"], "report_period_ends_after_publication")

    def test_mismatched_table_period_and_conflicting_tables_rejected(self):
        records, _ = self.extract(table(period=("2014.01.01", "2014.12.31")))
        self.assertEqual(records, [])
        records, _ = self.extract(table() + "\n" + table(values=[("매출액", "1")]))
        self.assertEqual(records, [])

    def test_negative_entity_does_not_become_positive(self):
        records, _ = self.extract(table(values=[("매출액", "0"), ("영업이익", "&minus;123")]))
        self.assertEqual(records[0]["operating_income"], "-123000000")

    def test_unrelated_broken_business_text_does_not_repair_statement(self):
        records, _ = self.extract(table() + '\n<P><잘못된 태그></P>')
        self.assertEqual(records[0]["revenue"], "14165102000000")
        self.assertGreater(records[0]["source"]["non_statement_xml_error_count"], 0)

    def test_broken_statement_fragment_is_never_recovered_into_values(self):
        broken = table().replace('<TD>14,165,102</TD>', '<TD>14,165,102</BOGUS>')
        records, audit = self.extract(broken)
        self.assertEqual(records, [])
        self.assertTrue(any(item["reason"] == "statement_fragment_rejected" for item in audit))


if __name__ == "__main__":
    unittest.main()
