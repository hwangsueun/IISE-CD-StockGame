import unittest
import numpy as np
from prepare_adjusted import effective_scale

class AdjustmentTest(unittest.TestCase):
    def test_split_scale_is_price_multiplier(self):
        np.testing.assert_allclose(effective_scale([[1000,1200,900]],[[200,240,180]]),[.2])

    def test_rounding_intersection_handles_median_ratio_failure(self):
        raw=np.array([[52000,67600,52000]])
        adjusted=np.array([[13377,17389,13377]])
        scale=effective_scale(raw,adjusted)
        self.assertTrue((abs(raw*scale[:,None]-adjusted)<=.500001).all())

    def test_incompatible_price_bases_are_rejected(self):
        with self.assertRaises(ValueError):
            effective_scale([[100,120,90]],[[20,120,18]])

    def test_missing_or_zero_raw_price_cannot_create_a_factor(self):
        with self.assertRaises(ValueError):
            effective_scale([[0,120,90]],[[20,24,18]])

if __name__=='__main__':unittest.main()
