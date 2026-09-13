# test_spec.md 4.1.5 TransactionService.verify_client_totals（UT-B-80〜85）
# 入力・期待値は test_spec.md の表の値をそのまま写す（ずらした値もコード内で計算しない）
import pytest

from app.services.pricing import Totals
from app.services.transaction import TotalsMismatch, TransactionService

SERVER = Totals(subtotal=2915, discount_total=145, tax_amount=277, total=3047)


def test_UT_B_80_match():
    client = Totals(subtotal=2915, discount_total=145, tax_amount=277, total=3047)
    assert TransactionService.verify_client_totals(SERVER, client) is None


@pytest.mark.parametrize("client", [
    pytest.param(Totals(subtotal=2916, discount_total=145, tax_amount=277, total=3047), id="UT-B-81"),
    pytest.param(Totals(subtotal=2915, discount_total=144, tax_amount=277, total=3047), id="UT-B-82"),
    pytest.param(Totals(subtotal=2915, discount_total=145, tax_amount=278, total=3047), id="UT-B-83"),
    pytest.param(Totals(subtotal=2915, discount_total=145, tax_amount=277, total=3048), id="UT-B-84"),
    pytest.param(Totals(subtotal=0, discount_total=0, tax_amount=0, total=0), id="UT-B-85"),
])
def test_UT_B_81_85_mismatch(client):
    with pytest.raises(TotalsMismatch) as excinfo:
        TransactionService.verify_client_totals(SERVER, client)
    # 409 TOTALS_MISMATCH の details.server_totals に使う（design.md 5.2）
    assert excinfo.value.server_totals == Totals(subtotal=2915, discount_total=145, tax_amount=277, total=3047)
