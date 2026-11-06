#!/usr/bin/env python3
"""Merge audited filing versions without mixing amounts between source records.

Same receipt/scope/period: prefer an exact-won API record as a whole. Earlier
XML receipts remain separate versions. Differences beyond half the XML source
unit, period disagreements, or invalid native rows block publication.
"""

import argparse
import copy
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
VERSION = "dart-financials-2026-11-06-v1"
METRICS = ("revenue", "operating_income", "net_income", "total_assets", "total_liabilities", "total_equity")
PRIVATE_FIELDS = {"crtfc_key", "api_key", "dart_api_key", "corp_name", "stock_name", "company_name", "issuer_name", "dart_name", "input_name"}
SOURCE_KINDS = {"dart_major_accounts", "dart_full_accounts", "dart_document"}


def canonical_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def replace_private(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as output:
        output.write(raw)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def record_key(row):
    return tuple(row.get(field) for field in ("asset_id", "receipt_no", "fs_div", "period_end"))


def parse_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("invalid_date")
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError("invalid_date")
    return parsed


def original_amount(value, multiplier):
    text = re.sub(r"\s+", "", value).replace(",", "").replace("−", "-")
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]
    if text.startswith(("△", "▲")):
        text = "-" + text[1:]
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", text):
        raise ValueError("unparseable_original_amount")
    result = Decimal(text) * multiplier
    if result != result.to_integral_value():
        raise ValueError("noninteger_original_amount")
    return int(result)


def validate_private_metadata(value):
    if isinstance(value, dict):
        for key, entry in value.items():
            if key.lower() in PRIVATE_FIELDS:
                raise ValueError("forbidden_private_field")
            if key in ("sha256", "archive_sha256") and (not isinstance(entry, str) or not re.fullmatch(r"[a-f0-9]{64}", entry)):
                raise ValueError("invalid_source_hash")
            if key == "strict_table_fragments" and (not isinstance(entry, dict) or any(not isinstance(item, str) or not re.fullmatch(r"[a-f0-9]{64}", item) for item in entry.values())):
                raise ValueError("invalid_statement_fragment_hash")
            validate_private_metadata(entry)
    elif isinstance(value, list):
        for entry in value:
            validate_private_metadata(entry)
    elif isinstance(value, str):
        if re.search(r"(?:[?&]|%26)(?:crtfc_key|api_key|dart_api_key)(?:=|%3D)", value, re.I):
            raise ValueError("credential_in_url")
        for key in ("DART_API_KEY", "OPENDART_API_KEY"):
            secret = os.environ.get(key)
            if secret and secret in value:
                raise ValueError("credential_in_metadata")


