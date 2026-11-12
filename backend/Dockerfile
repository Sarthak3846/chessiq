# ChessIQ main API (accounts, saved games, puzzles, AI Coach chat). Build context = the backend/ directory.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# The Coach's analysis uses a real Stockfish binary (Debian installs it to /usr/games/stockfish).
RUN apt-get update \
 && apt-get install -y --no-install-recommends stockfish \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY sql ./sql

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

ENV STOCKFISH_PATH=/usr/games/stockfish \
    PORT=8000
EXPOSE 8000

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'