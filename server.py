#!/usr/bin/env python3
"""
LatentSearch backend — proxies requests to Replicate API.
Keeps the API key server-side only.
"""

import json
import os
import mimetypes
import time
import random
import threading
import collections
from http.server import HTTPServer, ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlparse, parse_qs
from concurrent.futures import ThreadPoolExecutor, as_completed


# ---------------------------------------------------------------------------
# Rate limiter — sliding window per IP
# ---------------------------------------------------------------------------
class RateLimiter:
    """Allow up to `max_requests` per `window_seconds` per IP address."""

    def __init__(self, max_requests: int = 20, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._hits: dict[str, collections.deque] = {}

    def is_allowed(self, ip: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            dq = self._hits.setdefault(ip, collections.deque())
            # Drop old entries
            while dq and dq[0] < cutoff:
                dq.popleft()
            if len(dq) >= self.max_requests:
                return False
            dq.append(now)
            return True


_rate_limiter = RateLimiter(max_requests=20, window_seconds=60)

# ---------------------------------------------------------------------------
# Global daily spend cap — hard limit across ALL IPs combined
# ---------------------------------------------------------------------------
DAILY_SEARCH_LIMIT  = int(os.environ.get("DAILY_SEARCH_LIMIT",  "500"))  # /api/search calls/day
DAILY_PAGE_LIMIT    = int(os.environ.get("DAILY_PAGE_LIMIT",    "200"))  # /api/page/stream calls/day
DAILY_IMAGE_LIMIT   = int(os.environ.get("DAILY_IMAGE_LIMIT",   "400"))  # /api/images/stream calls/day

_daily_lock   = threading.Lock()
_daily_counts = {"search": 0, "page": 0, "image": 0}
_daily_reset  = time.strftime("%Y-%m-%d", time.gmtime())

def _check_daily_limit(kind: str) -> bool:
    """Return True if request is within daily global cap. Thread-safe."""
    global _daily_reset, _daily_counts
    today = time.strftime("%Y-%m-%d", time.gmtime())
    limits = {"search": DAILY_SEARCH_LIMIT, "page": DAILY_PAGE_LIMIT, "image": DAILY_IMAGE_LIMIT}
    with _daily_lock:
        if today != _daily_reset:
            _daily_reset  = today
            _daily_counts = {"search": 0, "page": 0, "image": 0}
        if _daily_counts[kind] >= limits[kind]:
            return False
        _daily_counts[kind] += 1
        return True

# ---------------------------------------------------------------------------
# Search query log — in-memory ring buffer + JSONL file on disk
# ---------------------------------------------------------------------------
SEARCH_LOG_FILE = "searches.log"
_search_log: list = []          # last N entries in memory
_search_log_lock = threading.Lock()
_SEARCH_LOG_MAX = 10_000        # cap in-memory list


def _log_search(ip: str, query: str) -> None:
    """Append a search entry to the in-memory list and to searches.log on disk."""
    entry = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "ip": ip, "q": query}
    with _search_log_lock:
        _search_log.append(entry)
        if len(_search_log) > _SEARCH_LOG_MAX:
            _search_log.pop(0)
    try:
        with open(SEARCH_LOG_FILE, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")
    except OSError as exc:
        print(f"[log] could not write searches.log: {exc}")


# Security headers added to every response
_SECURITY_HEADERS = [
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("X-XSS-Protection", "1; mode=block"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Permissions-Policy", "microphone=(), camera=(), geolocation=()"),
    (
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' https: data:; "
        "connect-src 'self'",
    ),
]


def load_local_env(env_path: str = ".env"):
    """Load simple KEY=VALUE pairs from a local .env file if present."""
    if not os.path.exists(env_path):
        return

    with open(env_path, "r", encoding="utf-8") as env_file:
        for line in env_file:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue

            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_local_env()

API_TOKEN = os.environ.get("REPLICATE_API_TOKEN")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")

TEXT_MODEL_URL = "https://api.replicate.com/v1/models/meta/llama-4-scout-instruct/predictions"
IMAGE_MODEL_URL = "https://api.replicate.com/v1/models/prunaai/z-image-turbo/predictions"
MODERATION_MODEL_URL = "https://api.replicate.com/v1/models/meta/llama-guard-3-8b/predictions"
PAGE_MODEL_URL = "https://api.replicate.com/v1/models/deepseek-ai/deepseek-v3/predictions"


def parse_results_from_model_output(output) -> dict | None:
    """Parse a JSON object with a top-level `results` array from model output."""
    if isinstance(output, list):
        output_text = "".join(str(part) for part in output)
    elif output is None:
        return None
    else:
        output_text = str(output)

    cleaned = output_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()

    # Try direct parse first
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict) and isinstance(parsed.get("results"), list):
            return parsed
    except json.JSONDecodeError:
        pass

    # Extract largest balanced JSON object
    start = cleaned.find("{")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escaped = False
    end = -1
    for i, ch in enumerate(cleaned[start:], start=start):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i
                break

    if end == -1:
        return None

    try:
        parsed = json.loads(cleaned[start:end + 1])
        if isinstance(parsed, dict) and isinstance(parsed.get("results"), list):
            return parsed
    except json.JSONDecodeError:
        return None

    return None


def call_replicate(url: str, payload: dict, max_polls: int = 60) -> dict:
    """Make a blocking call to the Replicate API."""
    if not API_TOKEN:
        return {
            "error": "Missing REPLICATE_API_TOKEN. Set it in your environment or in a local .env file.",
        }

    body = json.dumps(payload).encode()
    req = Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {API_TOKEN}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "wait")
    try:
        with urlopen(req, timeout=120) as resp:
            prediction = json.loads(resp.read())
    except HTTPError as e:
        error_body = e.read().decode() if e.fp else str(e)
        print(f"[Replicate error] {e.code}: {error_body}")
        return {"error": error_body, "status": e.code}

    status = prediction.get("status")
    output = prediction.get("output")
    if status in {"starting", "processing"} or output is None:
        get_url = prediction.get("urls", {}).get("get")
        if not get_url:
            return prediction

        for _ in range(max_polls):
            time.sleep(2)
            poll_req = Request(get_url, method="GET")
            poll_req.add_header("Authorization", f"Bearer {API_TOKEN}")
            try:
                with urlopen(poll_req, timeout=120) as poll_resp:
                    prediction = json.loads(poll_resp.read())
            except HTTPError as e:
                error_body = e.read().decode() if e.fp else str(e)
                return {"error": error_body, "status": e.code}

            polled_status = prediction.get("status")
            if polled_status == "succeeded":
                return prediction
            if polled_status in {"failed", "canceled"}:
                return {
                    "error": prediction.get("error") or f"Prediction {polled_status}",
                    "status": polled_status,
                }

        return {
            "error": "Prediction timed out",
            "status": prediction.get("status", "processing"),
        }

    return prediction


def moderate_query(query: str) -> dict:
    """Run Llama Guard moderation and return whether query is safe."""
    payload = {
        "input": {
            "prompt": query,
        }
    }
    resp = call_replicate(MODERATION_MODEL_URL, payload)
    if resp.get("error"):
        return {
            "safe": True,
            "label": "safe",
            "status": "moderation_unavailable",
            "reason": resp.get("error", "Moderation failed"),
        }

    output = resp.get("output")
    if isinstance(output, list):
        text = "".join(str(part) for part in output).strip()
    elif output is None:
        text = ""
    else:
        text = str(output).strip()

    normalized = text.lower()
    first_line = normalized.splitlines()[0].strip() if normalized else ""
    is_unsafe = first_line.startswith("unsafe") or normalized.startswith("unsafe")
    is_safe = first_line.startswith("safe") or normalized.startswith("safe")

    if is_unsafe:
        return {
            "safe": False,
            "label": "unsafe",
            "status": "ok",
            "raw": text[:500],
        }

    if is_safe:
        return {
            "safe": True,
            "label": "safe",
            "status": "ok",
            "raw": text[:200],
        }

    return {
        "safe": True,
        "label": "safe",
        "status": "unknown_response",
        "raw": text[:200],
    }


def generate_search_results(query: str, page: int = 1) -> dict:
    """Generate results via three parallel prompts, then merge to 10 diverse items."""

    style_pool = [
        {
            "count": 4,
            "temperature": 0.85,
            "max_tokens": 720,
            "snippet_rule": "Mix very short and medium snippets (about 45-140 chars).",
            "angle": "practical guides, quick tips, and how-to pages",
        },
        {
            "count": 3,
            "temperature": 0.65,
            "max_tokens": 780,
            "snippet_rule": "Use informational snippets (about 80-180 chars), include at least one date prefix.",
            "angle": "editorial explainers, comparisons, and reference-style pages",
        },
        {
            "count": 3,
            "temperature": 0.98,
            "max_tokens": 860,
            "snippet_rule": "Use varied snippet lengths (about 60-220 chars) and varied tone.",
            "angle": "community recipes, niche blogs, and trending takes",
        },
    ]
    random.shuffle(style_pool)

    def fetch_batch(batch_config: dict) -> dict:
        count = batch_config["count"]
        prompt = f"""You generate realistic search engine results.
Query: {query}
Page: {page}

Return ONLY valid JSON in this shape:
{{
  "results": [
    {{
      "siteName": "Example Site",
      "domain": "example.com",
      "path": "/relevant/path",
      "favicon": "🌐",
      "title": "Result title",
      "snippet": "Result snippet",
      "date": "Mar 5, 2026"
    }}
  ]
}}

Rules:
- Generate exactly {count} results
- Focus on: {batch_config['angle']}
- {batch_config['snippet_rule']}
- Use real well-known domains mixed with plausible niche domains
- Keep page {page} different from page 1 baseline
- Use recent dates in Feb-Mar 2026 when dates are present
- Return JSON only, no markdown"""

        payload = {
            "input": {
                "top_k": 50,
                "top_p": 1,
                "prompt": prompt,
                "max_tokens": batch_config["max_tokens"],
                "min_tokens": 0,
                "temperature": batch_config["temperature"],
                "system_prompt": "You are a helpful assistant.",
                "stop_sequences": "",
                "prompt_template": "",
                "presence_penalty": 0.2,
                "frequency_penalty": 0.2,
            }
        }
        response = call_replicate(TEXT_MODEL_URL, payload)
        if response.get("error"):
            return {"error": response["error"], "results": []}

        parsed = parse_results_from_model_output(response.get("output"))
        if parsed and isinstance(parsed.get("results"), list):
            return {"results": parsed["results"]}
        return {"error": "Failed to parse batch", "results": []}

    merged_results = []
    errors = []

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(fetch_batch, cfg) for cfg in style_pool]
        for future in as_completed(futures):
            batch = future.result()
            if batch.get("error"):
                errors.append(batch["error"])
            merged_results.extend(batch.get("results", []))

    unique_results = []
    seen = set()
    for result in merged_results:
        domain = str(result.get("domain", "")).strip().lower()
        path = str(result.get("path", "")).strip().lower()
        title = str(result.get("title", "")).strip().lower()
        dedupe_key = (domain, path, title)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        unique_results.append(
            {
                "siteName": result.get("siteName") or domain or "Example Site",
                "domain": result.get("domain") or "example.com",
                "path": result.get("path") or "/",
                "favicon": result.get("favicon") or "🌐",
                "title": result.get("title") or "Search Result",
                "snippet": result.get("snippet") or "No description available.",
                "date": result.get("date") or "Mar 2026",
            }
        )

    if len(unique_results) < 10:
        remaining = 10 - len(unique_results)
        fallback_prompt = f"""Return only minified JSON with shape {{"results":[...]}}.
Generate exactly {remaining} additional realistic and different search results for query '{query}' page {page}.
Use varied snippet lengths and avoid duplicates from common top sites. JSON only."""
        fallback_payload = {
            "input": {
                "top_k": 50,
                "top_p": 1,
                "prompt": fallback_prompt,
                "max_tokens": 600,
                "min_tokens": 0,
                "temperature": 0.9,
                "system_prompt": "You are a helpful assistant.",
                "stop_sequences": "",
                "prompt_template": "",
                "presence_penalty": 0.3,
                "frequency_penalty": 0.3,
            }
        }
        fallback_resp = call_replicate(TEXT_MODEL_URL, fallback_payload)
        fallback_parsed = parse_results_from_model_output(fallback_resp.get("output"))
        if fallback_parsed and isinstance(fallback_parsed.get("results"), list):
            for result in fallback_parsed["results"]:
                domain = str(result.get("domain", "")).strip().lower()
                path = str(result.get("path", "")).strip().lower()
                title = str(result.get("title", "")).strip().lower()
                dedupe_key = (domain, path, title)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                unique_results.append(
                    {
                        "siteName": result.get("siteName") or domain or "Example Site",
                        "domain": result.get("domain") or "example.com",
                        "path": result.get("path") or "/",
                        "favicon": result.get("favicon") or "🌐",
                        "title": result.get("title") or "Search Result",
                        "snippet": result.get("snippet") or "No description available.",
                        "date": result.get("date") or "Mar 2026",
                    }
                )
                if len(unique_results) >= 10:
                    break

    if not unique_results:
        joined_errors = "; ".join(errors)[:500] if errors else "No valid responses"
        return {"error": "Failed to generate search results", "details": joined_errors}

    random.shuffle(unique_results)
    return {"results": unique_results[:10]}


