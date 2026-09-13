# DB 接続のタイムアウト（IT-34 の対応。読み書き10秒は人間が決定）。test_spec.md 4.1 にケース ID がないため test_extra_
# 実際の DB には接続せず、create_engine に渡す設定を確認する
from app.db import session as db_session


def test_extra_db_engine_has_read_write_and_connect_timeouts(monkeypatch):
    captured: dict = {}

    def fake_create_engine(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(db_session, "create_engine", fake_create_engine)
    monkeypatch.setattr(db_session, "sessionmaker", lambda **kwargs: kwargs)

    db_session.create_session_factory("mysql+pymysql://pos_app:secret@mysql:3306/pos")

    assert captured["url"] == "mysql+pymysql://pos_app:secret@mysql:3306/pos"
    # 読み書き10秒（人間が決定）。TCP 接続の確立は3秒
    assert captured["connect_args"] == {"connect_timeout": 3, "read_timeout": 10, "write_timeout": 10}
    # 使う前の接続確認（pool_pre_ping）はしない（人間が決定）。確認の待ち10秒と張り直しの待ち10秒が重なり、
    # BFF の待ち（15秒）を超えて処理が残るため。代わりに接続を240秒で入れ替えて、放置中の切断に備える
    assert captured.get("pool_pre_ping", False) is False
    assert captured["pool_recycle"] == 240
