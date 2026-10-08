import {
  useEffect,
  useRef,
  type RefObject,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
type View = { start: number; span: number };
type Options = {
  canvas: RefObject<HTMLElement | null>;
  view: View;
  zoom: number;
  maxZoom: number;
  mode: "tune" | "pan";
  step: number;
  frequency: number;
  onTune: (frequency: number, center: number) => void;
  onView: (center: number, zoom: number) => void;
  onEnd: () => void;
};
type Gesture = {
  startX: number;
  view: View;
  zoom: number;
  width: number;
  left: number;
  mode: "tune" | "pan";
  moved: boolean;
  pinched: boolean;
  pinch?: { distance: number; anchor: number; zoom: number; span: number };
};
export function useSpectrumGesture(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const lastWheel = useRef(0);
  const points = useRef(new Map<number, number>()),
    gesture = useRef<Gesture | null>(null);
  const position = (g: Gesture, x: number) =>
    g.view.start +
    Math.max(0, Math.min(1, (x - g.left) / g.width)) * g.view.span;
  function down(e: PointerEvent<HTMLElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    points.current.set(e.pointerId, e.clientX);
    if (points.current.size === 1) {
      const r = e.currentTarget.getBoundingClientRect();
      gesture.current = {
        startX: e.clientX,
        view: { ...latest.current.view },
        zoom: latest.current.zoom,
        width: r.width,
        left: r.left,
        mode: latest.current.mode,
        moved: false,
        pinched: false,
      };
    }
    if (points.current.size === 2 && gesture.current) {
      const g = gesture.current;
      g.view = { ...latest.current.view };
      const [a, b] = [...points.current.values()];
      g.pinched = true;
      g.pinch = {
        distance: Math.max(1, Math.abs(b - a)),
        anchor: position(g, (a + b) / 2),
        zoom: latest.current.zoom,
        span: latest.current.view.span,
      };
    }
  }
  const pending = useRef<{
    frequency?: number;
    center: number;
    zoom?: number;
  } | null>(null);
  const frame = useRef(0);
  function flush() {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    if (p.frequency !== undefined) latest.current.onTune(p.frequency, p.center);
    else latest.current.onView(p.center, p.zoom!);
  }
  function queue(value: { frequency?: number; center: number; zoom?: number }) {
    pending.current = value;
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  }
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
    },
    [],
  );
  function move(e: PointerEvent<HTMLElement>) {
    if (!points.current.has(e.pointerId) || !gesture.current) return;
    points.current.set(e.pointerId, e.clientX);
    const g = gesture.current;
    if (g.pinched) {
      if (points.current.size !== 2 || !g.pinch) return;
      const [a, b] = [...points.current.values()],
        p = g.pinch;
      const zoom = Math.max(
        0,
        Math.min(
          latest.current.maxZoom,
          Math.round(
            p.zoom + Math.log2(Math.max(1, Math.abs(b - a)) / p.distance),
          ),
        ),
      );
      const span = p.span / 2 ** (zoom - p.zoom),
        fraction = ((a + b) / 2 - g.left) / g.width;
      queue({ center: p.anchor - (fraction - 0.5) * span, zoom });
      return;
    }
    if (Math.abs(e.clientX - g.startX) > 5) g.moved = true;
    if (!g.moved) return;
    if (g.mode === "pan")
      queue({
        center:
          g.view.start +
          g.view.span / 2 -
          ((e.clientX - g.startX) / g.width) * g.view.span,
        zoom: g.zoom,
      });
    else
      queue({
        frequency: position(g, e.clientX),
        center: g.view.start + g.view.span / 2,
      });
  }
  function end(e: PointerEvent<HTMLElement>, cancelled = false) {
    const g = gesture.current;
    if (!points.current.has(e.pointerId) || !g) return;
    points.current.delete(e.pointerId);
    if (!points.current.size) {
      flush();
      if (!cancelled && !g.pinched) {
        if (!g.moved || g.mode === "tune")
          latest.current.onTune(
            position(g, e.clientX),
            g.view.start + g.view.span / 2,
          );
      }
      gesture.current = null;
      latest.current.onEnd();
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  useEffect(() => {
    const canvas = options.canvas.current;
    if (!canvas) return;
    const wheel = (e: WheelEvent) => {
      // Scrolling the page over the display must not silently magnify it.
      if (document.activeElement !== canvas && !e.ctrlKey) return;
      e.preventDefault();
      const o = latest.current;
      if (!e.shiftKey && performance.now() - lastWheel.current < 80) return;
      lastWheel.current = performance.now();
      if (e.shiftKey) {
        o.onView(
          o.view.start +
            o.view.span / 2 +
            Math.sign(e.deltaY || e.deltaX) * o.view.span * 0.15,
          o.zoom,
        );
        return;
      }
      const zoom = Math.max(
        0,
        Math.min(o.maxZoom, o.zoom + (e.deltaY < 0 ? 1 : -1)),
      );
      const r = canvas.getBoundingClientRect(),
        fraction = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        anchor = o.view.start + fraction * o.view.span,
        span = o.view.span / 2 ** (zoom - o.zoom);
      o.onView(anchor - (fraction - 0.5) * span, zoom);
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [options.canvas]);
  function key(e: KeyboardEvent<HTMLElement>) {
    const o = latest.current;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      o.onTune(
        o.frequency +
          (e.key === "ArrowRight" ? 1 : -1) * o.step * (e.shiftKey ? 10 : 1),
        o.view.start + o.view.span / 2,
      );
    }
    if (e.key === "+" || e.key === "-" || e.key === "=") {
      e.preventDefault();
      o.onView(
        o.view.start + o.view.span / 2,
        Math.max(0, Math.min(o.maxZoom, o.zoom + (e.key === "-" ? -1 : 1))),
      );
    }
  }
  return {
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, true),
    onLostPointerCapture: (e: PointerEvent<HTMLElement>) => end(e, true),
    onKeyDown: key,
  };
}
