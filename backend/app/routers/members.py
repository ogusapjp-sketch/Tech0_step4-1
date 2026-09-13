"""API 5：会員照会（design.md 5.2）。電話番号・住所は返さない（NFR-SEC-09）。"""

from fastapi import APIRouter

from app.core.errors import ApiError
from app.dependencies import CurrentStaffId, RepositoriesDep
from app.schemas.codes import validate_member_id
from app.schemas.responses import Member

router = APIRouter(tags=["members"])


@router.get("/members/{member_id}", response_model=Member)
def get_member(member_id: str, _staff_id: CurrentStaffId, repositories: RepositoriesDep) -> Member:
    try:
        validate_member_id(member_id)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR") from exc
    member = repositories.members.get(member_id)
    if member is None:
        raise ApiError("MEMBER_NOT_FOUND")
    return Member(member_id=member.member_id, name=member.name)