def generate_single_image(query: str, variation: int, steps: int = 3) -> dict:
    """Generate a single image for an image search query."""
    rng = random.Random(f"{query}:{variation}")

    medium_styles = [
        "photorealistic",
        "editorial photography",
        "documentary style",
        "cinematic still",
        "minimalist studio shot",
        "digital art",
        "concept art",
        "watercolor illustration",
        "oil painting style",
        "3d render",
        "retro film look",
        "high fashion lookbook",
    ]

    camera_setups = [
        "35mm lens, f/1.8, shallow depth of field",
        "85mm portrait lens, soft bokeh",
        "24mm wide angle lens, deep focus",
        "macro lens, ultra fine detail",
        "telephoto compression, crisp edges",
        "top-down flat lay framing",
        "eye-level framing, natural perspective",
        "low-angle dramatic framing",
    ]

    lighting_setups = [
        "golden hour lighting",
        "soft studio key light",
        "window light, diffused shadows",
        "neon rim lighting",
        "moody low-key lighting",
        "bright overcast daylight",
        "backlit silhouette edges",
        "high-contrast spotlight",
    ]

    composition_setups = [
        "rule of thirds composition",
        "centered symmetrical composition",
        "negative space composition",
        "tight close-up crop",
        "environmental wide shot",
        "dynamic diagonal composition",
        "minimal clean background",
        "foreground depth layering",
    ]

    color_grades = [
        "natural colors",
        "vibrant saturated colors",
        "pastel color palette",
        "warm cinematic grade",
        "cool teal-orange grade",
        "muted matte tones",
        "high contrast black and white",
        "film grain and analog texture",
    ]

    size_variations = [
        (320, 320),
        (384, 320),
        (320, 384),
        (400, 320),
        (320, 400),
        (360, 360),
        (432, 288),
        (288, 432),
        (448, 320),
        (320, 448),
        (416, 312),
        (312, 416),
    ]

    style = rng.choice(medium_styles)
    camera = rng.choice(camera_setups)
    lighting = rng.choice(lighting_setups)
    composition = rng.choice(composition_setups)
    grade = rng.choice(color_grades)
    width, height = size_variations[variation % len(size_variations)]

    prompt = (
        f"{query}, {style}, {camera}, {lighting}, {composition}, {grade}, "
        "high detail, clean subject separation"
    )

    payload = {
        "input": {
            "width": width,
            "height": height,
            "prompt": prompt,
            "go_fast": False,
            "output_format": "jpg",
            "guidance_scale": 0,
            "output_quality": 80,
            "num_inference_steps": steps,
        }
    }
    resp = call_replicate(IMAGE_MODEL_URL, payload)
    if resp.get("error"):
        return {"error": resp["error"], "index": variation}

    output = resp.get("output")
    image_url = None
    if isinstance(output, list) and len(output) > 0:
        image_url = output[0]
    elif isinstance(output, str):
        image_url = output

    return {
        "url": image_url,
        "title": f"{query} — {style}",
        "source": f"{style} / {lighting}",
        "width": width,
        "height": height,
        "index": variation,
    }


