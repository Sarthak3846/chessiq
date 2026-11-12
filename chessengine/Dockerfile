# CHESS-IQ engine API — CPU only, no PyTorch (the network runs in NumPy). Build context = the chessengine/ directory.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements-api-lite.txt .
RUN pip install -r requirements-api-lite.txt

# Only what the API needs. Training data, scripts and the Tkinter demo stay out of the image.
COPY src ./src
COPY api ./api
# The build fails here if checkpoints/model_d_square.npz is not in the repository — that is intentional.
COPY checkpoints ./checkpoints

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

# Use the PyTorch-free runtime. Render injects $PORT (10000 by default); 8001 is the fallback for local runs.
ENV ENGINE_RUNTIME=numpy \
    PORT=8001
EXPOSE 8001

# Shell form so $PORT is expanded. --proxy-headers lets the per-IP rate limit see the real client address.
CMD uvicorn api.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'