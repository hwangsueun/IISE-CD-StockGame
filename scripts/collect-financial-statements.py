#!/usr/bin/env python3
"""Collect official OpenDART major-account responses without database writes.

Requires DART_API_KEY in the environment or --env-file; the key and request URL
are never logged or saved. Raw files and derived records use mode 0600.
Guide: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS002&apiId=2019017
The API returns the filing it currently serves, including later corrections.
Never assign its values the date of an earlier filing or comparative period.
"""

import argparse
import copy
import csv
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = "https://opendart.fss.or.kr/api/fnlttMultiAcnt.json"
METRICS = {
    "revenue": ("IS", {"매출액", "영업수익"}),
    "operating_income": ("IS", {"영업이익", "영업이익(손실)", "영업손익"}),
    "net_income": ("IS", {"당기순이익(손실)", "당기순이익", "당기순손익"}),
    "total_assets": ("BS", {"자산총계"}),
    "total_liabilities": ("BS", {"부채총계"}),
    "total_equity": ("BS", {"자본총계"}),
}


class AuditError(Exception):
    pass


def private_write(path, content):
    """Never overwrite a previous evidence file."""
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
        output.write(content)
    os.chmod(path, 0o600)


def write_json(path, content):
    private_write(path, (json.dumps(content, ensure_ascii=False, indent=2) + "\n").encode())


def read_key(env_file):
    key = os.environ.get("DART_API_KEY", "").strip()
    if not key and env_file:
        for line in Path(env_file).read_text().splitlines():
            match = re.match(r"^\s*(?:export\s+)?DART_API_KEY\s*=\s*(.*?)\s*$", line)
            if match:
                key = match[1].strip().strip("\"'")
                break
    if not key:
        raise AuditError("DART_API_KEY is unavailable")
    return key


def load_universe(universe_file, map_file):
    universe = json.loads(Path(universe_file).read_text())
    codes = sorted({str(row["code"]).zfill(6) for row in universe["stocks"]})
    mapping = {code: set() for code in codes}
    with Path(map_file).open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            code = row["stock_code"].zfill(6)
            if code in mapping:
                mapping[code].add(row["corp_code"].zfill(8))
    if any(not re.fullmatch(r"\d{6}", code) for code in codes):
        raise AuditError("Invalid universe stock code")
    if any(len(values) != 1 or not re.fullmatch(r"\d{8}", next(iter(values))) for values in mapping.values()):
        raise AuditError("A stock has a missing or ambiguous corporation code")
    return {code: next(iter(mapping[code])) for code in codes}


def fetch_raw(key, params, timeout, endpoint=ENDPOINT):
    query = urllib.parse.urlencode({"crtfc_key": key, **params})
    try:
        with urllib.request.urlopen(endpoint + "?" + query, timeout=timeout) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        raise AuditError(f"OpenDART HTTP status {error.code}; no URL logged") from None
    except Exception:
        raise AuditError("OpenDART transport failed; no URL logged") from None
    if key.encode() in raw:
        raise AuditError("Response echoed a credential; refusing to save")
    return status, raw


def period_dates(value):
    parts = re.findall(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", value or "")
    return [date(*(int(part) for part in item)) for item in parts]


def amount(value):
    text = ("" if value is None else str(value)).strip().replace(",", "")
    if text in ("", "-", "—"):
        return None
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]
    if not re.fullmatch(r"-?\d+", text):
        raise ValueError("noninteger amount")
    return str(int(text))


