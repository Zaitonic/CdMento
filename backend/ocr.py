"""Offline CPU OCR and PDF rendering. All document pixels stay on this server."""

from pathlib import Path
import threading

# PDFium is not thread-safe, even across separate documents.
PDFIUM_LOCK = threading.RLock()
ENGINE_LOCK = threading.RLock()
_engine = None


def render_page(data: bytes, page_number: int, max_side=2000):
    import pypdfium2 as pdfium

    with PDFIUM_LOCK:
        document = pdfium.PdfDocument(data)
        try:
            page = document[page_number - 1]
            width, height = page.get_size()
            scale = min(2.5, max_side / max(width, height))
            bitmap = page.render(scale=scale)
            try:
                # Detach pixels before closing native PDFium objects.
                return bitmap.to_pil().convert("RGB").copy()
            finally:
                bitmap.close()
                page.close()
        finally:
            document.close()


def read_page(data: bytes, page_number: int):
    global _engine
    image = render_page(data, page_number)
    try:
        extrema = image.convert("L").getextrema()
        if extrema[1] - extrema[0] < 3:
            return "", None  # A truly blank page, not an OCR failure.
        with ENGINE_LOCK:
            if _engine is None:
                import rapidocr
                from rapidocr import RapidOCR

                models = Path(rapidocr.__file__).parent / "models"
                files = {
                    "Det": "PP-OCRv6_det_small.onnx",
                    "Rec": "PP-OCRv6_rec_small.onnx",
                    "Cls": "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
                }
                if any(not (models / name).is_file() for name in files.values()):
                    raise ValueError(
                        "Local OCR models are missing. Reinstall the pinned RapidOCR package."
                    )
                # Explicit bundled model paths prevent model downloads during uploads.
                params = {
                    f"{kind}.model_path": str(models / name)
                    for kind, name in files.items()
                }
                params.update(
                    {
                        "Global.log_level": "warning",
                        "Global.text_score": 0.5,
                        "EngineConfig.onnxruntime.intra_op_num_threads": 2,
                        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
                    }
                )
                _engine = RapidOCR(params=params)
            result = _engine(image)
        text = "\n".join(result.txts or [])
        confidence = (
            round(sum(result.scores) / len(result.scores), 3)
            if result.scores is not None and len(result.scores)
            else None
        )
        return text, confidence
    finally:
        image.close()
