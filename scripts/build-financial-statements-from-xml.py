#!/usr/bin/env python3
"""Extract receipt-specific financial statements from local DART document ZIPs.

Requires lxml. Dataless macOS files are skipped rather than implicitly hydrating
the entire archive. Use --hydrate to request downloads before a later run.
Only primary statement tables with explicit period, basis, unit and current
column are accepted. Missing values stay null; comparative columns are unused.
"""
from __future__ import annotations

import argparse
import bisect
import csv
import datetime as dt
import hashlib
import html.entities
import json
import re
import subprocess
import unicodedata
import zipfile
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

from lxml import etree


METRIC_NAMES = {
    "revenue": {"매출액", "수익(매출액)", "영업수익", "매출"},
    "operating_income": {"영업이익", "영업이익(손실)", "영업손익"},
    "net_income": {"당기순이익", "당기순이익(손실)", "당기순손익", "연결당기순이익", "연결총당기순이익"},
    "total_assets": {"자산총계"},
    "total_liabilities": {"부채총계"},
    "total_equity": {"자본총계"},
    "cash_equivalents": {"현금및현금성자산"},
    "inventory": {"재고자산"},
}
INCOME = {"revenue", "operating_income", "net_income"}
BALANCE = set(METRIC_NAMES) - INCOME
DATE_RE = re.compile(r"(\d{4})\s*(?:[./-]|년)\s*(\d{1,2})\s*(?:[./-]|월)\s*(\d{1,2})\s*일?")
TERM_RE = re.compile(r"제\s*(\d+)\s*(?:\([^)]*\)\s*)?기")
TABLE_TAG_RE = re.compile(r"<(/?)TABLE\b[^>]*>")
DATALLESS_FLAG = 0x40000000


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("&cr;", " ").replace("&nbsp;", " ")).strip()


def node_text(node) -> str:
    return clean(" ".join(node.itertext()))


def label_key(value: str) -> str:
    value = re.sub(r"\s+", "", unicodedata.normalize("NFKC", value))
    value = re.sub(r"^(?:[IVXLCDM]+[.·:]|\d+[.·:]|[가-힣]\.)", "", value)
    return value.strip("ㆍ•[] ")


def dates(value: str) -> list[str]:
    result = []
    for match in DATE_RE.finditer(value):
        try:
            result.append(dt.date(*map(int, match.groups())).isoformat())
        except ValueError:
            return []
    return result


def amount_won(value: str, multiplier: int) -> str | None:
    value = re.sub(r"\s+", "", value).replace(",", "").replace("−", "-")
    if value in {"", "-", "—", "N/A", "해당없음"}:
        return None
    if value.startswith("(") and value.endswith(")"):
        value = "-" + value[1:-1]
    if value.startswith(("△", "▲")):
        value = "-" + value[1:]
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", value):
        return None
    try:
        number = Decimal(value) * multiplier
        return str(int(number)) if number == number.to_integral_value() else None
    except InvalidOperation:
        return None


def decode_xml(data: bytes) -> tuple[str, str]:
    try:
        return data.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        return data.decode("cp949"), "cp949"


def statement_title(value: str):
    value = label_key(value)
    value = re.sub(r"^\(\d+\)", "", value)
    match = re.fullmatch(r"(연결)?(재무상태표|포괄손익계산서|손익계산서)", value)
    if not match:
        return None
    return ("CFS" if match.group(1) else "OFS", "BS" if match.group(2) == "재무상태표" else "IS")