def normalized_record(row, universe):
    if row.get("asset_id") not in universe or not re.fullmatch(r"\d{14}", row.get("receipt_no", "")):
        raise ValueError("invalid_asset_or_receipt")
    if row.get("fs_div") not in ("CFS", "OFS") or not re.fullmatch(r"[A-Z]{3}", row.get("currency", "")):
        raise ValueError("invalid_scope_or_currency")
    start, end, published, available = [parse_date(row.get(field)) for field in ("period_start", "period_end", "published_date", "available_date")]
    if start > end or end > published or available != published + timedelta(days=1) or row.get("fiscal_year") != end.year:
        raise ValueError("invalid_period_or_maturity")
    source = row.get("source")
    if not isinstance(source, dict) or source.get("kind") not in SOURCE_KINDS or not re.fullmatch(r"[0-9a-f]{64}", source.get("sha256", "")):
        raise ValueError("invalid_source")
    validate_private_metadata(source)
    result = {field: copy.deepcopy(row[field]) for field in ("asset_id", "fiscal_year", "period_start", "period_end", "published_date", "available_date", "receipt_no", "fs_div", "currency", "source")}
    for metric in METRICS:
        value = row.get(metric)
        if value is not None and (not isinstance(value, str) or not re.fullmatch(r"-?\d+", value)):
            raise ValueError("invalid_integer_string:" + metric)
        result[metric] = None if value is None else str(int(value))
        if value is not None and source["kind"] == "dart_document":
            evidence = source.get("metric_evidence", {}).get(metric)
            if not isinstance(evidence, dict) or not isinstance(evidence.get("multiplier"), int) or evidence["multiplier"] <= 0:
                raise ValueError("missing_xml_metric_precision:" + metric)
            if {"원": 1, "천원": 1000, "백만원": 1000000, "억원": 100000000}.get(evidence.get("source_unit")) != evidence["multiplier"]:
                raise ValueError("xml_unit_multiplier_mismatch:" + metric)
            try:
                if original_amount(evidence.get("raw_amount", ""), evidence["multiplier"]) != int(value):
                    raise ValueError("xml_amount_does_not_match_evidence:" + metric)
            except InvalidOperation:
                raise ValueError("invalid_xml_original_amount:" + metric) from None
    if not any(result[metric] is not None for metric in METRICS):
        raise ValueError("unsupported_only_metrics" if source["kind"] == "dart_document" else "no_native_values")
    labels = row.get("metric_labels", {})
    if not isinstance(labels, dict) or any(not isinstance(value, str) or len(value) > 100 for field, value in labels.items() if field in METRICS):
        raise ValueError("invalid_metric_label")
    result["metric_labels"] = {field: labels[field] for field in METRICS if field in labels}
    return result


def compare_overlap(api, xml):
    blockers, comparisons = [], []
    for field in ("period_start", "published_date", "available_date", "currency", "fiscal_year"):
        if api[field] != xml[field]:
            blockers.append({"reason": "overlap_identity_metadata_mismatch", "field": field, "api": api[field], "xml": xml[field]})
    for metric in METRICS:
        if api[metric] is None or xml[metric] is None:
            continue
        multiplier = xml["source"]["metric_evidence"][metric]["multiplier"]
        delta = abs(int(api[metric]) - int(xml[metric]))
        comparison = {"metric": metric, "api": api[metric], "xml": xml[metric], "difference_won": str(delta), "source_unit_multiplier": multiplier}
        comparisons.append(comparison)
        if delta * 2 > multiplier:
            blockers.append({"reason": "overlap_amount_exceeds_xml_precision", **comparison})
    return blockers, comparisons


def merge_records(api_records, xml_records, universe):
    chosen, audit = {}, {"blockers": [], "excluded": [], "overlaps": [], "nulls_preserved": []}
    for input_kind, rows in (("api", api_records), ("xml", xml_records)):
        for row in sorted(rows, key=canonical_bytes):
            identity = {"key": list(record_key(row)), "input": input_kind}
            try:
                record = normalized_record(row, universe)
            except (ValueError, TypeError, KeyError) as error:
                item = {**identity, "reason": str(error)}
                audit["excluded" if str(error) == "unsupported_only_metrics" else "blockers"].append(item)
                continue
            key = record_key(record)
            if key not in chosen:
                chosen[key] = record
                continue
            previous = chosen[key]
            is_api = lambda entry: entry["source"]["kind"] != "dart_document"
            if is_api(previous) and not is_api(record):
                problems, fields = compare_overlap(previous, record)
                audit["blockers"].extend({**identity, **problem} for problem in problems)
                status = "rounded_source" if any(int(field["difference_won"]) for field in fields) else "exact_numeric_match"
                if not problems:
                    previous["source"].setdefault("corroborations", []).append({"status": status, "source": copy.deepcopy(record["source"]), "comparisons": fields})
                    if status == "rounded_source":
                        previous["source"]["rounded_source"] = True
                    null_fields = [metric for metric in METRICS if previous[metric] is None and record[metric] is not None]
                    if null_fields:
                        audit["nulls_preserved"].append({**identity, "metrics": null_fields})
                audit["overlaps"].append({**identity, "selected": "api_whole_record", "status": status, "comparisons": fields, "blocked": bool(problems)})
            else:
                # Duplicate rows within one input must agree; never merge their nulls.
                differing = [field for field in (*METRICS, "period_start", "published_date", "available_date", "currency") if previous[field] != record[field]]
                if differing:
                    audit["blockers"].append({**identity, "reason": "conflicting_duplicate_within_source", "fields": differing})
    records = sorted(chosen.values(), key=lambda row: tuple(row[field] for field in ("asset_id", "period_end", "available_date", "receipt_no", "fs_div", "period_start")))
    coverage = sorted({row["asset_id"] for row in records})
    missing = sorted(universe - set(coverage))
    if missing:
        audit["blockers"].append({"reason": "missing_universe_coverage", "asset_ids": missing})
    audit["coverage"] = {"assets": len(coverage), "asset_ids": coverage, "records": len(records)}
    return records, audit


