"""HTTP limits and CORS. No cookies, forwarded IP trust or account-wide lockouts."""
import threading
import time
from urllib.parse import urlsplit


class RequestError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def allowed_origin(origin: str, configured: str = "") -> bool:
    if not origin:
        return True
    try:
        url = urlsplit(origin)
        if url.username or url.password or url.path or url.query or url.fragment:
            return False
        port = url.port
        hostname = f"[{url.hostname}]" if ":" in (url.hostname or "") else url.hostname
        canonical = f"{url.scheme}://{hostname}" + (f":{port}" if port and port != {"http": 80, "https": 443}.get(url.scheme) else "")
        if origin != canonical:
            return False
        loopback = url.hostname in ("localhost", "127.0.0.1", "::1")
        return (loopback and url.scheme == "http") or (url.scheme == "https" and origin in [item.strip() for item in configured.split(",")])
    except (ValueError, TypeError):
        return False


class RateLimiter:
    def __init__(self):
        self.buckets = {}
        self.lock = threading.Lock()

    def allow(self, key: str, limit: int, now=None) -> bool:
        now = time.monotonic() if now is None else now
        with self.lock:
            if len(self.buckets) >= 4096:
                self.buckets = {k: v for k, v in self.buckets.items() if now - v[0] < 60}
                if len(self.buckets) >= 4096 and key not in self.buckets:
                    return False
            start, count = self.buckets.get(key, (now, 0))
            if now - start >= 60:
                start, count = now, 0
            self.buckets[key] = (start, count + 1)
            return count < limit
