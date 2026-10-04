export type SpectrumView = {
  start: number;
  span: number;
  bandwidth?: number;
  zoom?: number;
};
export function viewFor(
  center: number,
  zoom: number,
  bandwidth: number,
): SpectrumView {
  const span = bandwidth / 2 ** zoom;
  center = Math.max(span / 2, Math.min(bandwidth - span / 2, center));
  return { start: center - span / 2, span, bandwidth, zoom };
}
export function sameView(a: SpectrumView, b: SpectrumView) {
  return (
    Math.abs(a.start - b.start) < 0.00001 &&
    Math.abs(a.span - b.span) < 0.00001 &&
    a.zoom === b.zoom
  );
}
export function matchesRequest(actual: SpectrumView, request: SpectrumView) {
  return (
    actual.zoom === request.zoom &&
    Math.abs(actual.start - request.start) <=
      Math.max(0.01, (actual.bandwidth ?? 32000) / (1024 * 2 ** 14))
  );
}
export function projectView(
  source: SpectrumView,
  target: SpectrumView,
  width: number,
) {
  return {
    x: ((source.start - target.start) / target.span) * width,
    width: (source.span / target.span) * width,
  };
}
export function frequencyLabel(khz: number, span: number) {
  return span < 1000
    ? `${khz.toFixed(3)} kHz`
    : `${(khz / 1000).toFixed(6)} MHz`;
}
