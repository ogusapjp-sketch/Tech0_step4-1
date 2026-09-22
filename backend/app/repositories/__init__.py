"""SQLAlchemy によるリポジトリの実装。単体テストのカバレッジ対象外とし、結合テストで確認する。"""

from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager

from app.db.session import create_session_factory
from app.repositories.auth import SqlStaffRepository, SqlTokenRepository
from app.repositories.transaction import (
    SqlCampaignRepository,
    SqlMemberRepository,
    SqlProductRepository,
    SqlTaxRateRepository,
    SqlTransactionRepository,
)
from app.services.repositories import Repositories


def create_sql_repositories_provider(
    database_url: str,
    *,
    ssl_ca: str | None = None,
) -> Callable[[], AbstractContextManager[Repositories]]:
    session_factory = create_session_factory(database_url, ssl_ca=ssl_ca)

    @contextmanager
    def provide() -> Iterator[Repositories]:
        # 1リクエストにつき1つのセッションを使い、終わったら閉じる
        with session_factory() as session:
            yield Repositories(
                staff=SqlStaffRepository(session),
                tokens=SqlTokenRepository(session),
                products=SqlProductRepository(session),
                members=SqlMemberRepository(session),
                tax_rates=SqlTaxRateRepository(session),
                campaigns=SqlCampaignRepository(session),
                transactions=SqlTransactionRepository(session),
            )

    return provide
