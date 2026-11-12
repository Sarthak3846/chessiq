"""
Test set-up. If the real checkpoint exists it is used. Otherwise a RANDOM-WEIGHT checkpoint with the identical
architecture is generated, so the plumbing (API, validation, concurrency, legality, mate-finding) can be tested
without the trained file. Random weights say nothing about playing strength.
"""
import os
import sys
import tempfile
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[2]
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

REAL = ENGINE_ROOT / "checkpoints" / "model_d_square.pth"
USING_REAL_CHECKPOINT = REAL.is_file() and not os.getenv("ENGINE_CHECKPOINT")

if not os.getenv("ENGINE_CHECKPOINT") and not REAL.is_file():
    import torch

    from src.model import ChessIQNNUE

    torch.manual_seed(0)
    model = ChessIQNNUE(hidden_1=128, hidden_2=64, hidden_3=32, use_sqr_activation=True)
    tmp = Path(tempfile.mkdtemp()) / "random_test_model.pth"
    torch.save({"model_state_dict": model.state_dict(), "epoch": 0}, tmp)
    os.environ["ENGINE_CHECKPOINT"] = str(tmp)

os.environ.setdefault("ENGINE_DEFAULT_DEPTH", "3")
os.environ.setdefault("ENGINE_MAX_DEPTH", "4")
os.environ.setdefault("ENGINE_MAX_CONCURRENT", "2")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173,https://chessiq.vercel.app")

import pytest
from fastapi.testclient import TestClient

from api.main import app


@pytest.fixture(scope="session")
def client():
    # The context manager runs the lifespan, i.e. loads the model once for the whole test session.
    with TestClient(app) as c:
        yield c