import { visibleBandPlan } from "./bandPlan";
import "./band-plan.css";

/** Visual annotation of the existing slider; clicks/drag/keys use its real tuning path. */
export function BandPlan({ view }: { view: { start: number; span: number } }) {
  return <div className="band-plan" aria-hidden="true" onDoubleClick={(event) => event.stopPropagation()}>
    {visibleBandPlan(view).map((segment) => <i
      key={`${segment.band}-${segment.start}`}
      className={`band-plan-segment band-plan-${segment.usage.replace("/", "-").toLowerCase()}`}
      data-usage={segment.usage}
      data-start={segment.start}
      data-end={segment.end}
      style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
      title={`BAND PLAN · Region 1 · ${segment.band} · ${segment.usage} · ${segment.start}–${segment.end} kHz${segment.usage.includes("SSB") ? " · участок допускает другие виды работы" : ""} · нажмите для настройки`}
    ><b>{segment.usage}</b></i>)}
  </div>;
}
