import ipaddress
import socket
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from io import BytesIO
from urllib.parse import urlsplit

import httpx
from pypdf import PdfReader


class UnsafeSourceUrl(ValueError):
    """Raised when a URL could be used to reach a private network."""


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


def _public_host(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeSourceUrl("Only absolute HTTP(S) URLs are allowed")
    if parsed.username or parsed.password:
        raise UnsafeSourceUrl("URLs with credentials are not allowed")
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname in {"localhost", "localhost.localdomain"}:
        raise UnsafeSourceUrl("Local hosts are not allowed")
    try:
        addresses = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise UnsafeSourceUrl("Source host cannot be resolved") from error
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise UnsafeSourceUrl("Private or reserved source hosts are not allowed")
    return hostname


def _extract_pdf(data: bytes) -> tuple[str, str]:
    try:
        reader = PdfReader(BytesIO(data))
        text = "\n\n".join((page.extract_text() or "").strip() for page in reader.pages).strip()
    except Exception:
        return "", "MANUAL_REVIEW_REQUIRED"
    return text, "OK" if len("".join(text.split())) >= 80 else "LOW_EXTRACTION_QUALITY"


def extract_source_text(data: bytes, content_type: str, source_url: str) -> SourceText:
    normalized_type = content_type.split(";", 1)[0].lower().strip()
    is_pdf = normalized_type == "application/pdf" or source_url.lower().split(
        "?", 1
    )[0].endswith(".pdf")
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


def fetch_and_extract_source(url: str, timeout_seconds: float = 20) -> SourceText:
    _public_host(url)
    with httpx.Client(timeout=timeout_seconds, follow_redirects=False) as client:
        response = client.get(url, headers={"User-Agent": "IMMIGROME-SourceBot/1.0"})
    if response.is_redirect:
        location = response.headers.get("location")
        if not location:
            raise ValueError("Source redirected without a location")
        redirected = str(httpx.URL(url).join(location))
        _public_host(redirected)
        return fetch_and_extract_source(redirected, timeout_seconds)
    response.raise_for_status()
    return extract_source_text(response.content, response.headers.get("content-type", ""), url)
