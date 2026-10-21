import "./noise-reduction.css";

type Props = {
  enabled: boolean;
  strength: number;
  onEnabledChange: (enabled: boolean) => void;
  onStrengthChange: (strength: number) => void;
};

export function NoiseReduction({ enabled, strength, onEnabledChange, onStrengthChange }: Props) {
  return <div className="nr-widget" onKeyDown={(e) => e.stopPropagation()}>
    <button type="button" aria-label="Шумоподавление NR" aria-pressed={enabled}
      onClick={() => onEnabledChange(!enabled)}>NR {enabled ? "ON" : "OFF"}</button>
    <label className="nr-level">NR · {strength}%
      <input aria-label="Сила NR" type="range" min="0" max="100" step="1" value={strength}
        onChange={(e) => onStrengthChange(Number(e.target.value))} />
    </label>
  </div>;
}
