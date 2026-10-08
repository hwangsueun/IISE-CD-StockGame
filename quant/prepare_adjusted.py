"""Immutable daily adjusted DataGuide input -> game and Qlib data.

Read original files only. Source fields and adjustment audits are preserved.
"""
import argparse
from datetime import date, datetime
from pathlib import Path
import json
import openpyxl
import numpy as np
import pandas as pd
from prepare import digest, write_json, build_provider, ROOT

ITEMS = {
    'S41000030F': ('시가(원)', 'raw_open'),
    'S41000040F': ('고가(원)', 'raw_high'),
    'S41000050F': ('저가(원)', 'raw_low'),
    'S410000900': ('거래대금(원)', 'raw_amount'),
    'S41000080F': ('거래량(주)', 'raw_volume'),
    'S410000650': ('수정시가(원)', 'open'),
    'S410000660': ('수정고가(원)', 'high'),
    'S410000670': ('수정저가(원)', 'low'),
    'S410000700': ('수정주가(원)', 'close'),
    'S410001600': ('수정계수', 'source_factor'),
}

def extract(source, out):
    book = openpyxl.load_workbook(source, read_only=True, data_only=True)
    records, metadata = [], {}
    for ws in book:
        rows = iter(ws.values)
        meta = {}
        for row in rows:
            if isinstance(row[0], (datetime, date)):
                raise ValueError('Daily data appeared before item metadata')
            meta[row[0]] = row
            if row[0] == '집계주기':
                break
        if meta['출력주기'][1] != '일간':
            raise ValueError('Daily output required')
        columns = {}
        for i, item in enumerate(meta['아이템코드'][1:], 1):
            if item is None:
                continue
            if item not in ITEMS or meta['아이템명'][i] != ITEMS[item][0] or meta['집계주기'][i] != '일간':
                raise ValueError(f'Unexpected item/frequency {ws.title} column {i+1}')
            code = str(meta['코드'][i]).removeprefix('A')
            if len(code) != 6 or not code.isdigit():
                raise ValueError(f'Invalid stock code {code}')
            field = ITEMS[item][1]
            if field in columns.setdefault(code, {}):
                raise ValueError('Duplicate item per stock')
            columns[code][field] = i
        if any(len(cols) != len(ITEMS) for cols in columns.values()):
            raise ValueError('Missing item per stock')
        metadata[ws.title] = {'updated': meta['Refresh'][1], 'period': list(meta['기간'][1:3]),
                              'frequency': '일간', 'stocks': len(columns)}
        for row in rows:
            if not isinstance(row[0], (datetime, date)):
                continue
            day = row[0].strftime('%Y-%m-%d')
            for code, cols in columns.items():
                values = {field: row[i] for field, i in cols.items()}
                if all(v is None for v in values.values()):
                    continue
                records.append({'date': day, 'asset_id': f'STOCK_{code}', 'code': code, **values})
        print(f'Extracted {ws.title}: {len(records):,} cumulative rows', flush=True)
    book.close()
    df = pd.DataFrame(records)
    duplicates = int(df.duplicated().sum())
    df = df.drop_duplicates()
    if df.duplicated(['date', 'asset_id']).any():
        raise ValueError('Conflicting overlapping sheet rows')
    for field in [v[1] for v in ITEMS.values()]:
        df[field] = pd.to_numeric(df[field], errors='raise')
    df = df.sort_values(['date', 'asset_id']).reset_index(drop=True)
    df.to_csv(out / 'source_daily.csv', index=False)
    write_json(out / 'source_metadata.json', {'sheets': metadata, 'items': ITEMS, 'identical_duplicates_removed': duplicates})
    return df