def extract_table(table, index: int, report_period: tuple[str, str]):
    if table.get("AFIXTABLE") != "Y":
        return None, "not_an_explicit_primary_statement"
    previous = table.xpath("preceding::P[position() <= 16]")
    title_index = next((i for i in range(len(previous) - 1, -1, -1)
                        if statement_title(node_text(previous[i]))), None)
    if title_index is None:
        return None, "not_an_explicit_primary_statement"
    fs_div, statement = statement_title(node_text(previous[title_index]))
    context = [node_text(p) for p in previous[title_index + 1:]]
    units = set(re.findall(r"단위\s*[:：]\s*(백만원|천원|원)(?![가-힣])", " ".join(context)))
    if len(units) != 1:
        return None, "missing_or_ambiguous_krw_unit"
    source_unit = next(iter(units))
    multiplier = {"원": 1, "천원": 1000, "백만원": 1000000}[source_unit]
    rows = [[c for c in row if c.tag in {"TD", "TH"}] for row in table.findall(".//TR")]
    current = None
    for row in rows[:3]:
        if any(int(c.get("COLSPAN", "1")) != 1 or int(c.get("ROWSPAN", "1")) != 1 for c in row):
            continue
        for column, cell in enumerate(row):
            match = TERM_RE.search(node_text(cell))
            if match:
                current = int(match.group(1)), column
                break
        if current:
            break
    if current is None or current[1] == 0:
        return None, "missing_unambiguous_current_column"
    term, column = current
    period_rows = [dates(p) for p in context if (m := TERM_RE.search(p)) and int(m.group(1)) == term]
    period_rows = [p for p in period_rows if len(p) == (1 if statement == "BS" else 2)]
    if len({tuple(p) for p in period_rows}) != 1:
        return None, "missing_or_ambiguous_current_period"
    period = period_rows[0]
    start, end = (report_period[0], period[0]) if statement == "BS" else tuple(period)
    if (start, end) != report_period:
        return None, "table_period_disagrees_with_report_cover"
    fields, labels, evidence = {}, {}, {}
    allowed = BALANCE if statement == "BS" else INCOME
    for row in rows:
        if len(row) <= column or any(int(c.get("COLSPAN", "1")) != 1 or int(c.get("ROWSPAN", "1")) != 1 for c in row):
            continue
        prefixes = [(node_text(c), label_key(node_text(c))) for c in row[:column]]
        matched = [(metric, raw) for metric in allowed for raw, key in prefixes if key in METRIC_NAMES[metric]]
        if len(matched) != 1:
            continue
        metric, label = matched[0]
        raw = node_text(row[column])
        value = amount_won(raw, multiplier)
        if value is None:
            continue
        if metric in fields and fields[metric] != value:
            return None, "conflicting_duplicate_metric_in_table"
        fields[metric], labels[metric] = value, label
        evidence[metric] = {"table_index": index, "column_index": column, "label": label,
                            "raw_amount": raw, "source_unit": source_unit, "multiplier": multiplier}
    if not fields:
        return None, "no_supported_numeric_metrics"
    return {"fs_div": fs_div, "statement": statement, "period_start": start, "period_end": end,
            "fields": fields, "labels": labels, "evidence": evidence, "table_index": index,
            "context_start_line": previous[title_index].sourceline}, None


def strict_table_fragment(decoded: str, table, line_offsets: list[int]):
    """Validate the accepted table itself without repairing its structure."""
    start = line_offsets[table.sourceline - 1]
    line = decoded[start:line_offsets[table.sourceline] if table.sourceline < len(line_offsets) else len(decoded)]
    if len(re.findall(r"<TABLE\b", line)) != 1:
        raise ValueError("ambiguous_table_start_line")
    start += line.index("<TABLE")
    depth = 0
    for token in TABLE_TAG_RE.finditer(decoded, start):
        depth += -1 if token.group(1) else 1
        if depth == 0:
            end = token.end()
            fragment = decoded[start:end]
            parsed = etree.fromstring(fragment.encode("utf-8"), etree.XMLParser(resolve_entities=False, no_network=True))
            if node_text(parsed) != node_text(table):
                raise ValueError("recovered_table_differs_from_strict_source")
            return fragment, bisect.bisect_right(line_offsets, end)
    raise ValueError("missing_table_end")


