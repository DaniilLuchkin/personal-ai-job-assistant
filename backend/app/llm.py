import httpx
from fastapi import HTTPException
from .config import settings
from .schemas import LLMRequest


async def openrouter_chat(request: LLMRequest) -> tuple[str, str]:
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OpenRouter is not configured on the server")
    timeout = httpx.Timeout(45.0, connect=10.0)
    body = {"model": settings.openrouter_model, "temperature": request.temperature, "max_tokens": request.max_tokens, "messages": [{"role": "system", "content": request.system}, {"role": "user", "content": request.user}]}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post("https://openrouter.ai/api/v1/chat/completions", headers={"Authorization": f"Bearer {settings.openrouter_api_key}", "Content-Type": "application/json", "HTTP-Referer": "https://orbit.local"}, json=body)
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip(), data.get("model", settings.openrouter_model)
    except httpx.TimeoutException as error:
        raise HTTPException(status_code=504, detail="OpenRouter request timed out") from error
    except (httpx.HTTPError, KeyError, IndexError) as error:
        raise HTTPException(status_code=502, detail="OpenRouter request failed") from error
