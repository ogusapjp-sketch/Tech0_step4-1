"""FastAPI エントリ（design.md 7.2、7.4）。

起動：uvicorn app.main:create_app --factory
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session, sessionmaker

from app.core.clock import Clock, get_business_clock, get_token_clock
from app.core.config import Settings, load_settings
from app.core.errors import register_exception_handlers
from app.db.session import create_session_factory


def create_app(
    settings: Settings | None = None,
    *,
    business_clock: Clock | None = None,
    token_clock: Clock | None = None,
    session_factory: sessionmaker[Session] | None = None,
) -> FastAPI:
    settings = settings if settings is not None else load_settings()

    # 本番では API の構造を公開しない（design.md 7.4）
    docs_enabled = not settings.is_production
    app = FastAPI(
        title="簡易POSアプリ改 API",
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )

    app.state.settings = settings
    app.state.business_clock = business_clock or get_business_clock()
    app.state.token_clock = token_clock or get_token_clock()
    app.state.session_factory = session_factory or create_session_factory(settings.database_url)

    # 許可オリジンを Next.js の内部アドレスに限定する（多層防御、design.md 7.2）
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_allow_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )
    register_exception_handlers(app)
    return app
