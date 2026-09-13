"""FastAPI エントリ（design.md 5.1、7.2、7.4）。

起動：uvicorn app.main:create_app --factory
"""

from collections.abc import Callable
from contextlib import AbstractContextManager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.clock import Clock, get_business_clock, get_token_clock
from app.core.config import Settings, load_settings
from app.core.errors import register_exception_handlers
from app.repositories import create_sql_repositories_provider
from app.routers import auth, members, products, settings, transactions
from app.services.repositories import Repositories


def create_app(
    app_settings: Settings | None = None,
    *,
    business_clock: Clock | None = None,
    token_clock: Clock | None = None,
    repositories_provider: Callable[[], AbstractContextManager[Repositories]] | None = None,
) -> FastAPI:
    app_settings = app_settings if app_settings is not None else load_settings()

    # 本番では API の構造を公開しない（design.md 7.4）
    docs_enabled = not app_settings.is_production
    app = FastAPI(
        title="簡易POSアプリ改 API",
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )

    app.state.settings = app_settings
    app.state.business_clock = business_clock or get_business_clock()
    app.state.token_clock = token_clock or get_token_clock()
    app.state.repositories_provider = repositories_provider or create_sql_repositories_provider(
        app_settings.database_url
    )

    # 許可オリジンを Next.js の内部アドレスに限定する（多層防御、design.md 7.2）
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app_settings.cors_allow_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )
    register_exception_handlers(app)

    for router_module in (auth, settings, members, products, transactions):
        app.include_router(router_module.router)
    return app
