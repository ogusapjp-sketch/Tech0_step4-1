"""DB 接続。単体テストのカバレッジ対象外とし、結合テストで確認する。"""

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# DB が応答しなくなったとき（IT-34）に処理を止め続けないためのタイムアウト（秒）
# - 読み書き：10秒（人間が決定）。超えたら例外になり、500 INTERNAL_ERROR を返してトランザクションはロールバックされる。
#   PyMySQL は接続を張ったときのサーバの応答（ハンドシェイク）もこの値で待つ
# - TCP 接続の確立：3秒
DB_CONNECT_ARGS = {"connect_timeout": 3, "read_timeout": 10, "write_timeout": 10}

# 接続のたびに実行する。サーバの time_zone が +00:00（Azure の共有サーバ）でも、
# セッションは日本時間に揃える（design.md 2.3）。アプリは Clock の値を明示的に書き込むため、
# 通常はこの設定に依存しないが、DB 側で日時を表示・比較したときに食い違わないようにする
SESSION_TIME_ZONE = "+09:00"
SESSION_INIT_COMMAND = f"SET SESSION time_zone = '{SESSION_TIME_ZONE}'"

# 接続を作ってから入れ替えるまでの秒数。放置中にネットワーク側で切られた接続を使わないようにする（NFR-OPS-01、ST-28）
POOL_RECYCLE_SECONDS = 240


def create_session_factory(database_url: str, *, ssl_ca: str | None = None) -> sessionmaker[Session]:
    # 使う前の接続確認（pool_pre_ping）はしない（人間が決定）。DB が応答しないと、確認の待ち（10秒）と
    # 張り直しの待ち（10秒）が重なって BFF の待ち（15秒）を超え、BFF が 500 を返した後に処理が進んで保存されうるため
    connect_args = {**DB_CONNECT_ARGS, "init_command": SESSION_INIT_COMMAND}
    if ssl_ca:
        # Azure の共有 MySQL は require_secure_transport=ON。CA を渡すと証明書とホスト名を検証する
        connect_args["ssl"] = {"ca": ssl_ca}
    engine = create_engine(
        database_url,
        pool_recycle=POOL_RECYCLE_SECONDS,
        connect_args=connect_args,
    )
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
