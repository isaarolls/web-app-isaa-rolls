"""Test unitari delle formule economiche (senza server)."""
import datetime as dt
import unittest
from decimal import Decimal as Dec

from tests import helpers  # noqa: F401  (imposta il database di test)
from app.common import D, add_months, add_vat, month_end, q2, split_vat
from app.services.expenses import FREQ_MONTHS, _periods
from app.services.reports import _overlap_days, whole_months
from app.services.sales import _distribute


class Formule(unittest.TestCase):
    def test_numeri_formato_italiano(self):
        self.assertEqual(D("1.234,56"), Dec("1234.56"))
        self.assertEqual(D("12,5"), Dec("12.5"))
        self.assertEqual(D("12.5"), Dec("12.5"))
        self.assertEqual(D("€ 3,00"), Dec("3.00"))
        self.assertEqual(D(None), Dec(0))

    def test_scorporo_iva_esatto(self):
        for gross in ["4.50", "0.01", "1000.00", "3.33", "99.99", "-5.00"]:
            for rate in [0, 4, 5, 10, 22]:
                net, vat = split_vat(gross, rate)
                self.assertEqual(net + vat, q2(gross), (gross, rate))
        self.assertEqual(split_vat("11.00", 10), (Dec("10.00"), Dec("1.00")))
        self.assertEqual(split_vat("4.50", 10), (Dec("4.09"), Dec("0.41")))

    def test_aggiunta_iva(self):
        self.assertEqual(add_vat("100", 22), (Dec("22.00"), Dec("122.00")))
        self.assertEqual(add_vat("0.10", 10), (Dec("0.01"), Dec("0.11")))

    def test_ripartizione_sconti_senza_errori(self):
        parts = _distribute(Dec("1.00"), [Dec("3"), Dec("3"), Dec("3")])
        self.assertEqual(sum(parts), Dec("1.00"))
        self.assertTrue(all(p >= Dec("0.33") for p in parts))
        parts = _distribute(Dec("10.00"), [Dec("4.50"), Dec("9.00"), Dec("0")])
        self.assertEqual(sum(parts), Dec("10.00"))
        self.assertEqual(parts[2], Dec("0"))

    def test_date(self):
        self.assertEqual(add_months(dt.date(2026, 1, 31), 1), dt.date(2026, 2, 28))
        self.assertEqual(add_months(dt.date(2026, 11, 15), 3), dt.date(2027, 2, 15))
        self.assertEqual(month_end(dt.date(2028, 2, 3)), dt.date(2028, 2, 29))
        self.assertTrue(whole_months(dt.date(2026, 1, 1), dt.date(2026, 3, 31)))
        self.assertFalse(whole_months(dt.date(2026, 1, 1), dt.date(2026, 1, 30)))
        self.assertEqual(_overlap_days(dt.date(2026, 1, 1), dt.date(2026, 1, 31), dt.date(2026, 1, 20), dt.date(2026, 2, 5)), 12)

    def test_periodi_ricorrenti(self):
        r = {"frequency": "trimestrale", "start_date": dt.date(2026, 1, 10), "day_of_month": 5, "end_date": None}
        got = list(_periods(r, dt.date(2026, 12, 31)))
        self.assertEqual(got, [dt.date(2026, 4, 5), dt.date(2026, 7, 5), dt.date(2026, 10, 5)])
        r = {"frequency": "mensile", "start_date": dt.date(2026, 1, 1), "day_of_month": 1, "end_date": dt.date(2026, 3, 15)}
        self.assertEqual(len(list(_periods(r, dt.date(2027, 1, 1)))), 3)
        self.assertEqual(FREQ_MONTHS["annuale"], 12)


if __name__ == "__main__":
    unittest.main()
