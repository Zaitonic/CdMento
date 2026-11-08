import { useEffect, useRef } from "react";
import { usePublicTheme } from "./PublicTheme";

/** Original canvas ribbon inspired by Kokonut UI's Background Paths. */
export function FlowingPaths({ paused }: { paused: boolean }) {
  const { theme } = usePublicTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    pausedRef.current = paused;
    wake.current();
  }, [paused]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof CanvasRenderingContext2D === "undefined") return;
    const context = canvas.getContext("2d");
    const hero = canvas.parentElement;
    if (!context || !hero) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 1,
      height = 1,
      frame = 0,
      previous = 0,
      phase = 0,
      visible = true;
    const pointer = { x: -1000, y: -1000, strength: 0, active: false };
    const canAnimate = () =>
      !pausedRef.current && !reduced.matches && visible && !document.hidden;
    function draw() {
      if (!context) return;
      context.clearRect(0, 0, width, height);
      const radius = Math.min(180, width * 0.28);
      for (let line = 0; line < 42; line++) {
        context.beginPath();
        context.strokeStyle = `rgba(${theme === "dark" ? "223, 183, 119" : "120, 85, 169"}, ${0.29 + (line % 6) * 0.025})`;
        context.lineWidth = line % 7 === 0 ? 1.3 : 0.8;
        for (let point = 0; point <= 80; point++) {
          const x = -40 + ((width + 80) * point) / 80;
          const u = x / width;
          let y =
            height * 0.45 +
            (line - 20.5) * 11 +
            Math.sin(u * Math.PI * 2 + phase * 0.28 + line * 0.075) *
              height *
              0.13 +
            Math.cos(u * Math.PI + phase * 0.17 + line * 0.11) * height * 0.14;
          const dx = x - pointer.x,
            dy = y - pointer.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < radius && pointer.strength > 0.001)
            y +=
              (dy < 0 ? -1 : 1) *
              (1 - distance / radius) ** 2 *
              65 *
              pointer.strength;
          if (point === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
    }
    function tick(now: number) {
      frame = 0;
      if (!canAnimate()) {
        previous = 0;
        return;
      }
      if (!previous || now - previous >= 32) {
        phase += previous ? Math.min((now - previous) / 1000, 0.08) : 0.032;
        previous = now;
        pointer.strength +=
          ((pointer.active ? 1 : 0) - pointer.strength) * 0.12;
        draw();
      }
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      if (reduced.matches) {
        pointer.strength = 0;
        draw();
      }
      if (canAnimate()) frame = requestAnimationFrame(tick);
    }
    function resize() {
      const bounds = hero!.getBoundingClientRect();
      width = Math.max(bounds.width, 1);
      height = Math.max(bounds.height, 1);
      const scale = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas!.width = Math.round(width * scale);
      canvas!.height = Math.round(height * scale);
      context!.setTransform(scale, 0, 0, scale, 0, 0);
      draw();
    }
    function move(event: PointerEvent) {
      if (event.pointerType === "touch" || !canAnimate()) return;
      const bounds = hero!.getBoundingClientRect();
      pointer.x = event.clientX - bounds.left;
      pointer.y = event.clientY - bounds.top;
      pointer.active = true;
    }
    function leave() {
      pointer.active = false;
    }
    const resizeObserver = new ResizeObserver(resize);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    resizeObserver.observe(hero);
    observer.observe(hero);
    hero.addEventListener("pointermove", move, { passive: true });
    hero.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    wake.current = sync;
    resize();
    sync();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      observer.disconnect();
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
      wake.current = () => {};
    };
  }, [theme]);
  return (
    <canvas ref={canvasRef} className="flowing-paths" aria-hidden="true" />
  );
}