def normalize_responses(responses, mapping):
    records, audit = [], []
    reverse = {corp: code for code, corp in mapping.items()}
    for response in responses:
        groups = {}
        year = str(response["business_year"])
        for row in response["payload"].get("list", []):
            code = reverse.get(row.get("corp_code"))
            if not code or str(row.get("bsns_year")) != year:
                audit.append({"reason": "unknown_corporation_or_wrong_year", "source_file": response["filename"]})
                continue
            groups.setdefault(code, []).append(row)
        for code, stock_rows in groups.items():
            fs_div = "CFS" if any(row.get("fs_div") == "CFS" for row in stock_rows) else "OFS"
            scope_rows = [row for row in stock_rows if row.get("fs_div") == fs_div]
            receipts = {row.get("rcept_no") for row in scope_rows}
            for receipt in sorted(receipts, key=str):
                rows = [row for row in scope_rows if row.get("rcept_no") == receipt]
                identity = {"asset_id": "STOCK_" + code, "requested_business_year": int(year), "receipt_no": receipt, "fs_div": fs_div}
                try:
                    if not re.fullmatch(r"\d{14}", receipt or ""):
                        raise ValueError("invalid_receipt")
                    published = datetime.strptime(receipt[:8], "%Y%m%d").date()
                    currencies = {row.get("currency") for row in rows}
                    if len(currencies) != 1 or not re.fullmatch(r"[A-Z]{3}", next(iter(currencies)) or ""):
                        raise ValueError("invalid_or_mixed_currency")
                    periods = {tuple(period_dates(row.get("thstrm_dt"))) for row in rows if row.get("sj_div") == "IS"}
                    if len(periods) != 1 or len(next(iter(periods))) != 2:
                        raise ValueError("missing_or_conflicting_income_period")
                    start, end = next(iter(periods))
                    if start > end or published < end:
                        raise ValueError("period_after_publication_or_reversed")
                except (ValueError, TypeError) as error:
                    audit.append({**identity, "reason": str(error), "source_file": response["filename"]})
                    continue
                record = {
                    "asset_id": identity["asset_id"], "fiscal_year": end.year,
                    "period_start": start.isoformat(), "period_end": end.isoformat(),
                    "published_date": published.isoformat(), "available_date": (published + timedelta(days=1)).isoformat(),
                    "receipt_no": receipt, "fs_div": fs_div, "currency": next(iter(currencies)), "metric_labels": {},
                    "source": {"kind": "dart_major_accounts", "sha256": response["sha256"], "raw_file": response["filename"],
                        "endpoint": ENDPOINT, "report_code": "11011", "requested_business_year": int(year),
                        "published_date_basis": "actual_response_receipt_number_date_prefix",
                        "period_basis": "income_statement_thstrm_dt", "label_basis": "api_standardized_major_account_labels"},
                }
                for metric, (statement, labels) in METRICS.items():
                    matches = [row for row in rows if row.get("sj_div") == statement and row.get("account_nm") in labels]
                    try:
                        if statement == "BS" and any(period_dates(row.get("thstrm_dt")) != [end] for row in matches):
                            raise ValueError("balance_sheet_date_mismatch")
                        values = {amount(row.get("thstrm_amount")) for row in matches}
                        if len(values) > 1:
                            raise ValueError("conflicting_metric_values")
                        record[metric] = next(iter(values)) if values else None
                        if matches:
                            record["metric_labels"][metric] = " / ".join(sorted({row["account_nm"] for row in matches}))
                    except ValueError as error:
                        record[metric] = None
                        audit.append({**identity, "metric": metric, "reason": str(error), "source_file": response["filename"]})
                    if record[metric] is None:
                        audit.append({**identity, "metric": metric, "reason": "missing_metric", "source_file": response["filename"]})
                if all(record[metric] is None for metric in ("revenue", "operating_income", "net_income")):
                    audit.append({**identity, "reason": "no_income_metrics", "source_file": response["filename"]})
                    continue
                records.append(record)
    records.sort(key=lambda row: (row["asset_id"], row["period_end"], row["published_date"]))
    return records, audit


