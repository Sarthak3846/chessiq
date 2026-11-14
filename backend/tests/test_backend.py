"""Integration tests: real Postgres (+RLS), real Stockfish, real JWT verification. LLM providers are simulated with httpx.MockTransport
(no network / keys needed). Run:  sh tests/run_bootstrap.sh && pytest -q tests"""
import json
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import httpx
import jwt
import psycopg
import pytest
from fastapi.testclient import TestClient

from app import routes_coach
from app.config import settings
from app.engine import stockfish
from app.llm import LLMFailure, LLMNotConfigured, build_router
from app.main import app

DSN = settings.database_url
SECRET = settings.supabase_jwt_secret
ROOT = Path(__file__).resolve().parent.parent


def token(sub, role="authenticated", exp=3600, secret=SECRET, alg="HS256", **extra):
    return jwt.encode({"sub": sub, "role": role, "aud": "authenticated", "exp": int(time.time()) + exp, "email": f"{sub[:6]}@t.dev", "user_metadata": {"full_name": "Test User"}, **extra}, secret, algorithm=alg)


def hdr(sub, **kw):
    return {"Authorization": f"Bearer {token(sub, **kw)}"}


@pytest.fixture(scope="module")
def users():
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    with psycopg.connect(DSN, autocommit=True) as c:
        for u in (a, b):
            c.execute("insert into auth.users (id, email) values (%s, %s)", (u, f"{u[:6]}@t.dev"))
    return a, b


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def sse(resp_lines):
    events, ev = [], None
    for line in resp_lines:
        if line.startswith("event:"):
            ev = line[6:].strip()
        elif line.startswith("data:"):
            events.append((ev, json.loads(line[5:])))
    return events


def chat(client, body, headers=None):
    with client.stream("POST", "/api/coach/chat", json=body, headers=headers or {}) as r:
        assert r.status_code == 200, r.read()
        return sse(list(r.iter_lines()))


# ───────────── auth ─────────────
def test_health(client):
    h = client.get("/api/health").json()
    assert h["stockfish"] is True and h["database"] is True and h["llm"]["providers"] == ["groq", "gemini"]


