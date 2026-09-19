from collections import defaultdict, deque
from time import monotonic


_windows: dict[str, deque[float]] = defaultdict(deque)


def allow_request(key: str, limit: int, window_seconds: int) -> bool:
    now = monotonic()
    window = _windows[key]
    while window and now - window[0] >= window_seconds:
        window.popleft()
    if len(window) >= limit:
        return False
    window.append(now)
    return True
