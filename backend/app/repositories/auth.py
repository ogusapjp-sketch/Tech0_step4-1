"""AuthService が使うリポジトリ（app/services/auth.py の StaffRepository／TokenRepository）の SQLAlchemy 版。

認証に失敗しても失敗回数やロックの記録を残す必要があるため、書き込みごとに確定（commit）する。
"""

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import RefreshTokenModel, StaffModel
from app.services.auth import RefreshTokenRecord, Staff


class SqlStaffRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, staff_id: str) -> Staff | None:
        row = self._session.get(StaffModel, staff_id)
        if row is None:
            return None
        return Staff(
            staff_id=row.staff_id,
            name=row.name,
            password_hash=row.password_hash,
            failed_count=row.failed_count,
            locked_until=row.locked_until,
            is_active=row.is_active,
        )

    def update(self, staff: Staff) -> None:
        # 認証で変わるのは失敗回数とロック解除日時だけ
        self._session.execute(
            update(StaffModel)
            .where(StaffModel.staff_id == staff.staff_id)
            .values(failed_count=staff.failed_count, locked_until=staff.locked_until)
        )
        self._session.commit()


class SqlTokenRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, record: RefreshTokenRecord) -> None:
        self._session.add(
            RefreshTokenModel(
                token_hash=record.token_hash,
                staff_id=record.staff_id,
                expires_at=record.expires_at,
                revoked=record.revoked,
            )
        )
        self._session.commit()

    def get(self, token_hash: str) -> RefreshTokenRecord | None:
        row = self._session.get(RefreshTokenModel, token_hash)
        if row is None:
            return None
        return RefreshTokenRecord(
            token_hash=row.token_hash,
            staff_id=row.staff_id,
            expires_at=row.expires_at,
            revoked=row.revoked,
        )

    def revoke(self, token_hash: str) -> None:
        self._session.execute(
            update(RefreshTokenModel)
            .where(RefreshTokenModel.token_hash == token_hash)
            .values(revoked=True)
        )
        self._session.commit()

    def revoke_all_for_staff(self, staff_id: str) -> None:
        self._session.execute(
            update(RefreshTokenModel)
            .where(RefreshTokenModel.staff_id == staff_id, RefreshTokenModel.revoked.is_(False))
            .values(revoked=True)
        )
        self._session.commit()
