"""DB 接続。単体テストのカバレッジ対象外とし、結合テストで確認する。"""

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker


def create_session_factory(database_url: str) -> sessionmaker[Session]:
    # NFR-OPS-01：接続をプールで維持し、切れた接続は使う前に検知して張り直す
    engine = create_engine(database_url, pool_pre_ping=True, pool_recycle=3600)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
