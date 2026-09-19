import httpx
from fastapi import HTTPException
from .config import settings
from .schemas import LLMRequest


async def openrouter_chat(request: LLMRequest) -> tuple[str, str]:
    model = (request.model or settings.openrouter_model).strip().lstrip("~")
    if not settings.openrouter_api_key or not model or "/" not in model:
        raise HTTPException(status_code=503, detail="OpenRouter API key and model must be configured on the server")
    timeout = httpx.Timeout(45.0, connect=10.0)
    if any(not image.startswith("data:image/") or len(image) > 2_500_000 for image in request.images):
        raise HTTPException(status_code=413, detail="Invalid or oversized screenshot")
    user_content = ([{"type": "text", "text": request.user}] + [{"type": "image_url", "image_url": {"url": image}} for image in request.images]) if request.images else request.user
    body = {"model": model, "temperature": request.temperature, "max_tokens": request.max_tokens, "messages": [{"role": "system", "content": request.system}, {"role": "user", "content": user_content}]}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post("https://openrouter.ai/api/v1/chat/completions", headers={"Authorization": f"Bearer {settings.openrouter_api_key}", "Content-Type": "application/json", "HTTP-Referer": "https://orbit.local"}, json=body)
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip(), data.get("model", model)
    except httpx.TimeoutException as error:
        raise HTTPException(status_code=504, detail="OpenRouter request timed out") from error
    except (httpx.HTTPError, KeyError, IndexError) as error:
        raise HTTPException(status_code=502, detail="OpenRouter request failed") from error
