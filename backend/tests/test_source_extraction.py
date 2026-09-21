from app.services.ingestion.source import UnsafeSourceUrl, extract_source_text


def test_extracts_visible_html_without_script_content() -> None:
    result = extract_source_text(
        (
            b"<html><body><h1>Admission call</h1><script>secret()</script>"
            b"<p>B2 English</p></body></html>"
        ),
        "text/html; charset=utf-8",
        "https://www.example.edu/call",
    )

    assert result.text == "Admission call\nB2 English"
    assert result.quality == "OK"


def test_rejects_non_http_source_url() -> None:
    import pytest

    from app.services.ingestion.source import _public_host

    with pytest.raises(UnsafeSourceUrl):
        _public_host("file:///etc/passwd")
