import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Loader2,
  Maximize2,
} from "lucide-react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfReader({
  url,
  name,
  initialPage = 1,
}: {
  url: string;
  name: string;
  initialPage?: number;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (pdf) setPage(Math.max(1, Math.min(pdf.numPages, initialPage)));
  }, [pdf, initialPage]);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(500);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setPdf(null);
    setPage(1);
    setZoom(1);
    setError("");
    setBusy(true);
    // Render document content only; do not execute document scripting or XFA forms.
    const task = getDocument({ url, enableXfa: false });
    task.promise
      .then((doc) => {
        if (active) setPdf(doc);
      })
      .catch((e) => {
        if (active) {
          setError(e.message || "Could not read this PDF. Try extracted text.");
          setBusy(false);
        }
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [url]);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(180, entries[0].contentRect.width - 32)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !sheet.current) return;
    let active = true;
    let render: RenderTask | undefined;
    let text: TextLayer | undefined;
    setBusy(true);
    setError("");
    const element = sheet.current;
    pdf
      .getPage(page)
      .then(async (documentPage) => {
        if (!active) return;
        const natural = documentPage.getViewport({ scale: 1 });
        const scale = Math.min(width / natural.width, 1.35) * zoom;
        const viewport = documentPage.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `${name}, page ${page}`);
        const textContainer = document.createElement("div");
        textContainer.className = "pdf-text-layer";
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        element.style.setProperty("--total-scale-factor", String(scale));
        element.replaceChildren(canvas, textContainer);
        render = documentPage.render({
          canvas,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await render.promise;
        if (!active) return;
        text = new TextLayer({
          container: textContainer,
          viewport,
          textContentSource: await documentPage.getTextContent(),
        });
        await text.render();
      })
      .catch((e) => {
        if (active && e.name !== "RenderingCancelledException")
          setError(
            "This page could not be rendered. You can still read extracted text or download the original.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      render?.cancel();
      text?.cancel();
    };
  }, [pdf, page, zoom, width, name]);
  return (
    <div className="pdf-reader" aria-label={`PDF reader: ${name}`}>
      <div className="pdf-reader-toolbar">
        <div>
          <button
            aria-label="Previous PDF page"
            disabled={!pdf || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <label>
            <input
              aria-label="PDF page number"
              type="number"
              min={1}
              max={pdf?.numPages || 1}
              value={page}
              onChange={(e) =>
                setPage(
                  Math.max(
                    1,
                    Math.min(pdf?.numPages || 1, Number(e.target.value) || 1),
                  ),
                )
              }
            />{" "}
            / {pdf?.numPages || "…"}
          </label>
          <button
            aria-label="Next PDF page"
            disabled={!pdf || page >= pdf.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div>
          <button
            aria-label="Zoom out PDF"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          >
            <Minus size={15} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="Zoom in PDF"
            disabled={zoom >= 2.5}
            onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
          >
            <Plus size={15} />
          </button>
          <button aria-label="Fit PDF to width" onClick={() => setZoom(1)}>
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
      {error && (
        <p className="pdf-reader-error" role="alert">
          {error}
        </p>
      )}
      <div className="pdf-reader-scroll" ref={scroll}>
        {busy && (
          <div className="pdf-loading" role="status">
            <Loader2 size={16} className="spin" />
            Rendering page…
          </div>
        )}
        <div className="pdf-sheet" ref={sheet} />
      </div>
      <p className="pdf-reader-caption">
        Select text on the page, or switch to extracted text for a reading view.
      </p>
    </div>
  );
}