def native_validate(candidate, module):
    code = """const fs=require('node:fs');const target=require(process.argv[1]);
try{const value=target.validateBundle(fs.readFileSync(process.argv[2]));
console.log(JSON.stringify({passed:true,version:value.version,records:value.records.length,sha256:value.sha256}));}
finally{require(require('node:path').resolve(require('node:path').dirname(process.argv[1]),'../src/db')).pool.end();}"""
    process = subprocess.run(["node", "-e", code, str(module.resolve()), str(candidate.resolve())], capture_output=True, text=True)
    if process.returncode:
        return {"passed": False, "reason": "native_validator_rejected", "diagnostic": process.stderr[-1500:]}
    return json.loads(process.stdout.strip().splitlines()[-1])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", type=Path, required=True)
    parser.add_argument("--xml", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", default=VERSION)
    parser.add_argument("--universe", type=Path, default=ROOT / "server/src/data/stockSectorClassification.json")
    parser.add_argument("--native-module", type=Path, default=ROOT / "server/seeds/import_financials.js")
    args = parser.parse_args()
    api_raw, xml_raw = args.api.read_bytes(), args.xml.read_bytes()
    api_data, xml_data = json.loads(api_raw), json.loads(xml_raw)
    universe = {"STOCK_" + str(item["code"]).zfill(6) for item in json.loads(args.universe.read_text())["stocks"]}
    records, audit = merge_records(api_data["records"], xml_data["records"], universe)
    inputs = {"api": {"sha256": hashlib.sha256(api_raw).hexdigest(), "records": len(api_data["records"])},
        "xml": {"sha256": hashlib.sha256(xml_raw).hexdigest(), "records": len(xml_data["records"])}}
    audit["inputs"] = inputs
    audit_path = args.output.with_name(args.output.stem + ".audit.json")
    if audit["blockers"]:
        replace_private(audit_path, canonical_bytes(audit))
        print(json.dumps({"passed": False, "blockers": len(audit["blockers"]), "audit": str(audit_path)}))
        return 1
    bundle = {"schema_version": 1, "version": args.version, "provenance": {"inputs": inputs,
        "policy": "API whole record for identical receipt/scope/period; distinct XML receipts retained; no null mixing",
        "xml_precision_comparison": "absolute difference <= reported unit multiplier / 2; rounding method not asserted"}, "records": records}
    candidate = args.output.with_name(args.output.name + ".candidate")
    replace_private(candidate, canonical_bytes(bundle))
    audit["native_validator"] = native_validate(candidate, args.native_module)
    replace_private(audit_path, canonical_bytes(audit))
    if not audit["native_validator"]["passed"]:
        print(json.dumps({"passed": False, "reason": "native_validator_rejected", "audit": str(audit_path)}))
        return 1
    os.replace(candidate, args.output)
    print(json.dumps({"passed": True, "version": args.version, "records": len(records), "assets": len(universe),
        "overlaps": len(audit["overlaps"]), "rounded_sources": sum(item["status"] == "rounded_source" for item in audit["overlaps"]),
        "excluded": len(audit["excluded"]), "sha256": audit["native_validator"]["sha256"], "output": str(args.output), "audit": str(audit_path)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
