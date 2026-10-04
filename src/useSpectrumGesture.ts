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
  const points = useRef(new Map<number, number>()),
    gesture = useRef<Gesture | null>(null);
  const position = (g: Gesture, x: number) =>
    g.view.start +
    Math.max(0, Math.min(1, (x - g.left) / g.width)) * g.view.span;
  function down(e: PointerEvent<HTMLElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
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
      const g = gesture.current,
        [a, b] = [...points.current.values()];
      g.pinched = true;
      g.pinch = {
        distance: Math.max(1, Math.abs(b - a)),
        anchor: position(g, (a + b) / 2),
        zoom: latest.current.zoom,
        span: latest.current.view.span,
      };
    }
  }
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
      latest.current.onView(p.anchor - (fraction - 0.5) * span, zoom);
      return;
    }
    if (Math.abs(e.clientX - g.startX) > 5) g.moved = true;
    if (!g.moved) return;
    if (g.mode === "pan")
      latest.current.onView(
        g.view.start +
          g.view.span / 2 -
          ((e.clientX - g.startX) / g.width) * g.view.span,
        g.zoom,
      );
    else
      latest.current.onTune(
        position(g, e.clientX),
        g.view.start + g.view.span / 2,
      );
  }
  function end(e: PointerEvent<HTMLElement>, cancelled = false) {
    const g = gesture.current;
    if (!points.current.has(e.pointerId) || !g) return;
    points.current.delete(e.pointerId);
    if (!points.current.size) {
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
      e.preventDefault();
      const o = latest.current;
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
