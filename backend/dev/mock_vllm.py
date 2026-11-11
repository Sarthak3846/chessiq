"""Tiny OpenAI-compatible stand-in for vLLM, for local testing without a GPU.
Run:  python dev/mock_vllm.py   (listens on :8001, expects API key 'test-key')
It echoes the engine facts it was given, which is also a handy way to see what the real model receives."""
import asyncio
import json

import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse

app = FastAPI()
KEY = "test-key"


@app.get("/v1/models")
async def models(authorization: str = Header(default="")):
    if authorization != f"Bearer {KEY}":
        raise HTTPException(401, "bad key")
    return {"data": [{"id": "mock"}]}


@app.post("/v1/chat/completions")
async def chat(body: dict, authorization: str = Header(default="")):
    if authorization != f"Bearer {KEY}":
        raise HTTPException(401, "bad key")
    facts = next((m["content"] for m in body["messages"] if "ENGINE FACTS" in m["content"]), "")
    last = body["messages"][-1]["content"]
    best = ""
    for line in facts.splitlines():
        if '"engine_best_move"' in line or ('"best_move"' in line and not best):
            best = line.split(":")[1].strip(' ",')
    text = f"(mock model) You asked: {last[:60]}. The engine suggests **{best or 'no specific move'}**.\n\nHistory length seen: {len(body['messages'])} messages."

    async def gen():
        for w in text.split(" "):
            yield f"data: {json.dumps({'choices': [{'delta': {'content': w + ' '}}]})}\n\n"
            await asyncio.sleep(0.02)
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


if __name__ == "__main__":
    uvicorn.run(app, port=8001)