def test_auth_rejections(client, users):
    a, _ = users
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
    assert client.get("/api/me", headers=hdr(a, exp=-10)).status_code == 401                      # expired
    assert client.get("/api/me", headers=hdr(a, secret="x" * 40)).status_code == 401              # wrong secret
    assert client.get("/api/me", headers=hdr(a, role="anon")).status_code == 401                  # anon-key token
    none_tok = jwt.encode({"sub": a, "role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 99}, None, algorithm="none")
    assert client.get("/api/me", headers={"Authorization": f"Bearer {none_tok}"}).status_code == 401   # alg=none
    r = client.get("/api/me", headers=hdr(a))
    assert r.status_code == 200 and r.json()["id"] == a and r.json()["display_name"]


def test_asymmetric_jwks(client, users):
    from cryptography.hazmat.primitives.asymmetric import ec
    key = ec.generate_private_key(ec.SECP256R1())
    jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(key.public_key())); jwk.update(kid="k1", alg="ES256", use="sig")

    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps({"keys": [jwk]}).encode())
        def log_message(self, *a): pass
    srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    old = settings.supabase_jwks_url, settings.supabase_jwt_secret
    settings.supabase_jwks_url, settings.supabase_jwt_secret = f"http://127.0.0.1:{srv.server_port}/jwks", ""
    try:
        t = jwt.encode({"sub": users[0], "role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 99}, key, algorithm="ES256", headers={"kid": "k1"})
        assert client.get("/api/me", headers={"Authorization": f"Bearer {t}"}).status_code == 200
        bad = jwt.encode({"sub": users[0], "role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 99}, ec.generate_private_key(ec.SECP256R1()), algorithm="ES256", headers={"kid": "k1"})
        assert client.get("/api/me", headers={"Authorization": f"Bearer {bad}"}).status_code == 401
    finally:
        settings.supabase_jwks_url, settings.supabase_jwt_secret = old
        srv.shutdown()


# ───────────── games, isolation, RLS ─────────────
FOOL = "1. f3 e5 2. g4 Qh4# 0-1"
GAME = {"pgn": FOOL, "mode": "coach", "opponent": "AI Coach", "difficulty": "beginner", "player_color": "w", "result": "0-1", "termination": "Checkmate"}


def test_games_and_isolation(client, users):
    a, b = users
    assert client.post("/api/games", json=GAME).status_code == 401
    assert client.post("/api/games", json={**GAME, "pgn": "no moves here"}, headers=hdr(a)).status_code == 422
    r = client.post("/api/games", json={**GAME, "user_id": b}, headers=hdr(a))                     # spoofed owner is ignored
    assert r.status_code == 201 and r.json()["outcome"] == "loss"
    gid = r.json()["id"]
    assert [g["id"] for g in client.get("/api/games", headers=hdr(a)).json()] == [gid]
    assert client.get("/api/games", headers=hdr(b)).json() == []
    assert client.get(f"/api/games/{gid}", headers=hdr(b)).status_code == 404
    assert client.delete(f"/api/games/{gid}", headers=hdr(b)).status_code == 404
    assert client.get(f"/api/games/{gid}", headers=hdr(a)).json()["pgn"].startswith("1. f3")
    assert client.get("/api/games/not-a-uuid", headers=hdr(a)).status_code == 404
    st = client.get("/api/me/stats", headers=hdr(a)).json()
    assert st["games"]["total"] == 1 and st["games"]["losses"] == 1 and st["games"]["win_rate_pct"] == 0
    assert client.get("/api/me/stats", headers=hdr(b)).json()["games"]["total"] == 0


def test_background_analysis_feeds_weaknesses(client, users):
    a, _ = users
    for _ in range(100):  # background Stockfish review of the stored game
        g = client.get("/api/games", headers=hdr(a)).json()[0]
        if g["analysed"]:
            break
        time.sleep(0.3)
    assert g["analysed"], "game analysis was never stored"
    w = client.get("/api/me/stats", headers=hdr(a)).json()["weaknesses"]
    assert w["available"] and w["games_analysed"] == 1 and w["errors_by_phase"]["opening"]["blunder"] + w["errors_by_phase"]["opening"]["mistake"] >= 1  # f3/g4 are real errors


def test_database_row_level_security(users):
    a, b = users
    with psycopg.connect(DSN) as c:
        def as_user(uid, sql):
            with c.transaction():
                c.execute("set local role authenticated"); c.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": uid}),))
                return c.execute(sql).fetchall()
        assert as_user(a, "select count(*) from games")[0][0] == 1
        assert as_user(b, "select count(*) from games")[0][0] == 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege):                                       # RLS blocks writing as someone else
            with c.transaction():
                c.execute("set local role authenticated"); c.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": b}),))
                c.execute("insert into games (user_id, mode, opponent, player_color, result, outcome, moves_count, pgn) values (%s,'coach','x','w','1-0','win',1,'1. e4')", (a,))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):                                       # anon key can't read user tables
            with c.transaction():
                c.execute("set local role anon"); c.execute("select * from games")
        with c.transaction():
            c.execute("set local role anon"); assert c.execute("select count(*) from puzzles").fetchone()[0] >= 0   # puzzles are public
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with c.transaction():
                c.execute("set local role authenticated"); c.execute("insert into puzzles (id, fen, moves, rating) values ('HACK','x','{a}',1)")



# ───────────── puzzles ─────────────
def test_puzzle_import_and_api(client, users):
    a, b = users

    script = ROOT.parent / "scripts" / "import_lichess_puzzles.py"
    fixture = ROOT / "tests" / "fixtures" / "puzzles_synthetic.csv"

    out = subprocess.run(
        [
            sys.executable,
            str(script),
            "--source",
            str(fixture),
            "--sample",
            "1",
            "--min-popularity",
            "0",
            "--min-plays",
            "0",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )

    assert out.returncode == 0 and "Imported 2 puzzles" in out.stdout, out.stderr

    p = client.get("/api/puzzles/next?themes=backRankMate").json()
    assert p["id"] == "TST01" and p["moves"] == ["h7h6", "d1d8"] and p["attribution"].startswith("Lichess")
    assert client.get("/api/puzzles/next?min_rating=850&max_rating=1000").json()["id"] == "TST02"
    assert client.get("/api/puzzles/next?themes=zugzwang").status_code == 404
    assert {t["theme"] for t in client.get("/api/puzzles/themes").json()} >= {"mate", "backRankMate"}
    assert client.get("/api/puzzles/daily").json()["id"] in ("TST01", "TST02")
    assert client.get("/api/puzzles/NOPE").status_code == 404
    assert client.post("/api/puzzles/TST01/attempts", json={"solved": True}).status_code == 401

    r1 = client.post(
        "/api/puzzles/TST01/attempts",
        json={"solved": True, "time_ms": 4000},
        headers=hdr(a),
    ).json()
    assert r1["delta"] > 0 and r1["rating"] == 1200 + r1["delta"]

    r2 = client.post(
        "/api/puzzles/TST01/attempts",
        json={"solved": True},
        headers=hdr(a),
    ).json()
    assert r2["delta"] == 0  # retries don't farm rating

    st = client.get("/api/me/stats", headers=hdr(a)).json()["puzzles"]
    assert st["attempts"] == 2 and st["puzzles_solved"] == 1 and st["accuracy_pct"] == 100
    assert client.get("/api/me/stats", headers=hdr(b)).json()["puzzles"]["attempts"] == 0
    assert client.get("/api/puzzles/next?themes=backRankMate", headers=hdr(a)).json()["id"] == "TST01"  # slice exhausted -> repeats allowed


# ───────────── LLM provider chain ─────────────
def handler_for(kind, log, *, status=200, text="Hello coach", fail_mid=False):
    def h(req: httpx.Request):
        log.append(kind)
        if status != 200:
            return httpx.Response(status, headers={"retry-after": "7"} if status == 429 else {}, json={"error": "x"})
        if kind == "groq":
            body = "".join(f"data: {json.dumps({'choices': [{'delta': {'content': w}}]})}\n\n" for w in text.split(" ")) + ("data: {broken\n\n" if fail_mid else "") + "data: [DONE]\n\n"
        else:
            body = "".join(f"data: {json.dumps({'candidates': [{'content': {'parts': [{'text': w}]}}]})}\n\n" for w in text.split(" "))
        r = httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})
        return r
    return h


async def run(router, msgs=None):
    out = []
    async for ev in router.stream(msgs or [{"role": "system", "content": "s"}, {"role": "user", "content": "hi"}]):
        out.append(ev)
    return out


def make(groq_status=200, gemini_status=200, **kw):
    log = []
    r = build_router({"groq": httpx.MockTransport(handler_for("groq", log, status=groq_status, **kw)), "gemini": httpx.MockTransport(handler_for("gemini", log, status=gemini_status, text="Gemini answer"))})
    return r, log


@pytest.mark.anyio
@pytest.mark.parametrize("anyio_backend", ["asyncio"])
async def test_llm_chain(anyio_backend):
    r, log = make()
    ev = await run(r); assert ev[0] == ("provider", "groq") and log == ["groq"]
    for status in (429, 503):
        r, log = make(groq_status=status); ev = await run(r)
        assert ev[0] == ("provider", "gemini") and ev[1][0] == "notice" and log == ["groq", "gemini"]
    r, log = make(groq_status=401); ev = await run(r)
    assert ev[0] == ("provider", "gemini") and "misconfigured" in ev[1][1]
    r, log = make(groq_status=400)                                                                     # permanent: no fallback
    with pytest.raises(LLMFailure): await run(r)
    assert log == ["groq"]
    r, log = make(groq_status=500, gemini_status=429)
    with pytest.raises(LLMFailure, match="temporarily unavailable"): await run(r)
    r, log = make(groq_status=429); await run(r); log.clear(); await run(r)                              # cooldown: groq is skipped next time
    assert log == ["gemini"]
    r, log = make(fail_mid=False, text="a b c"); ev = await run(r); assert "".join(v for k, v in ev if k == "token") == "abc"


@pytest.mark.anyio
@pytest.mark.parametrize("anyio_backend", ["asyncio"])
async def test_llm_not_configured(anyio_backend):
    old = settings.groq_api_key, settings.gemini_api_key
    settings.groq_api_key = settings.gemini_api_key = ""
    try:
        with pytest.raises(LLMNotConfigured): await run(build_router())
    finally:
        settings.groq_api_key, settings.gemini_api_key = old


# ───────────── coach endpoint end to end ─────────────
BEFORE = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"


def test_chat_stream_uses_stockfish_facts_and_persists(client, users, monkeypatch):
    a, b = users
    seen = {}
    def groq(req):
        seen["body"] = json.loads(req.content); return handler_for("groq", [])(req)
    monkeypatch.setattr(routes_coach, "llm_router", build_router({"groq": httpx.MockTransport(groq), "gemini": httpx.MockTransport(handler_for("gemini", []))}))
    cid = client.post("/api/coach/conversations", json={}, headers=hdr(a)).json()["id"]
    ev = chat(client, {"messages": [{"role": "user", "content": "Was Qh5 good?"}], "fen": BEFORE, "move": {"san": "Qh5", "fen_before": BEFORE}, "conversation_id": cid}, hdr(a))
    names = [e for e, _ in ev]
    assert names[0] == "analysis" and "meta" in names and "token" in names and names[-1] == "done"
    move = ev[0][1]["facts"]["move"]
    assert move["played_move"] == "Qh5" and move["classification"] in ("inaccuracy", "mistake", "good", "best") and move["engine_best_move"]
    system = "\n".join(m["content"] for m in seen["body"]["messages"] if m["role"] == "system")
    assert "ENGINE FACTS" in system and move["engine_best_move"] in system and "never invent" in system
    msgs = client.get(f"/api/coach/conversations/{cid}/messages", headers=hdr(a)).json()
    assert [m["role"] for m in msgs] == ["user", "assistant"] and msgs[1]["provider"] == "groq" and msgs[1]["facts"]["move"]["played_move"] == "Qh5"
    # another user can neither read nor write into it
    assert client.get(f"/api/coach/conversations/{cid}/messages", headers=hdr(b)).status_code == 404
    assert client.post("/api/coach/chat", json={"messages": [{"role": "user", "content": "hi"}], "conversation_id": cid}, headers=hdr(b)).status_code == 404
    assert client.post("/api/coach/chat", json={"messages": [{"role": "user", "content": "hi"}], "conversation_id": cid}).status_code == 401
    assert client.get("/api/coach/conversations", headers=hdr(b)).json() == []
    assert client.delete(f"/api/coach/conversations/{cid}", headers=hdr(b)).status_code == 404
    assert client.delete(f"/api/coach/conversations/{cid}", headers=hdr(a)).status_code == 204          # owner can delete; messages cascade
    assert client.get(f"/api/coach/conversations/{cid}/messages", headers=hdr(a)).status_code == 404


def test_chat_validation_and_provider_errors(client, monkeypatch):
    assert client.post("/api/coach/chat", json={"messages": [{"role": "assistant", "content": "x"}]}).status_code == 422
    assert client.post("/api/coach/chat", json={"messages": [{"role": "user", "content": "x"}], "fen": "nonsense"}).status_code == 422
    log = []
    monkeypatch.setattr(routes_coach, "llm_router", build_router({"groq": httpx.MockTransport(handler_for("groq", log, status=429)), "gemini": httpx.MockTransport(handler_for("gemini", log, status=503))}))
    ev = chat(client, {"messages": [{"role": "user", "content": "hello"}]})
    assert ev[-1][0] == "error" and "temporarily unavailable" in ev[-1][1]["message"]


def test_stockfish_unavailable_is_reported_not_fabricated(client, monkeypatch):
    seen = {}
    def groq(req):
        seen["body"] = json.loads(req.content); return handler_for("groq", [])(req)
    monkeypatch.setattr(routes_coach, "llm_router", build_router({"groq": httpx.MockTransport(groq)}))
    old = settings.stockfish_path
    stockfish.close(); settings.stockfish_path = "/nonexistent/stockfish"
    try:
        ev = chat(client, {"messages": [{"role": "user", "content": "Evaluate this"}], "fen": BEFORE})
    finally:
        settings.stockfish_path = old; stockfish.close()
    assert [e for e, _ in ev][:2] == ["warning", "analysis"] and ev[1][1]["facts"].get("engine", "").startswith("UNAVAILABLE")
    assert "UNAVAILABLE" in "\n".join(m["content"] for m in seen["body"]["messages"] if m["role"] == "system")
    assert "position" not in ev[1][1]["facts"]