def generate_image_results(query: str, page: int = 1, count: int = 8, steps: int = 3) -> dict:
    """Generate multiple images one-by-one for an image search query."""
    offset = (page - 1) * count
    results = []

    for i in range(count):
        result = generate_single_image(query, offset + i, steps)
        if result and "url" in result and result["url"]:
            results.append(result)

    results.sort(key=lambda r: r.get("index", 0))
    return {"images": results}


def generate_page(url: str, title: str, snippet: str) -> dict:
    """Ask the LLM to write a realistic full HTML page for the given URL."""
    full_prompt = (
        "You are an exceptional front-end designer. Output ONLY valid HTML starting with <!DOCTYPE html>. "
        "No markdown, no code fences, no explanations. Close every tag.\n\n"
        f"Design a memorable, production-quality webpage for:\n"
        f"URL: {url}\nTitle: {title}\nDescription: {snippet}\n\n"
        "DESIGN DIRECTION:\n"
        "Before writing code, decide on ONE bold aesthetic that fits the topic and commit fully: "
        "brutally minimal, maximalist editorial, retro-futuristic, organic/earthy, luxury/refined, "
        "playful/bright, brutalist/raw, art deco geometric, etc. Every choice must serve that direction.\n\n"
        "COLOR:\n"
        "- Pick a strong primary color fitting the topic — deep green, electric blue, warm terracotta, "
        "rich burgundy, midnight navy, saffron, forest, etc. NEVER default to grey/white/light-blue.\n"
        "- AVOID: cyan-on-dark, purple-to-blue gradients, neon on black. Those are AI clichés.\n"
        "- Tint neutrals toward the brand hue. Page bg = very light tint, NOT plain white.\n"
        "- Nav = primary color bg, white text. Footer = dark variant of primary.\n"
        "- Hero = full-width primary color or bold gradient, white text, min 300px tall.\n\n"
        "TYPOGRAPHY:\n"
        "- Use a Google Font (load via @import in <style>) — pick something characterful, not Inter/Roboto/Arial.\n"
        "- Strong visual hierarchy: big h1 (2.8rem+), clear h2, readable body (1rem, 1.6 line-height).\n\n"
        "LAYOUT:\n"
        "- Vary spacing — don't use identical padding everywhere. Create rhythm.\n"
        "- NOT everything in cards. Mix: full-bleed sections, featured items, text-heavy areas.\n"
        "- If using cards, vary sizes or alternate layouts. Avoid 3-identical-cards-in-a-row templates.\n"
        "- Asymmetry > centered everything. Left-align body text.\n\n"
        "AVOID these AI slop patterns:\n"
        "- Glassmorphism, generic drop shadows, rounded rect + thick colored left-border accent\n"
        "- Identical card grid (icon + heading + text × 6)\n"
        "- Hero with big metric number + gradient accent\n"
        "- Every button styled as primary CTA\n\n"
        "STRUCTURE:\n"
        "- body: display:flex;flex-direction:column;min-height:100vh;margin:0\n"
        "- Sticky <nav>, <main flex:1>, <footer margin-top:auto>\n"
        "- Max content width 1100px centered. 2-3 main sections.\n"
        "- Real content only, no lorem ipsum. Aim for ~170 lines total.\n"
        "- Images: <img src=\"\" data-latent-img=\"[vivid description]\" alt=\"[alt]\" "
        "style=\"width:100%;height:220px;object-fit:cover;border-radius:8px;background:#e8eaed;\"> (2-3 total)\n\n"
        "Output the HTML now:"
    )
    payload = {
        "input": {
            "prompt": full_prompt,
            "max_tokens": 2800,
            "temperature": 0.7,
            "top_p": 0.92,
        }
    }
    resp = call_replicate(PAGE_MODEL_URL, payload, max_polls=90)
    if resp.get("error"):
        return {"error": resp["error"], "tokens": []}

    output = resp.get("output", [])
    if isinstance(output, str):
        output = [output]
    return {"tokens": output}


