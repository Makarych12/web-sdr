import { useEffect } from "react";
import { useStoredState } from "./storage";
import "./vintage.css";
export function RadioAppearance() {
  const [theme, setTheme] = useStoredState<"modern" | "vintage">(
    "ur4mtn.appearance.v1",
    "modern",
    (v): v is "modern" | "vintage" => v === "modern" || v === "vintage",
  );
  useEffect(() => {
    document.documentElement.dataset.radioTheme = theme;
  }, [theme]);
  return (
    <div
      className="radio-appearance"
      role="group"
      aria-label="Оформление радио"
    >
      {(["modern", "vintage"] as const).map((t) => (
        <button
          type="button"
          key={t}
          aria-pressed={theme === t}
          onClick={() => setTheme(t)}
        >
          {t.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
