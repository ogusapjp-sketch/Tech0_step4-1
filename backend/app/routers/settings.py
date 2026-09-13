"""API 4：現在の税率と本日有効な値引き企画（design.md 3.2.2、5.2）。"""

from fastapi import APIRouter

from app.dependencies import BusinessClockDep, CurrentStaffId, RepositoriesDep
from app.schemas.responses import DiscountCampaign
from app.schemas.responses import Settings as SettingsResponse

router = APIRouter(tags=["settings"])


@router.get("/settings", response_model=SettingsResponse)
def get_settings(
    _staff_id: CurrentStaffId, repositories: RepositoriesDep, business_clock: BusinessClockDep
) -> SettingsResponse:
    today = business_clock.now().date()
    return SettingsResponse(
        tax_rate_bp=repositories.tax_rates.rate_bp_on(today),
        campaigns=[
            DiscountCampaign(
                campaign_id=campaign.campaign_id,
                name=campaign.name,
                product_code=campaign.product_code,
                discount_type=campaign.discount_type,
                discount_value=campaign.discount_value,
            )
            for campaign in repositories.campaigns.find_active_on(today)
        ],
    )
