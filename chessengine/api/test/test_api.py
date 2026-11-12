import concurrent.futures as cf

import chess

from conftest import USING_REAL_CHECKPOINT  # noqa: F401  (documented in conftest)

MOVE = "/api/engine/move"


def post(client, **body):
    return client.post(MOVE, json=body)


def uci_game(*moves):
    return list(moves)


# ---------------------------------------------------------------- health
def test_health_reports_ready_model(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    j = r.json()
    assert j["ready"] is True and j["status"] == "ok"
    assert j["default_depth"] == 3 and j["max_depth"] == 4
    assert j["model"]["name"] == "CHESS-IQ NNUE"


# ---------------------------------------------------------------- legal engine moves
def test_engine_replies_to_first_move_with_legal_move(client):
    r = post(client, moves=["e2e4"])
    assert r.status_code == 200, r.text
    j = r.json()
    board = chess.Board()
    board.push_uci("e2e4")
    move = chess.Move.from_uci(j["best_move"])
    assert move in board.legal_moves
    assert board.san(move) == j["san"]
    board.push(move)
    assert j["fen"] == board.fen()
    assert j["depth"] == 3 and j["nodes"] > 0
    assert j["status"]["turn"] == "w" and j["status"]["game_over"] is False


def test_engine_plays_as_white_when_it_is_whites_turn(client):
    j = post(client, moves=[]).json()
    assert chess.Move.from_uci(j["best_move"]) in chess.Board().legal_moves


def test_fen_only_request(client):
    fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
    j = post(client, fen=fen).json()
    assert chess.Move.from_uci(j["best_move"]) in chess.Board(fen).legal_moves


def test_engine_finds_mate_in_one(client):
    # 1. f3 e5 2. g4 — Black plays Qh4#
    j = post(client, moves=["f2f3", "e7e5", "g2g4"], depth=2).json()
    assert j["best_move"] == "d8h4"
    assert j["status"]["game_over"] is True and j["status"]["result"] == "0-1"
    assert j["status"]["termination"] == "Checkmate"
    assert j["score"]["mate"] == -1


def test_custom_start_fen_with_moves(client):
    start = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1"
    j = post(client, start_fen=start, moves=["d1d8"]).json()   # Rd8# already mates, so the game is over
    assert j["best_move"] is None and j["status"]["result"] == "1-0"


# ---------------------------------------------------------------- terminal positions
def test_checkmate_position_returns_game_over(client):
    j = post(client, moves=["f2f3", "e7e5", "g2g4", "d8h4"]).json()
    assert j["best_move"] is None
    assert j["status"]["game_over"] and j["status"]["result"] == "0-1"


def test_stalemate_is_a_draw(client):
    j = post(client, fen="7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").json()
    assert j["best_move"] is None
    assert j["status"]["termination"] == "Stalemate" and j["status"]["result"] == "1/2-1/2"


def test_insufficient_material_is_a_draw(client):
    j = post(client, fen="8/8/4k3/8/8/3K4/8/8 w - - 0 1").json()
    assert j["status"]["termination"] == "Insufficient material"


def test_threefold_repetition_is_a_draw(client):
    shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"]
    j = post(client, moves=shuffle + shuffle).json()
    assert j["status"]["game_over"] and j["status"]["termination"] == "Threefold repetition"


def test_fifty_move_rule_is_a_draw(client):
    j = post(client, fen="4k3/8/8/8/8/8/4P3/4K2R w - - 100 80").json()
    assert j["status"]["termination"] == "Fifty-move rule"


# ---------------------------------------------------------------- rejected input
def test_illegal_move_is_rejected(client):
    r = post(client, moves=["e2e5"])
    assert r.status_code == 422 and "illegal" in r.json()["detail"].lower()


def test_move_for_wrong_side_is_rejected(client):
    assert post(client, moves=["e7e5"]).status_code == 422


def test_garbage_move_is_rejected(client):
    assert post(client, moves=["hello"]).status_code == 422
    assert post(client, moves=["zzzz"]).status_code == 422


def test_invalid_fen_is_rejected(client):
    r = post(client, fen="not a fen")
    assert r.status_code == 422 and "FEN" in r.json()["detail"]


def test_position_without_kings_is_rejected(client):
    assert post(client, fen="8/8/8/8/8/8/8/8 w - - 0 1").status_code == 422


def test_fen_and_moves_together_are_rejected(client):
    assert post(client, fen=chess.STARTING_FEN, moves=["e2e4"]).status_code == 422


def test_depth_above_server_limit_is_rejected(client):
    r = post(client, moves=[], depth=6)
    assert r.status_code == 422 and "limit" in r.json()["detail"]


def test_depth_zero_is_rejected(client):
    assert post(client, moves=[], depth=0).status_code == 422


def test_too_many_moves_is_rejected(client):
    assert post(client, moves=["g1f3", "g8f6", "f3g1", "f6g8"] * 200).status_code == 422


# ---------------------------------------------------------------- isolation / concurrency
def test_simultaneous_games_do_not_share_state(client):
    games = [
        ["e2e4"],
        ["d2d4"],
        ["c2c4"],
        ["g1f3"],
        ["f2f3", "e7e5", "g2g4"],           # forced mate for Black
        ["e2e4", "e7e5", "g1f3", "b8c6"],   # White to move
    ]

    def run(moves):
        board = chess.Board()
        for m in moves:
            board.push_uci(m)
        r = client.post(MOVE, json={"moves": moves, "depth": 2})
        return board, r

    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(run, games))

    for board, r in results:
        assert r.status_code == 200, r.text
        j = r.json()
        move = chess.Move.from_uci(j["best_move"])
        assert move in board.legal_moves                      # legal in ITS OWN game
        board.push(move)
        assert j["fen"] == board.fen()                        # and the FEN belongs to its own game
    assert results[4][1].json()["best_move"] == "d8h4"


def test_same_request_twice_is_deterministic(client):
    a = post(client, moves=["e2e4"], depth=2).json()
    b = post(client, moves=["e2e4"], depth=2).json()
    assert a["best_move"] == b["best_move"] and a["score"] == b["score"]


def test_restart_is_just_a_new_request(client):
    post(client, moves=["e2e4", "e7e5", "g1f3"])
    j = post(client, moves=[]).json()                          # "new game"
    assert chess.Move.from_uci(j["best_move"]) in chess.Board().legal_moves


# ---------------------------------------------------------------- CORS
def test_cors_allows_configured_origin_only(client):
    ok = client.options(MOVE, headers={"Origin": "https://chessiq.vercel.app", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert ok.headers.get("access-control-allow-origin") == "https://chessiq.vercel.app"
    bad = client.options(MOVE, headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers