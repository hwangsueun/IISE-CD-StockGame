import unittest
import pandas as pd
from train import label_schedule, make_labels, purged_split
from profiles import get_profile


class TimelineTest(unittest.TestCase):
    def test_horizon_is_weekday_turns_and_entry_is_next_market_day(self):
        dates = pd.bdate_range("2020-01-01", periods=140).difference(pd.DatetimeIndex(["2020-01-02", "2020-06-19"]))
        schedule = label_schedule(dates, get_profile("legacy_120")["label_horizon"])
        row = schedule.loc[pd.Timestamp("2020-01-01")]
        self.assertEqual(row.entry, pd.Timestamp("2020-01-03"))
        self.assertEqual(row.exit, pd.Timestamp("2020-06-22"))
        self.assertTrue(pd.isna(schedule.iloc[-1].exit))

    def test_daily_label_skips_weekend_and_exchange_holiday(self):
        days = pd.to_datetime(["2020-01-02", "2020-01-03", "2020-01-07", "2020-01-08"])
        schedule = label_schedule(days)
        self.assertEqual(schedule.loc[days[0], "entry"], days[1])
        self.assertEqual(schedule.loc[days[0], "exit"], days[2])
        self.assertEqual(schedule.loc[days[1], "exit"], days[3])
        self.assertTrue(pd.isna(schedule.iloc[-1].exit))

    def test_label_uses_next_two_closes_and_matching_benchmark(self):
        days = pd.to_datetime(["2020-01-02", "2020-01-03", "2020-01-07"])
        daily = pd.DataFrame({"date": days, "asset_id": "A", "close": [80., 100., 110.], "tradable": True})
        benchmark = pd.Series([100., 200., 210.], index=days)
        labels = make_labels(daily, benchmark)
        self.assertEqual(len(labels), 1)
        row = labels.loc[(days[0], "A")]
        self.assertAlmostEqual(row["return"], .10)
        self.assertAlmostEqual(row.label, .05)
        self.assertEqual(row.exit, days[2])

    def test_open_label_uses_future_opens_and_never_future_closes(self):
        days = pd.to_datetime(["2020-01-02", "2020-01-03", "2020-01-07"])
        daily = pd.DataFrame({"date": days, "asset_id": "A", "open": [30.,100.,120.],
                              "close": [50.,600.,700.], "tradable": True})
        benchmark = pd.Series([10.,20.,22.],index=days)
        labels = make_labels(daily,benchmark,price_field="open")
        self.assertAlmostEqual(labels.iloc[0]["return"],.2)
        self.assertAlmostEqual(labels.iloc[0].label,.1)
        daily["close"] *= 20
        pd.testing.assert_frame_equal(labels,make_labels(daily,benchmark,price_field="open"))
        daily.loc[2,"open"] = 0
        self.assertTrue(make_labels(daily,benchmark,price_field="open").empty)

    def test_purge_and_maturity(self):
        dates = pd.bdate_range("2013-01-01", periods=700)
        index = pd.MultiIndex.from_product([dates, [f"S{i}" for i in range(10)]], names=["datetime", "instrument"])
        labels = pd.DataFrame({"exit": index.get_level_values(0) + pd.offsets.BDay(120), "label": 0}, index=index)
        cutoff = pd.Timestamp("2015-06-01")
        train, valid = purged_split(labels, cutoff)
        self.assertGreater(len(valid), 0)
        self.assertLess(train.exit.max(), valid.index.get_level_values(0).min())
        self.assertLess(valid.exit.max(), cutoff)

    def test_daily_purge_does_not_train_on_labels_crossing_validation(self):
        days = pd.bdate_range("2013-01-01", periods=160)
        schedule = label_schedule(days).dropna()
        labels = pd.concat([schedule.assign(instrument=f"S{i}") for i in range(10)])
        labels = labels.reset_index().set_index(["datetime", "instrument"]).sort_index()
        train, valid = purged_split(labels, days[-1])
        self.assertGreater(len(valid), 0)
        self.assertLess(train.exit.max(), valid.index.get_level_values("datetime").min())
        self.assertLess(valid.exit.max(), days[-1])


if __name__ == "__main__":
    unittest.main()
