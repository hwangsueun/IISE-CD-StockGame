"""Independently reconcile final CSV/provider data with retained source columns."""
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd
from prepare import digest, write_json

def verify(directory, report):
    directory=Path(directory)
    manifest=json.loads((directory/'manifest.json').read_text())
    for name,sha in manifest['files'].items():
        assert digest(directory/name)==sha,name
    assert digest(manifest['sources']['adjusted']['path'])==manifest['sources']['adjusted']['sha256']
    keys=['date','asset_id']
    source=pd.read_csv(directory/'source_daily.csv',dtype={'code':str}).set_index(keys)
    daily=pd.read_csv(directory/'quant_daily.csv',dtype={'code':str}).set_index(keys)
    detail=pd.read_csv(directory/'stock_price_detail.csv').rename(columns={'trade_date':'date'}).set_index(keys)
    prices=pd.read_csv(directory/'asset_prices.csv').rename(columns={'trade_date':'date'}).set_index(keys)
    assert daily.index.is_unique and detail.index.is_unique and prices.index.is_unique
    assert set(daily.index)==set(source[source.close>0].index)==set(detail.index)==set(prices.index)
    source=source.loc[daily.index];detail=detail.loc[daily.index];prices=prices.loc[daily.index]
    assert len(daily)==manifest['rows']
    np.testing.assert_array_equal(daily.close,source.close)
    np.testing.assert_array_equal(prices.close_price,source.close)
    np.testing.assert_array_equal(detail.close_price,source.close)
    for col in ['open','high','low']:
        np.testing.assert_array_equal(daily.loc[daily.tradable,col],source.loc[daily.tradable,col])
        np.testing.assert_allclose(daily[col],detail[f'{col}_price'],equal_nan=True,atol=0,rtol=0)
        assert daily.loc[~daily.tradable,col].isna().all()
    np.testing.assert_allclose(detail.amount,source.raw_amount,rtol=0,atol=0,equal_nan=True)
    np.testing.assert_allclose(detail.volume,source.raw_volume,rtol=0,atol=0,equal_nan=True)
    np.testing.assert_allclose(daily.volume*daily.adjustment_factor,source.raw_volume,rtol=1e-13,equal_nan=True)
    expected=(source.raw_amount/source.raw_volume*daily.adjustment_factor).where(daily.tradable)
    np.testing.assert_allclose(daily.vwap,expected,rtol=1e-13,equal_nan=True)
    np.testing.assert_allclose(daily.vwap,detail.vwap,rtol=0,atol=0,equal_nan=True)
    np.testing.assert_allclose(daily.volume,detail.adjusted_volume,rtol=0,atol=0,equal_nan=True)
    np.testing.assert_allclose(daily.loc[daily.tradable,'volume']*daily.loc[daily.tradable,'vwap'],source.loc[daily.tradable,'raw_amount'],rtol=1e-13)
    by_stock=daily.reset_index().sort_values(['asset_id','date']).set_index(keys)
    change=by_stock.groupby(level='asset_id').close.pct_change(fill_method=None)
    np.testing.assert_allclose(prices.change_rate,change.reindex(prices.index),atol=1e-14,equal_nan=True)
    calendar=(directory/'qlib/calendars/day.txt').read_text().splitlines()
    for asset in daily.index.get_level_values('asset_id').unique():
        group=daily.xs(asset,level='asset_id').reindex(calendar)
        for col in ['open','high','low','close','volume','vwap']:
            binary=np.fromfile(directory/f'qlib/features/{asset.lower()}/{col}.day.bin',dtype='<f4')
            assert binary[0]==0 and len(binary)==len(calendar)+1
            np.testing.assert_allclose(binary[1:],group[col],rtol=1e-6,atol=1e-5,equal_nan=True)
    result={'status':'passed','rows':len(daily),'stocks':daily.index.get_level_values('asset_id').nunique(),
            'checks':['all input and provider hashes','exact supplied adjusted OHLC','exact raw volume and amount preservation',
                      'adjusted volume and VWAP consistency','amount conservation','return recalculation','all provider columns and dates',
                      'suspensions remain non-executable'],'source_adjustment_audit':json.loads((directory/'adjustment_audit.json').read_text())}
    write_json(Path(report),result)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data',required=True);p.add_argument('--report',required=True)
    a=p.parse_args();verify(a.data,a.report)