def main(args):
    source = Path(args.source).resolve()
    suffix=f'-{args.revision}' if args.revision else ''
    if args.revision and not args.revision.isalnum():
        raise ValueError('Revision must be alphanumeric')
    out = Path(args.output).resolve() / f'quant-v2-adjusted-{digest(source)[:12]}{suffix}'
    out.mkdir(parents=True, exist_ok=True)
    if (out / 'manifest.json').exists():
        raise ValueError('Completed data version exists; do not overwrite')
    df = (pd.read_csv(out / 'source_daily.csv', dtype={'code':str})
          if (out / 'source_metadata.json').exists() else extract(source, out))
    old = pd.read_csv(Path(args.raw_done) / 'quant_daily.csv', dtype={'code':str})
    join = df.merge(old[['date','asset_id','close','open','high','low','amount','volume']].rename(
        columns={f:f'{f}_old' for f in ['close','open','high','low','amount','volume']}), on=['date','asset_id'],
        how='outer', indicator=True, validate='one_to_one')
    summary = {'rows': len(df), 'alignment': join._merge.value_counts().to_dict(), 'fields': {}}
    for field in ['open','high','low','amount','volume']:
        lhs, rhs = join[f'raw_{field}'], join[f'{field}_old']
        both = lhs.notna() & rhs.notna()
        summary['fields'][field] = {'compared': int(both.sum()), 'mismatches': int((~np.isclose(lhs[both],rhs[both],rtol=1e-10,atol=1e-7)).sum())}
    for name, factor in [('source',join.source_factor), ('inverse_source',1/join.source_factor), ('close_ratio',join.close/join.close_old)]:
        errors = {}
        for field in ['open','high','low']:
            mask = (join[f'raw_{field}']>0) & (join[field]>0) & factor.notna()
            delta = (join.loc[mask,field] - join.loc[mask,f'raw_{field}']*factor[mask]).abs()
            errors[field]={'n':int(mask.sum()),'median_error':float(delta.median()),'max_error':float(delta.max()),'over_1_krw':int((delta>1).sum())}
        summary[name] = errors
    write_json(out/'initial_audit.json',summary)
    if not args.inspect_only:
        finalize(df, old, source, Path(args.raw_done).resolve(), out, summary)
    print(out)


def effective_scale(raw_ohl, adjusted_ohl):
    """Price scale consistent with every vendor-rounded O/H/L (nearest KRW).

    The supplied `수정계수` changes only on event days. It is not the cumulative
    raw-to-adjusted multiplier and must not be multiplied into daily prices.
    """
    raw_ohl=np.asarray(raw_ohl,dtype=float)
    adjusted_ohl=np.asarray(adjusted_ohl,dtype=float)
    if not (np.isfinite(raw_ohl).all() and np.isfinite(adjusted_ohl).all()
            and (raw_ohl>0).all() and (adjusted_ohl>0).all()):
        raise ValueError('Positive source OHL required for scale reconstruction')
    lower=((adjusted_ohl-.5)/raw_ohl).max(axis=1)
    upper=((adjusted_ohl+.5)/raw_ohl).min(axis=1)
    if (lower>upper+1e-12).any():
        raise ValueError('Adjusted OHL cannot share a scale within source rounding')
    best=(raw_ohl*adjusted_ohl).sum(axis=1)/(raw_ohl**2).sum(axis=1)
    return np.clip(best,lower,upper)