FULL_ENDPOINT = "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json"
FULL_IDS = {
    "revenue": {"ifrs_Revenue", "ifrs-full_Revenue"},
    "operating_income": {"dart_OperatingIncomeLoss"},
    "net_income": {"ifrs_ProfitLoss", "ifrs-full_ProfitLoss"},
    "total_assets": {"ifrs_Assets", "ifrs-full_Assets"},
    "total_liabilities": {"ifrs_Liabilities", "ifrs-full_Liabilities"},
    "total_equity": {"ifrs_Equity", "ifrs-full_Equity"},
}
FULL_LABELS = {metric: set(labels) for metric, (_, labels) in METRICS.items()}
# Verified custom total labels in the frozen full responses. Do not use broad
# substring matching: pre-tax, continuing-only and owners-only profit differ.
FULL_LABELS["revenue"].update({"매출과 지분법손익(영업수익)", "매출액 및 지분법손익"})
FULL_LABELS["net_income"].update({"연결당기순이익", "연결당기순이익(손실)", "연결당기순손익"})


def comparable_label(label):
    without_number = re.sub(r"^\s*[IVXLCDMⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.)·]\s*", "", label or "")
    return re.sub(r"\s+", "", without_number)


def extract_full_metrics(rows):
    """Use exact total-account IDs; custom labels are an explicit fallback."""
    selected, problems = {}, []
    for metric, (statement, labels) in METRICS.items():
        statements = {"IS", "CIS"} if statement == "IS" else {"BS"}
        section = [row for row in rows if row.get("sj_div") in statements]
        candidates = [row for row in section if row.get("account_id") in FULL_IDS[metric]]
        if not candidates:
            accepted = {comparable_label(label) for label in FULL_LABELS[metric]}
            candidates = [row for row in section if comparable_label(row.get("account_nm")) in accepted]
        try:
            values = {amount(row.get("thstrm_amount")) for row in candidates}
            if len(values) > 1:
                raise ValueError("conflicting_full_account_values")
            value = next(iter(values)) if values else None
            if value is None:
                selected[metric] = None
                continue
            # IS and CIS may repeat the same total. Preserve the actual selected ID/label.
            candidates.sort(key=lambda row: (row.get("sj_div") != "IS", str(row.get("ord", ""))))
            row = candidates[0]
            selected[metric] = {"amount": value, "account_id": row.get("account_id"),
                "account_label": row.get("account_nm"), "statement": row.get("sj_div"), "ord": row.get("ord")}
        except ValueError as error:
            selected[metric] = None
            problems.append({"metric": metric, "reason": str(error)})
    return selected, problems


