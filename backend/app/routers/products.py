"""API 6：商品照会（design.md 3.2.2、5.2）。販売終了商品は 404。"""

from fastapi import APIRouter

from app.core.errors import ApiError
from app.dependencies import CurrentStaffId, RepositoriesDep
from app.schemas.codes import validate_product_code
from app.schemas.responses import Product

router = APIRouter(tags=["products"])


@router.get("/products/{product_code}", response_model=Product)
def get_product(product_code: str, _staff_id: CurrentStaffId, repositories: RepositoriesDep) -> Product:
    try:
        validate_product_code(product_code)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR") from exc
    product = repositories.products.find_available([product_code]).get(product_code)
    if product is None:
        raise ApiError("PRODUCT_NOT_FOUND")
    return Product(product_code=product.product_code, name=product.name, unit_price=product.unit_price)