def finalize(source_df, old, source, raw_done, out, summary):
    df=source_df.loc[source_df.close>0].copy()
    if set(zip(df.date,df.asset_id))!=set(zip(old.date,old.asset_id)):
        raise ValueError('Adjusted close coverage must match the existing game universe/date keys')
    if any(x['mismatches'] for x in summary['fields'].values()):
        raise ValueError('Raw input differs from the archived raw game bars')
    df['adjustment_factor']=effective_scale(df[['raw_open','raw_high','raw_low']],df[['open','high','low']])
    error=np.abs(df[['open','high','low']].to_numpy()-df[['raw_open','raw_high','raw_low']].to_numpy()*df.adjustment_factor.to_numpy()[:,None])
    assert error.max()<=.500001
    valid_ohlc=(df.high>=df.low)&(df.open.between(df.low,df.high))&(df.close.between(df.low,df.high))
    df['tradable']=(df.raw_volume>0)&(df.raw_amount>0)&valid_ohlc
    df['volume']=df.raw_volume/df.adjustment_factor
    df['amount']=df.raw_amount
    df['vwap']=(df.raw_amount/df.raw_volume*df.adjustment_factor).where(df.tradable)
    # Keep the supplied close for valuation, but never invent executions on a suspended bar.
    df.loc[~df.tradable,['open','high','low','vwap']]=np.nan
    outside=df.tradable&((df.vwap<df.low-1)|(df.vwap>df.high+1))
    # Amount/volume were checked against the archived raw source above. Some
    # source turnover-implied averages already fall outside its OHL range.
    # Preserve them, report them, and do not clip or invent a session definition.
    df.loc[outside].to_csv(out/'source_vwap_outliers.csv',index=False)
    if (out/'invalid_vwap.csv').exists():
        (out/'invalid_vwap.csv').unlink()  # Superseded diagnostic from the initial audit.
    df[['date','asset_id','code','open','high','low','close','volume','amount','vwap','tradable',
        'raw_volume','adjustment_factor']].to_csv(out/'quant_daily.csv',index=False,float_format='%.17g')
    df=df.sort_values(['asset_id','date'])
    df['change_rate']=df.groupby('asset_id').close.pct_change(fill_method=None)
    df[['asset_id','date','close','change_rate']].rename(columns={'date':'trade_date','close':'close_price'}).to_csv(
        out/'asset_prices.csv',index=False,float_format='%.17g')
    df[['asset_id','date','open','high','low','close','raw_volume','amount','vwap','adjustment_factor','volume']].rename(
        columns={'date':'trade_date','open':'open_price','high':'high_price','low':'low_price','close':'close_price',
                 'raw_volume':'volume','volume':'adjusted_volume'}).to_csv(out/'stock_price_detail.csv',index=False,float_format='%.17g')
    df.groupby(['asset_id','code'],as_index=False).agg(observed_from=('date','min'),observed_to=('date','max'),rows=('date','size')).to_csv(out/'instruments.csv',index=False)
    corrections=df.merge(old[['date','asset_id','close']].rename(columns={'close':'previous_raw_close'}),on=['date','asset_id'])
    corrections['scaled_previous_close']=corrections.previous_raw_close*corrections.adjustment_factor
    corrections=corrections[(corrections.close-corrections.scaled_previous_close).abs()>1.1]
    corrections[['date','asset_id','previous_raw_close','scaled_previous_close','close']].to_csv(out/'source_close_differences.csv',index=False)
    df[df.change_rate.abs()>.35][['date','asset_id','close','change_rate']].to_csv(out/'price_discontinuities.csv',index=False)
    build_provider(df,out/'qlib')
    audit={'scale_method':'Least squares within intersection of +/-0.5 KRW vendor OHL rounding bounds',
           'max_ohl_reconstruction_error_krw':float(error.max()),'source_factor_policy':'preserved only; event-day coefficient is not cumulative price scale',
           'invalid_ohlc_nontradable_rows':int((~valid_ohlc).sum()),'source_close_differences':len(corrections),
           'close_difference_policy':'use supplied adjusted close; do not infer factor from potentially different archived closes',
           'vwap_outside_range':int(outside.sum()),'adjusted_stocks':int(df.loc[abs(df.adjustment_factor-1)>1e-6,'asset_id'].nunique()),
           'vwap_outlier_policy':'preserve source amount/volume implied average; source session coverage not inferred',
           'adjustment_factor_min':float(df.adjustment_factor.min()),'adjustment_factor_max':float(df.adjustment_factor.max())}
    write_json(out/'adjustment_audit.json',audit)
    manifest={'version':out.name,'schema_version':2,'status':'prepared','sources':{
        'adjusted':{'path':str(source),'sha256':digest(source)},
        'raw_done':{'path':str(raw_done),'manifest_sha256':digest(raw_done/'manifest.json')}},
        'rows':len(df),'stocks':int(df.asset_id.nunique()),'dates':int(df.date.nunique()),'from':df.date.min(),'to':df.date.max(),
        'excluded_without_positive_close':int(len(source_df)-len(df)),'nontradable_rows':int((~df.tradable).sum()),
        'price_discontinuities':int((df.change_rate.abs()>.35).sum()),
        'price_basis':'adjusted, DataGuide standard daily OHLC (S410000650/660/670/700); no separate cash-dividend flows',
        'price_adjustment':'source adjusted OHLC kept exactly; raw/adjusted OHL yield effective scale within source integer rounding',
        'volume':'Qlib volume=raw shares/effective scale; game detail volume=original actual shares; adjusted_volume stored separately',
        'vwap':'raw amount/raw volume * effective scale; amount remains actual KRW; nontradable bars missing',
        'universe':'supplied game stocks; same observed coverage as raw version; historical survivorship not verified',
        'pit_limitations':'vendor download is a retrospective adjusted snapshot, not vintage corporate-action data',
        'files':{str(p.relative_to(out)):digest(p) for p in sorted(out.rglob('*')) if p.is_file() and p.suffix in ('.csv','.json','.bin','.txt')}}
    write_json(out/'manifest.json',manifest)
    print(json.dumps({k:v for k,v in manifest.items() if k!='files'},ensure_ascii=False,indent=2))

if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--source', default=ROOT/'quant_data_2.xlsx')
    p.add_argument('--raw-done', default=ROOT/'data-pipeline/data/done/quant/quant-v1-4c60eab83fe8')
    p.add_argument('--output', default=ROOT/'data-pipeline/data/done/quant')
    p.add_argument('--inspect-only',action='store_true')
    p.add_argument('--revision',default='')
    main(p.parse_args())
