import ipaddress
import socket
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from io import BytesIO
from urllib.parse import urlsplit, urlunsplit

import httpx
from pypdf import PdfReader

MAX_SOURCE_BYTES = 5 * 1024 * 1024
MAX_PDF_BYTES = MAX_SOURCE_BYTES
MAX_PDF_PAGES = 50
MAX_REDIRECTS = 5
ALLOWED_CONTENT_TYPES = frozenset(
    {
        "text/html",
        "text/plain",
        "application/pdf",
        "application/xhtml+xml",
    }
)


class UnsafeSourceUrl(ValueError):
    """Raised when a URL could be used to reach a private network."""


class SourceTooLarge(ValueError):
    """Raised when a source response exceeds MAX_SOURCE_BYTES."""


class SourceRedirectError(ValueError):
    """Raised when redirects exceed the limit or form a loop."""


class UnsupportedSourceType(ValueError):
    """Raised when Content-Type is outside the allowed html/text/pdf set."""


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript"}:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self._ignored_depth:
            self._ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth and data.strip():
            self._parts.append(data.strip())

    @property
    def text(self) -> str:
        return "\n".join(self._parts)


@dataclass(frozen=True)
class SourceText:
    source_url: str
    content_type: str
    text: str
    quality: str
    used_ocr: bool = False

    def to_dict(self) -> dict[str, str | bool]:
        return asdict(self)


@dataclass(frozen=True)
class _ValidatedTarget:
    url: str
    hostname: str
    pinned_ips: tuple[str, ...]


def _normalize_hostname(hostname: str) -> str:
    return hostname.rstrip(".").lower()


def _resolve_global_ips(hostname: str) -> tuple[str, ...]:
    try:
        addresses = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise UnsafeSourceUrl("Source host cannot be resolved") from error
    ips: list[str] = []
    seen: set[str] = set()
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise UnsafeSourceUrl("Private or reserved source hosts are not allowed")
        text = str(ip)
        if text not in seen:
            seen.add(text)
            ips.append(text)
    if not ips:
        raise UnsafeSourceUrl("Source host cannot be resolved")
    return tuple(ips)


def validate_source_url(url: str) -> _ValidatedTarget:
    """Pre-validate a source URL (scheme, credentials, DNS, global IPs only)."""
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeSourceUrl("Only absolute HTTP(S) URLs are allowed")
    if parsed.username or parsed.password:
        raise UnsafeSourceUrl("URLs with credentials are not allowed")
    hostname = _normalize_hostname(parsed.hostname)
    if hostname in {"localhost", "localhost.localdomain"}:
        raise UnsafeSourceUrl("Local hosts are not allowed")
    pinned_ips = _resolve_global_ips(hostname)
    return _ValidatedTarget(url=url, hostname=hostname, pinned_ips=pinned_ips)


def _public_host(url: str) -> str:
    """Backward-compatible helper used by tests; returns validated hostname."""
    return validate_source_url(url).hostname


class _PinnedIPTransport(httpx.HTTPTransport):
    """Connect only to previously validated global IPs (DNS rebinding protection).

    At connect time we re-resolve the hostname; if any private address appears or the
    pinned set no longer overlaps fresh global IPs, the request is rejected. The
    socket opens against a pinned IP via URL rewrite — Host header and TLS SNI keep
    the original hostname. Process-global ``socket.getaddrinfo`` is never mutated.
    """

    def __init__(self, hostname: str, pinned_ips: tuple[str, ...], **kwargs) -> None:
        self._hostname = _normalize_hostname(hostname)
        self._pinned_ips = pinned_ips
        super().__init__(**kwargs)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        host = _normalize_hostname(request.url.host or "")
        if host != self._hostname:
            raise UnsafeSourceUrl("Unexpected host for pinned transport")

        # Re-resolve and reject if DNS now yields a private address.
        fresh = _resolve_global_ips(self._hostname)
        pinned_set = set(self._pinned_ips)
        if not any(ip in pinned_set for ip in fresh):
            raise UnsafeSourceUrl("Hostname IP changed between validation and connect")

        connect_ip = next(ip for ip in self._pinned_ips if ip in fresh)
        if not ipaddress.ip_address(connect_ip).is_global:
            raise UnsafeSourceUrl("Pinned IP is no longer global")

        # Connect to the pinned IP while keeping Host + TLS identity as the hostname.
        # httpcore reads extensions["sni_hostname"] for server_hostname during TLS.
        headers = request.headers.copy()
        port = request.url.port
        host_header = self._hostname if port is None else f"{self._hostname}:{port}"
        headers["Host"] = host_header
        extensions = dict(request.extensions)
        extensions["sni_hostname"] = self._hostname
        # IPv6 literals must be bracketed in the URL host component.
        url_host = (
            f"[{connect_ip}]"
            if ipaddress.ip_address(connect_ip).version == 6
            else connect_ip
        )
        pinned_request = httpx.Request(
            method=request.method,
            url=request.url.copy_with(host=url_host),
            headers=headers,
            stream=request.stream,
            extensions=extensions,
        )
        return super().handle_request(pinned_request)


