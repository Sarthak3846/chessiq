import os

# Must be set BEFORE the app is imported. A local Postgres (tests/run_bootstrap.sh) stands in for Supabase.
os.environ.update({
    "DATABASE_URL": os.getenv("TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/chessiq"),
    "SUPABASE_JWT_SECRET": "test-jwt-secret-test-jwt-secret-1234",
    "GROQ_API_KEY": "groq-test", "GEMINI_API_KEY": "gemini-test",
    "STOCKFISH_PATH": os.getenv("STOCKFISH_PATH", "/usr/games/stockfish"),
})