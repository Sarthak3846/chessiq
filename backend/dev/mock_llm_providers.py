"""Local stand-in for the Groq and Gemini APIs (same wire formats) so the fallback chain can be exercised without keys.
   python dev/mock_llm_providers.py   → :9101   (point GROQ_BASE_URL=http://localhost:9101/groq, GEMINI_BASE_URL=http://localhost:9101/gemini)
   curl -XPOST localhost:9101/control -d '{"groq":"429"}'   # modes: ok | 429 | 500 | 401 | 400"""
import json
import re

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
MODE = {"groq": "ok", "gemini": "ok"}
CALLS: list[str] = []


@app.post("/control")
async def control(body: dict):
    MODE.update(body); CALLS.clear(); return MODE


@app.get("/calls")
async def calls():
    return CALLS


def answer(facts_text: str, last: str, who: str) -> str:
    best = re.search(r'"engine_best_move": "([^"]+)"', facts_text) or re.search(r'"best_move": "([^"]+)"', facts_text)
    return f"({who}) You asked: {last[:50]}. Stockfish's move is **{best.group(1) if best else 'not available'}**.\n\nEngine facts attached: {'yes' if 'ENGINE FACTS' in facts_text else 'no'}."


def fail(mode: str):
    code = int(mode)
    return JSONResponse({"error": {"message": f"mock {code}"}}, status_code=code, headers={"retry-after": "30"} if code == 429 else {})


@app.post("/groq/chat/completions")
async def groq(request: Request):
    CALLS.append("groq")
    if MODE["groq"] != "ok":
        return fail(MODE["groq"])
    body = await request.json()
    facts = "\n".join(m["content"] for m in body["messages"] if m["role"] == "system")
    text = answer(facts, body["messages"][-1]["content"], "Groq")

    async def gen():
        for w in text.split(" "):
            yield f"data: {json.dumps({'choices': [{'delta': {'content': w + ' '}}]})}\n\n"
        yield "data: [DONE]\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/gemini/models/{model}")
async def gemini(model: str, request: Request):
    CALLS.append("gemini")
    if MODE["gemini"] != "ok":
        return fail(MODE["gemini"])
    body = await request.json()
    facts = body.get("systemInstruction", {}).get("parts", [{}])[0].get("text", "")
    last = body["contents"][-1]["parts"][0]["text"]
    text = answer(facts, last, "Gemini")

    async def gen():
        for w in text.split(" "):
            yield f"data: {json.dumps({'candidates': [{'content': {'role': 'model', 'parts': [{'text': w + ' '}]}}]})}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")


if __name__ == "__main__":
    uvicorn.run(app, port=9101)