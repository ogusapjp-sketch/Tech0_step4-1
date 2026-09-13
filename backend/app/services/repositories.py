"""1リクエストで使うリポジトリの組。本番は SQLAlchemy 版、単体テストはインメモリ版を渡す。"""

from dataclasses import dataclass

from app.services.auth import StaffRepository, TokenRepository
from app.services.transaction import (
    CampaignRepository,
    MemberRepository,
    ProductRepository,
    TaxRateRepository,
    TransactionRepository,
)


@dataclass(frozen=True)
class Repositories:
    staff: StaffRepository
    tokens: TokenRepository
    products: ProductRepository
    members: MemberRepository
    tax_rates: TaxRateRepository
    campaigns: CampaignRepository
    transactions: TransactionRepository