def supplement_records(records, mapping, key, output_dir, cache_manifest=None, timeout=60, delay=0.25):
    cache = {}
    if cache_manifest:
        for item in json.loads(Path(cache_manifest).read_text())["files"]:
            cache[(item["stock_code"], int(item["business_year"]), item["fs_div"])] = item
    enriched, requests, audit = copy.deepcopy(records), [], []
    for record in enriched:
        code = record["asset_id"].removeprefix("STOCK_")
        year, fs_div = record["source"]["requested_business_year"], record["fs_div"]
        identity = {key: record[key] for key in ("asset_id", "receipt_no", "fs_div")}
        cache_key = (code, year, fs_div)
        missing = [metric for metric in ("revenue", "operating_income", "net_income") if record[metric] is None]
        if not missing and cache_key not in cache:
            continue
        params = {"corp_code": mapping[code], "bsns_year": str(year), "reprt_code": "11011", "fs_div": fs_div}
        if cache_key in cache:
            item = cache[cache_key]
            raw = Path(item["raw_path"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != item["sha256"]:
                raise AuditError("Cached full response checksum mismatch")
            raw_path, http_status, reused = item["raw_path"], 200, True
        else:
            http_status, raw = fetch_raw(key, params, timeout, FULL_ENDPOINT)
            raw_path = str(output_dir / f"fnlttSinglAcntAll_{code}_{year}_{fs_div}.raw.json")
            private_write(Path(raw_path), raw)
            reused = False
        if key.encode() in raw:
            raise AuditError("Credential in cached or fetched full response")
        payload = json.loads(raw)
        sha256 = hashlib.sha256(raw).hexdigest()
        request = {"asset_id": record["asset_id"], "business_year": year, "fs_div": fs_div,
            "raw_path": raw_path, "sha256": sha256, "status": payload.get("status"),
            "account_rows": len(payload.get("list", [])), "reused": reused}
        requests.append(request)
        if not reused:
            write_json(Path(raw_path + ".metadata.json"), request)
        print(json.dumps({"full_supplement": record["asset_id"], "year": year, "fs_div": fs_div,
            "status": payload.get("status"), "reused": reused}), flush=True)
        if http_status != 200 or payload.get("status") not in ("000", "013"):
            raise AuditError("Full-account API failed; collection stopped with raw evidence")
        rows = payload.get("list", [])
        if payload.get("status") != "000" or not rows:
            audit.append({**identity, "reason": "full_response_unavailable"})
            continue
        if any(row.get("rcept_no") != record["receipt_no"] or row.get("currency") != record["currency"]
            or row.get("corp_code") != mapping[code] or str(row.get("bsns_year")) != str(year) for row in rows):
            audit.append({**identity, "reason": "full_receipt_currency_corporation_or_year_mismatch", "full_receipts": sorted({row.get("rcept_no") for row in rows})})
            continue
        selected, problems = extract_full_metrics(rows)
        audit.extend({**identity, **problem} for problem in problems)
        metadata = {"kind": "dart_full_accounts", "sha256": sha256, "raw_file": raw_path,
            "endpoint": FULL_ENDPOINT, "report_code": "11011", "requested_business_year": year,
            "receipt_no": record["receipt_no"], "fs_div": fs_div, "currency": record["currency"],
            "period_anchor": copy.deepcopy(record["source"]), "metric_accounts": {metric: value for metric, value in selected.items() if value}}
        if all(selected.values()):
            for metric, selected_row in selected.items():
                if record[metric] is not None and record[metric] != selected_row["amount"]:
                    audit.append({**identity, "metric": metric, "reason": "full_value_differs_from_major", "major": record[metric], "full": selected_row["amount"]})
                record[metric] = selected_row["amount"]
                record["metric_labels"][metric] = selected_row["account_label"]
            record["source"] = metadata
        else:
            adopted = {}
            for metric in missing:
                if selected[metric]:
                    record[metric] = selected[metric]["amount"]
                    record["metric_labels"][metric] = selected[metric]["account_label"]
                    adopted[metric] = selected[metric]
            if adopted:
                record["source"]["full_supplement"] = {**metadata, "adopted_metrics": adopted}
        still_missing = [metric for metric in missing if record[metric] is None]
        if still_missing:
            audit.append({**identity, "reason": "income_metric_still_missing", "metrics": still_missing})
        if not reused:
            time.sleep(max(0, delay))
    return enriched, requests, audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--universe", type=Path, default=ROOT / "server/src/data/stockSectorClassification.json")
    parser.add_argument("--corp-map", type=Path, required=True, help="CSV with stock_code and corp_code columns")
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--start-year", type=int, default=2015)
    parser.add_argument("--end-year", type=int, default=2023)
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--delay", type=float, default=0.25)
    parser.add_argument("--supplement-from", type=Path, help="Existing major-account directory; fetch full data only for missing income metrics")
    parser.add_argument("--full-cache-manifest", type=Path, help="Private checked metadata for previously fetched full responses")
    args = parser.parse_args()
    if not 2015 <= args.start_year <= args.end_year or not 1 <= args.batch_size <= 100:
        raise AuditError("Years must start in 2015 or later; batch size must be 1-100")
    mapping = load_universe(args.universe, args.corp_map)
    key = read_key(args.env_file)
    args.output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(args.output_dir, 0o700)
    if any((args.output_dir / name).exists() for name in ("records.json", "manifest.json")):
        raise AuditError("Evidence output already exists; choose a new output directory")
    if args.supplement_from:
        original = json.loads((args.supplement_from / "records.json").read_text())["records"]
        records, requests, audit = supplement_records(original, mapping, key, args.output_dir,
            args.full_cache_manifest, args.timeout, args.delay)
        write_json(args.output_dir / "records.json", {"records": records})
        write_json(args.output_dir / "manifest.json", {"endpoint": FULL_ENDPOINT,
            "collected_at": datetime.now(timezone.utc).isoformat(), "major_source_manifest": str(args.supplement_from / "manifest.json"),
            "major_records_sha256": hashlib.sha256((args.supplement_from / "records.json").read_bytes()).hexdigest(), "requests": requests})
        write_json(args.output_dir / "supplement-audit.json", {"issues": audit})
        print(json.dumps({"complete": True, "records": len(records), "full_requests": sum(not item["reused"] for item in requests),
            "cached_responses": sum(item["reused"] for item in requests), "remaining_income_nulls": sum(record[metric] is None for record in records for metric in ("revenue", "operating_income", "net_income")), "audit_issues": len(audit)}))
        return
    codes = list(mapping)
    batches = [codes[i:i + args.batch_size] for i in range(0, len(codes), args.batch_size)]
    responses, manifest = [], {"endpoint": ENDPOINT, "collected_at": datetime.now(timezone.utc).isoformat(), "universe_count": len(codes),
        "universe_sha256": hashlib.sha256(args.universe.read_bytes()).hexdigest(),
        "corp_mapping_sha256": hashlib.sha256(args.corp_map.read_bytes()).hexdigest(), "requests": []}
    for year in range(args.start_year, args.end_year + 1):
        for index, batch in enumerate(batches, 1):
            filename = f"fnlttMultiAcnt_{year}_group{index:02d}.raw.json"
            if (args.output_dir / filename).exists():
                raise AuditError("Evidence output already exists; choose a new output directory")
            params = {"corp_code": ",".join(mapping[code] for code in batch), "bsns_year": str(year), "reprt_code": "11011"}
            http_status, raw = fetch_raw(key, params, args.timeout)
            private_write(args.output_dir / filename, raw)
            payload = json.loads(raw)
            sha256 = hashlib.sha256(raw).hexdigest()
            entry = {"business_year": year, "group": index, "stock_codes": batch, "corporation_codes": [mapping[code] for code in batch],
                "filename": filename, "sha256": sha256, "http_status": http_status, "api_status": payload.get("status"), "account_rows": len(payload.get("list", []))}
            manifest["requests"].append(entry)
            responses.append({**entry, "payload": payload})
            write_json(args.output_dir / f"{filename}.metadata.json", entry)
            print(json.dumps({"year": year, "group": index, "companies_requested": len(batch), "status": entry["api_status"], "account_rows": entry["account_rows"]}), flush=True)
            if http_status != 200 or payload.get("status") not in ("000", "013"):
                raise AuditError("OpenDART did not return usable data; raw evidence saved, collection stopped")
            time.sleep(max(0, args.delay))
    records, audit = normalize_responses(responses, mapping)
    write_json(args.output_dir / "manifest.json", manifest)
    write_json(args.output_dir / "records.json", {"records": records})
    write_json(args.output_dir / "normalization-audit.json", {"issues": audit, "records": len(records), "stocks": len({row["asset_id"] for row in records})})
    print(json.dumps({"complete": True, "requests": len(manifest["requests"]), "records": len(records), "stocks": len({row["asset_id"] for row in records}), "audit_issues": len(audit)}))


if __name__ == "__main__":
    try:
        main()
    except (AuditError, ValueError, OSError):
        # Exception strings from network/file libraries can contain a secret URL.
        print(json.dumps({"complete": False, "error": "Collection failed; inspect private raw evidence or command inputs. No URL or key logged."}))
        raise SystemExit(1)