def extract_document(path: Path, metadata: dict):
    receipt = metadata["rcept_no"]
    with zipfile.ZipFile(path) as archive:
        members = [n for n in archive.namelist() if Path(n).name == f"{receipt}.xml"]
        if len(members) != 1:
            return [], [{"reason": "missing_or_duplicate_receipt_main_xml"}]
        member = members[0]
        raw = archive.read(member)
    decoded, encoding = decode_xml(raw)
    # Historical files can claim UTF-8 while containing CP949 bytes.
    decoded = re.sub(r"encoding\s*=\s*(['\"])[^'\"]+\1", 'encoding="utf-8"', decoded, count=1)
    parser = etree.XMLParser(resolve_entities=False, no_network=True, recover=True, huge_tree=True)
    # Preserve signs and literal ampersands. Only the proprietary line-break
    # entity is layout; dropping arbitrary entities could turn a loss positive.
    def entity(match):
        name = match.group(1)
        if name in {"amp", "lt", "gt", "quot", "apos"}:
            return match.group(0)
        if name == "cr":
            return " "
        return html.entities.html5.get(name + ";", "&amp;" + name + ";")
    decoded = re.sub(r"&([A-Za-z][\w.-]*);", entity, decoded)
    decoded = re.sub(r"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9A-Fa-f]+;)", "&amp;", decoded)
    doc = etree.fromstring(decoded.encode("utf-8"), parser)
    line_offsets = [0] + [match.end() for match in re.finditer("\n", decoded)]
    parse_error_lines = [error.line for error in parser.error_log if error.level_name in {"ERROR", "FATAL"}]
    cover_text = node_text(doc)
    cover_periods = {tuple(value) for match in re.finditer(r"사\s*업\s*연\s*도\s*(.{0,160}?)까지", cover_text)
                     if len(value := dates(match.group(1))) == 2 and value[0] <= value[1]}
    if len(cover_periods) != 1:
        return [], [{"reason": "missing_or_ambiguous_report_cover_period"}]
    report_period = next(iter(cover_periods))
    published = dt.datetime.strptime(metadata["rcept_date"], "%Y%m%d").date()
    if report_period[1] > published.isoformat():
        return [], [{"reason": "report_period_ends_after_publication"}]
    selected, audit = defaultdict(list), []
    for i, table in enumerate(doc.findall(".//TABLE")):
        candidate, reason = extract_table(table, i, report_period)
        if candidate:
            try:
                fragment, end_line = strict_table_fragment(decoded, table, line_offsets)
                if any(candidate["context_start_line"] <= line <= end_line for line in parse_error_lines):
                    raise ValueError("parse_error_in_statement_context")
                candidate["strict_fragment_sha256"] = hashlib.sha256(fragment.encode("utf-8")).hexdigest()
            except (ValueError, etree.XMLSyntaxError) as error:
                audit.append({"table_index": i, "reason": "statement_fragment_rejected", "detail": str(error)[:180]})
                continue
            selected[candidate["fs_div"]].append(candidate)
        elif reason != "not_an_explicit_primary_statement":
            audit.append({"table_index": i, "reason": reason})
    records = []
    for basis, statements in selected.items():
        fields, labels, evidence, conflict = {}, {}, {}, False
        for statement in statements:
            for key, value in statement["fields"].items():
                if key in fields and fields[key] != value:
                    audit.append({"reason": "conflicting_primary_statement_tables", "fs_div": basis, "metric": key})
                    conflict = True
                fields[key], labels[key], evidence[key] = value, statement["labels"][key], statement["evidence"][key]
        if conflict:
            continue
        records.append({"asset_id": f"STOCK_{metadata['stock_code']}", "fiscal_year": int(report_period[1][:4]),
                        "period": "annual", "period_start": report_period[0], "period_end": report_period[1],
                        "published_date": published.isoformat(), "available_date": (published + dt.timedelta(days=1)).isoformat(),
                        "receipt_no": receipt, "fs_div": basis, "currency": "KRW", "unit": "원",
                        **{key: fields.get(key) for key in METRIC_NAMES}, "metric_labels": labels,
                        "source": {"kind": "dart_document", "path": str(path), "xml_member": member,
                                   "sha256": hashlib.sha256(raw).hexdigest(),
                                   "archive_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                                   "encoding": encoding, "report_name": metadata["report_name"],
                                   "table_indices": sorted({s['table_index'] for s in statements}), "metric_evidence": evidence,
                                   "strict_table_fragments": {str(s['table_index']): s['strict_fragment_sha256'] for s in statements},
                                   "non_statement_xml_error_count": len(parse_error_lines)}})
    if not records:
        audit.append({"reason": "no_unambiguous_primary_statement"})
    return records, audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--documents-dir", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--years", type=int, nargs="*")
    parser.add_argument("--hydrate", action="store_true", help="Request hydration; still skip files that remain dataless")
    args = parser.parse_args()
    index = defaultdict(list)
    with args.index.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            index[(row["stock_code"], row["rcept_no"])].append(row)
    records, excluded, seen = [], [], set()
    for root in args.documents_dir:
        for path in sorted(root.glob("*/*.zip")):
            match = re.fullmatch(r"(\d{4})_(\d{14})\.zip", path.name)
            if not match or (args.years and int(match.group(1)) not in args.years):
                continue
            code, receipt = path.parent.name, match.group(2)
            if (code, receipt) in seen:
                continue
            seen.add((code, receipt))
            base = {"asset_id": f"STOCK_{code}", "receipt_no": receipt, "path": str(path)}
            if getattr(path.stat(), "st_flags", 0) & DATALLESS_FLAG:
                if args.hydrate:
                    subprocess.run(["brctl", "download", str(path)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if getattr(path.stat(), "st_flags", 0) & DATALLESS_FLAG:
                    excluded.append({**base, "reason": "source_not_resident"})
                    continue
            candidates = index[(code, receipt)]
            if not candidates or len({(r['rcept_date'], r['business_year']) for r in candidates}) != 1:
                excluded.append({**base, "reason": "missing_or_ambiguous_receipt_metadata"})
                continue
            metadata = candidates[0]
            if metadata["rcept_date"] != receipt[:8] or metadata["business_year"] != match.group(1):
                excluded.append({**base, "reason": "receipt_metadata_disagrees_with_filename"})
                continue
            try:
                values, audit = extract_document(path, metadata)
                records.extend(values)
                excluded.extend({**base, **item} for item in audit)
            except (ValueError, UnicodeError, zipfile.BadZipFile, etree.XMLSyntaxError) as error:
                excluded.append({**base, "reason": "document_parse_error", "detail": str(error)[:180]})
    records.sort(key=lambda r: (r["asset_id"], r["period_end"], r["published_date"], r["fs_div"]))
    output = {"schema_version": 1, "provenance": {"index_path": str(args.index),
              "index_sha256": hashlib.sha256(args.index.read_bytes()).hexdigest(),
              "available_date_policy": "actual receipt publication date plus one calendar day",
              "selection": "explicit current-column primary statements; no comparative backdating or missing-value substitution"},
              "records": records, "audit": excluded,
              "coverage": {"examined_archives": len(seen), "records": len(records),
                           "assets": len({r['asset_id'] for r in records}), "audit_entries": len(excluded)}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(args.output)
    print(json.dumps(output["coverage"], ensure_ascii=False))


if __name__ == "__main__":
    main()
