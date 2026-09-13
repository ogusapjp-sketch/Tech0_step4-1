"""商品コード・会員IDの形式検証（design.md 6.1）。

パスパラメータ（API 5・6）と購入確定の明細・会員IDで共通に使う。
前後の空白の trim はフロントの責務であり、ここでは空白を含む値を拒否する。
"""

import re

# fullmatch と [0-9] を使い、全角数字や末尾の改行を受け付けない
PRODUCT_CODE_PATTERN = re.compile(r"[0-9]{1,20}")
MEMBER_ID_PATTERN = re.compile(r"M[0-9]{1,19}")


def validate_product_code(value: str) -> str:
    """数字のみ、1〜20文字。"""
    if not PRODUCT_CODE_PATTERN.fullmatch(value):
        raise ValueError("product_code must be 1-20 digits")
    return value


def validate_member_id(value: str) -> str:
    """大文字 M ＋数字、2〜20文字。"""
    if not MEMBER_ID_PATTERN.fullmatch(value):
        raise ValueError("member_id must be 'M' followed by 1-19 digits")
    return value
