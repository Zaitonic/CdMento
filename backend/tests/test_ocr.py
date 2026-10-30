import io
from pypdf import PdfWriter
from backend.documents import extract


def blank_pdf(pages=2):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=500, height=300)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def test_missing_text_uses_local_ocr_and_retains_page_references(monkeypatch):
    calls = []

    def read(data, page):
        calls.append(page)
        return (
            ("Variables store values.", 0.97)
            if page == 1
            else ("Functions group instructions.", 0.96)
        )

    monkeypatch.setattr("backend.ocr.read_page", read)
    text, chunks = extract(blank_pdf(), "pdf")
    assert "Variables store values." in text and "Functions group instructions." in text
    assert calls == [1, 2]
    assert all(c["ocr"] for c in chunks)
    assert {c["page"] for c in chunks} == {1, 2}
    assert not any(c.get("unreadable") for c in chunks)


def test_ocr_limit_does_not_silently_claim_unread_pages(monkeypatch):
    monkeypatch.setattr(
        "backend.ocr.read_page", lambda *_: ("Readable chapter material.", 0.95)
    )
    _, chunks = extract(blank_pdf(), "pdf", max_ocr_pages=1)
    assert chunks[0]["ocr"]
    assert chunks[-1]["unreadable"] and chunks[-1]["page"] == 2
    assert "limit" in chunks[-1]["ocr_error"]


def test_local_ocr_can_read_a_real_image_pdf():
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1200, 300), "white")
    ImageDraw.Draw(image).text(
        (40, 80),
        "Variables store values.",
        font=ImageFont.load_default(size=54),
        fill="black",
    )
    output = io.BytesIO()
    image.save(output, format="PDF")
    image.close()
    text, chunks = extract(output.getvalue(), "pdf")
    assert "variables" in text.lower() and "values" in text.lower()
    assert chunks[0]["ocr"] and chunks[0]["page"] == 1
