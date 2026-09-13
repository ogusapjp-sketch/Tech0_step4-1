# FastAPI（design.md 2.1、2.3）。本番は Azure Container Apps の内部 Ingress で動かす
FROM python:3.11.16-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Tokyo

WORKDIR /app

# 本番に必要なパッケージだけを、requirements.txt の固定バージョンどおりに入れる。
# --no-deps で固定外のパッケージが入らないようにし、pip check で依存の漏れがあればビルドを失敗させる
COPY requirements.txt .
RUN pip install --no-deps -r requirements.txt && pip check

COPY app ./app

# root 以外のユーザーで動かす
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

# 設定を読み込んでからアプリを作るため --factory で起動する
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
