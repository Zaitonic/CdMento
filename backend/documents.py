import io
import re
import zipfile
from docx import Document
from pypdf import PdfReader


class NeedsOCR(Exception):
    pass


def extract(
    data: bytes, extension: str, *, ocr=True, on_progress=None, max_ocr_pages=100
):
    sections = []
    if extension == "pdf":
        if not data.lstrip().startswith(b"%PDF-"):
            raise ValueError("This file is not a valid PDF.")
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ValueError("Remove the PDF password before uploading.")
        if len(reader.pages) > 1000:
            raise ValueError("PDFs may contain at most 1,000 pages.")
        ocr_attempts = 0
        for page_number, page in enumerate(reader.pages, 1):
            native_text = page.extract_text() or ""
            section = {"page": page_number, "text": native_text}
            resources = page.get("/Resources") or {}
            if hasattr(resources, "get_object"):
                resources = resources.get_object()
            xobjects = resources.get("/XObject", {})
            if hasattr(xobjects, "get_object"):
                xobjects = xobjects.get_object()
            has_images = any(
                obj.get_object().get("/Subtype") == "/Image"
                for obj in xobjects.values()
            )
            needs_ocr = not native_text.strip() or (
                len(native_text.strip()) < 40 and has_images
            )
            if ocr and needs_ocr and ocr_attempts < max_ocr_pages:
                ocr_attempts += 1
                if on_progress:
                    on_progress(page_number, len(reader.pages), "ocr")
                try:
                    from .ocr import read_page

                    recognized, confidence = read_page(data, page_number)
                    if len(recognized.strip()) > len(native_text.strip()):
                        section.update(
                            text=recognized, ocr=True, ocr_confidence=confidence
                        )
                except (ImportError, RuntimeError, ValueError, OSError):
                    section["ocr_error"] = (
                        "Local OCR could not read this page. Try a clearer scan or paste its text."
                    )
            elif ocr and needs_ocr:
                section["ocr_error"] = (
                    "Automatic OCR page limit reached. Split this PDF into smaller chapters."
                )
            sections.append(section)
    elif extension == "docx":
        if not zipfile.is_zipfile(io.BytesIO(data)):
            raise ValueError("This file is not a valid DOCX.")
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(item.file_size for item in archive.infolist()) > 50 * 1024 * 1024:
                raise ValueError("This DOCX expands beyond the processing limit.")
            if "word/document.xml" not in archive.namelist():
                raise ValueError("This ZIP file is not a Word document.")
        document = Document(io.BytesIO(data))
        # iter_inner_content preserves paragraph/table order.
        for index, block in enumerate(document.iter_inner_content(), 1):
            text = (
                block.text
                if hasattr(block, "text")
                else "\n".join(
                    " | ".join(cell.text for cell in row.cells) for row in block.rows
                )
            )
            sections.append({"section": index, "text": text})
    else:
        if b"\x00" in data[:4096] and not data.startswith((b"\xff\xfe", b"\xfe\xff")):
            raise ValueError("Upload a text document, not a binary file.")
        try:
            text = data.decode(
                "utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
            )
        except UnicodeError:
            raise ValueError("Save this TXT file as UTF-8 and try again.") from None
        sections.append({"section": 1, "text": text})
    text = "\n\n".join(item["text"] for item in sections).strip()
    if not text:
        if extension == "pdf":
            raise NeedsOCR(
                "No readable text found. This PDF needs OCR before it can be studied."
            )
        raise ValueError("No readable text was found.")
    if len(text) > 2_000_000:
        raise ValueError(
            "Extracted text exceeds two million characters. Split this document into chapters."
        )
    chunks = []
    for section in sections:
        if "page" in section and not section["text"].strip():
            chunks.append(
                {
                    **{k: v for k, v in section.items() if k != "text"},
                    "text": "",
                    "unreadable": True,
                }
            )
        clean = re.sub(r"\s+", " ", section["text"]).strip()
        for offset in range(0, len(clean), 1800):
            chunks.append(
                {
                    **{k: v for k, v in section.items() if k != "text"},
                    "text": clean[offset : offset + 2000],
                }
            )
    return text, chunks


def reading_sections(chunks):
    """Reassemble overlapping extraction chunks using Python character offsets.

    Keeping this next to extraction avoids UTF-16/codepoint differences in the UI.
    """
    grouped = {}
    for chunk in chunks:
        key = (
            ("page", chunk["page"])
            if "page" in chunk
            else ("section", chunk.get("section", 1))
        )
        grouped.setdefault(key, []).append(chunk.get("text", ""))
    result = []
    for (kind, number), parts in grouped.items():
        text = parts[0] if parts else ""
        for previous, current in zip(parts, parts[1:]):
            text += current[max(0, len(previous) - 1800) :]
        result.append({"label": f"{kind.title()} {number}", "text": text})
    return result