class LatentSearchHandler(SimpleHTTPRequestHandler):
    """HTTP handler: serves static files + API endpoints."""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _client_ip(self) -> str:
        """Return best-guess client IP (respects X-Forwarded-For for Cloudflare)."""
        cf_ip = self.headers.get("CF-Connecting-IP")
        if cf_ip:
            return cf_ip.strip()
        forwarded = self.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def _add_security_headers(self):
        for name, value in _SECURITY_HEADERS:
            self.send_header(name, value)

    def _check_rate_limit(self) -> bool:
        """Return True if request is allowed. Sends 429 and returns False otherwise."""
        ip = self._client_ip()
        if not _rate_limiter.is_allowed(ip):
            body = json.dumps({"error": "Too many requests. Please slow down."}).encode()
            self.send_response(429)
            self.send_header("Content-Type", "application/json")
            self.send_header("Retry-After", "60")
            self._add_security_headers()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            print(f"[rate-limit] blocked {ip}")
            return False
        return True

    def do_GET(self):
        try:
            if self.path.startswith("/api/images/stream"):
                if not self._check_rate_limit():
                    return
                self._handle_images_stream()
            elif self.path.startswith("/api/page/stream"):
                if not self._check_rate_limit():
                    return
                self._handle_page_stream()
            elif self.path.startswith("/api/admin/searches"):
                self._handle_admin_searches()
            else:
                super().do_GET()
        except Exception as exc:
            print(f"[error] GET {self.path}: {exc}")

    def _handle_admin_searches(self):
        """Return recent search log as JSON. Requires ?token=ADMIN_TOKEN."""
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        token = params.get("token", [""])[0]
        if not ADMIN_TOKEN or token != ADMIN_TOKEN:
            self._send_json({"error": "Forbidden"}, 403)
            return
        limit = int(params.get("limit", ["500"])[0])
        with _search_log_lock:
            entries = list(_search_log[-limit:])
        self._send_json({"count": len(entries), "searches": entries})

    def do_POST(self):
        try:
            if self.path == "/api/search":
                if not self._check_rate_limit():
                    return
                self._handle_search()
            elif self.path == "/api/images":
                if not self._check_rate_limit():
                    return
                self._handle_images()
            else:
                self.send_error(404, "Not Found")
        except Exception as exc:
            print(f"[error] POST {self.path}: {exc}")
            try:
                self._send_json({"error": str(exc)}, 500)
            except Exception:
                pass

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        return json.loads(raw) if raw else {}

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self._add_security_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self._add_security_headers()
        self.end_headers()

    def _handle_search(self):
        if not _check_daily_limit("search"):
            self._send_json({"error": "Daily search limit reached. Try again tomorrow."}, 429)
            return
        try:
            body = self._read_body()
            query = body.get("query", "")
            page = body.get("page", 1)
            if not query:
                self._send_json({"error": "No query provided"}, 400)
                return

            moderation = moderate_query(query)
            if not moderation.get("safe", True):
                self._send_json(
                    {"error": "Query blocked by moderation", "moderation": moderation}, 400
                )
                return

            _log_search(self._client_ip(), query)
            print(f"[search] q={query!r} page={page}")
            with ThreadPoolExecutor(max_workers=2) as pool:
                text_future = pool.submit(generate_search_results, query, page)
                image_future = pool.submit(generate_image_results, query, 1, 3)
                text_payload = text_future.result()
                image_payload = image_future.result()

            if text_payload.get("error"):
                self._send_json(text_payload)
                return

            image_highlights = image_payload.get("images", []) if isinstance(image_payload, dict) else []
            self._send_json({
                "results": text_payload.get("results", []),
                "imageHighlights": image_highlights[:3],
            })
        except Exception as exc:
            print(f"[error] _handle_search: {exc}")
            try:
                self._send_json({"error": str(exc)}, 500)
            except Exception:
                pass

    def _handle_images(self):
        try:
            body = self._read_body()
            query = body.get("query", "")
            page = body.get("page", 1)
            count = body.get("count", 8)
            if not query:
                self._send_json({"error": "No query provided"}, 400)
                return

            moderation = moderate_query(query)
            if not moderation.get("safe", True):
                self._send_json(
                    {
                        "error": "Query blocked by moderation",
                        "moderation": moderation,
                    },
                    400,
                )
                return

            print(f"[images] q={query!r} page={page} count={count}")
            results = generate_image_results(query, page, count)
            self._send_json(results)
        except Exception as exc:
            print(f"[error] _handle_images: {exc}")
            try:
                self._send_json({"error": str(exc)}, 500)
            except Exception:
                pass

    def _handle_images_stream(self):
        """SSE endpoint: emits one image JSON event per generated image."""
        if not _check_daily_limit("image"):
            self._send_json({"error": "Daily image limit reached. Try again tomorrow."}, 429)
            return
        try:
            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)
            query = params.get("query", [""])[0]
            page = int(params.get("page", ["1"])[0])
            count = int(params.get("count", ["8"])[0])
            steps = int(params.get("steps", ["3"])[0])
        except Exception as exc:
            print(f"[error] _handle_images_stream parse: {exc}")
            self.send_error(400, "Bad Request")
            return

        if not query:
            self.send_response(400)
            self.end_headers()
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Connection", "keep-alive")
        self._add_security_headers()
        self.end_headers()

        print(f"[images/stream] q={query!r} page={page} count={count}")
        offset = (page - 1) * count
        for i in range(count):
            result = generate_single_image(query, offset + i, steps)
            if result and "url" in result and result["url"]:
                data = json.dumps(result)
                try:
                    self.wfile.write(f"data: {data}\n\n".encode())
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    return  # client disconnected

        try:
            self.wfile.write(b"data: {\"done\": true}\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, format, *args):
        # Only log API calls, not static files
        message = (format % args) if args else str(format)
        if "/api/" in message:
            super().log_message(format, *args)

    def _handle_page_stream(self):
        """SSE endpoint: streams LLM-generated HTML tokens for a fake page."""
        if not _check_daily_limit("page"):
            self._send_json({"error": "Daily page limit reached. Try again tomorrow."}, 429)
            return
        try:
            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)
            url = params.get("url", [""])[0]
            title = params.get("title", [""])[0]
            snippet = params.get("snippet", [""])[0]
        except Exception as exc:
            print(f"[error] _handle_page_stream parse: {exc}")
            self.send_error(400, "Bad Request")
            return

        if not url:
            self.send_response(400)
            self.end_headers()
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Connection", "keep-alive")
        self._add_security_headers()
        self.end_headers()

        print(f"[page/stream] url={url!r}")
        result = generate_page(url, title, snippet)

        if result.get("error"):
            err = json.dumps({"error": result["error"]})
            try:
                self.wfile.write(f"data: {err}\n\n".encode())
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        for token in result.get("tokens", []):
            chunk = json.dumps({"token": token})
            try:
                self.wfile.write(f"data: {chunk}\n\n".encode())
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return

        try:
            self.wfile.write(b"data: {\"done\": true}\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    PORT = 8080
    server = ThreadingHTTPServer(("", PORT), LatentSearchHandler)
    print(f"🔍 LatentSearch server running at http://localhost:{PORT}")
    if API_TOKEN:
        print(f"   API key: {'***' + API_TOKEN[-4:]}")
    else:
        print("   API key: missing (set REPLICATE_API_TOKEN in env or .env)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()
