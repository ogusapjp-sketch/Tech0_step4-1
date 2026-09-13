"""認証 API のスキーマ（design.md 5.2 API 1）。"""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

# 英数字と - _、1〜20文字
StaffId = Annotated[
    str, StringConstraints(strict=True, min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_-]+$")
]
# 12〜128文字。文字種の強制はしない（NFR-SEC-02）
Password = Annotated[str, StringConstraints(strict=True, min_length=12, max_length=128)]


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    staff_id: StaffId
    password: Password


class LogoutRequest(BaseModel):
    """BFF が Cookie のリフレッシュトークンを本文で渡す（design.md 5.2 API 3）。"""

    model_config = ConfigDict(extra="forbid")

    refresh_token: Annotated[str, StringConstraints(strict=True, min_length=1)]