def _normalize_content_type(content_type: str) -> str:
    return content_type.split(";", 1)[0].lower().strip()


def _looks_like_pdf(url: str, content_type: str) -> bool:
    if content_type == "application/pdf":
        return True
    return url.lower().split("?", 1)[0].endswith(".pdf")


def _assert_allowed_content_type(content_type: str, source_url: str) -> str:
    normalized = _normalize_content_type(content_type)
    if not normalized:
        if _looks_like_pdf(source_url, ""):
            return "application/pdf"
        return "text/plain"
    if normalized in ALLOWED_CONTENT_TYPES or normalized.startswith("text/"):
        return normalized
    if "html" in normalized:
        return normalized
    if _looks_like_pdf(source_url, normalized):
        return "application/pdf"
    raise UnsupportedSourceType(f"Unsupported content type: {normalized}")


def _read_body_limited(response: httpx.Response) -> bytes:
    content_length = response.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > MAX_SOURCE_BYTES:
                response.close()
                raise SourceTooLarge(
                    f"Content-Length {content_length} exceeds {MAX_SOURCE_BYTES} bytes"
                )
        except ValueError:
            pass

    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_bytes():
        total += len(chunk)
        if total > MAX_SOURCE_BYTES:
            response.close()
            raise SourceTooLarge(f"Response exceeds {MAX_SOURCE_BYTES} bytes")
        chunks.append(chunk)
    return b"".join(chunks)


def _extract_pdf(data: bytes) -> tuple[str, str]:
    if len(data) > MAX_PDF_BYTES:
        return "", "MANUAL_REVIEW_REQUIRED"
    try:
        reader = PdfReader(BytesIO(data), strict=False)
        page_count = len(reader.pages)
        if page_count > MAX_PDF_PAGES:
            return "", "MANUAL_REVIEW_REQUIRED"
        parts: list[str] = []
        for index, page in enumerate(reader.pages):
            if index >= MAX_PDF_PAGES:
                return "", "MANUAL_REVIEW_REQUIRED"
            parts.append((page.extract_text() or "").strip())
        text = "\n\n".join(part for part in parts if part).strip()
    except Exception:
        return "", "MANUAL_REVIEW_REQUIRED"
    return text, "OK" if len("".join(text.split())) >= 80 else "LOW_EXTRACTION_QUALITY"


def extract_source_text(data: bytes, content_type: str, source_url: str) -> SourceText:
    normalized_type = _assert_allowed_content_type(content_type, source_url)
    is_pdf = _looks_like_pdf(source_url, normalized_type)
    if is_pdf:
        text, quality = _extract_pdf(data)
        return SourceText(source_url, "application/pdf", text, quality)

    decoded = data.decode("utf-8", errors="replace")
    if "html" in normalized_type or "<html" in decoded[:1000].lower():
        parser = _TextExtractor()
        parser.feed(decoded)
        text = parser.text
        quality = "OK" if text else "LOW_EXTRACTION_QUALITY"
        return SourceText(source_url, "text/html", text, quality)
    quality = "OK" if decoded.strip() else "LOW_EXTRACTION_QUALITY"
    return SourceText(source_url, normalized_type or "text/plain", decoded, quality)


def _canonical_redirect_key(url: str) -> str:
    parts = urlsplit(url)
    path = parts.path or "/"
    return urlunsplit(
        (parts.scheme.lower(), _normalize_hostname(parts.netloc), path, parts.query, "")
    )


def fetch_and_extract_source(url: str, timeout_seconds: float = 20) -> SourceText:
    current = url
    seen: set[str] = set()
    for _ in range(MAX_REDIRECTS + 1):
        key = _canonical_redirect_key(current)
        if key in seen:
            raise SourceRedirectError("Redirect loop detected")
        seen.add(key)

        target = validate_source_url(current)
        transport = _PinnedIPTransport(target.hostname, target.pinned_ips)
        with httpx.Client(
            timeout=timeout_seconds,
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        ) as client:
            with client.stream(
                "GET",
                current,
                headers={"User-Agent": "IMMIGROME-SourceBot/1.0"},
            ) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise SourceRedirectError("Source redirected without a location")
                    current = str(httpx.URL(current).join(location))
                    continue
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                _assert_allowed_content_type(content_type, current)
                body = _read_body_limited(response)
        return extract_source_text(body, content_type, current)

    raise SourceRedirectError(f"Exceeded maximum of {MAX_REDIRECTS} redirects")
