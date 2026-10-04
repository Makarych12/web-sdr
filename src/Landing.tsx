import type { Mode } from "./radio";
export function Antenna() {
  return (
    <svg viewBox="0 0 48 54" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M15 5a20 20 0 0 0 0 30M33 5a20 20 0 0 1 0 30M19 11a12 12 0 0 0 0 18M29 11a12 12 0 0 1 0 18M24 25 13 49h22L24 25Zm-7 16h14" />
      </g>
      <circle cx="24" cy="20" r="5" fill="currentColor" />
    </svg>
  );
}
export function Landing({
  listen,
  disabled,
}: {
  listen: () => void;
  disabled: boolean;
}) {
  return (
    <section id="home" className="landing-hero" aria-label="Главная">
      <div className="hero-scene" aria-hidden="true">
        <div className="globe">
          <svg viewBox="0 0 400 400">
            <defs>
              <radialGradient id="ocean" cx=".3" cy=".25" r=".8">
                <stop stopColor="#13afff" />
                <stop offset=".65" stopColor="#0756bf" />
                <stop offset="1" stopColor="#041c4a" />
              </radialGradient>
              <clipPath id="earth">
                <circle cx="200" cy="200" r="170" />
              </clipPath>
            </defs>
            <circle
              cx="200"
              cy="200"
              r="170"
              fill="url(#ocean)"
              stroke="#55d9ff"
              strokeWidth="2"
            />
            <g
              clipPath="url(#earth)"
              fill="#072e6b"
              stroke="#25b8f0"
              strokeWidth="1"
            >
              <path d="m53 93 54-38 44 13 12 25 49 3 7 21-32 28-8 46-32 11-30-36-21-17-8-32-34-2Zm93 106 52 6 23 34-10 52-24 52-18-7-4-43-26-34Zm100-124 62-13 65 42-12 46-42 18-23-30-41 6-15-31Zm-7 83 51 4 29 32-22 53-25 24-24-20-20-61Zm79 117 45-13 26 28-5 28-44-5Z" />
            </g>
            <g
              clipPath="url(#earth)"
              fill="none"
              stroke="#78dcff"
              strokeOpacity=".38"
            >
              <ellipse cx="200" cy="200" rx="70" ry="170" />
              <ellipse cx="200" cy="200" rx="130" ry="170" />
              <path d="M30 200h340M40 137q160-65 320 0M40 263q160 65 320 0M82 80q118-35 236 0M82 320q118 35 236 0M200 30v340" />
            </g>
            <ellipse
              cx="200"
              cy="200"
              rx="197"
              ry="62"
              transform="rotate(-24 200 200)"
              fill="none"
              stroke="#a6eaff"
              strokeWidth="2"
            />
            <ellipse
              cx="200"
              cy="200"
              rx="190"
              ry="74"
              transform="rotate(52 200 200)"
              fill="none"
              stroke="#68bbff"
            />
            <circle cx="355" cy="123" r="5" fill="#fff" />
          </svg>
        </div>
        <div className="radio-rings">
          <i />
          <i />
          <i />
          <i />
          <span>✦</span>
        </div>
      </div>
      <div className="hero-copy">
        <span className="hero-kicker">РАДИО БЕЗ ГРАНИЦ · 0–30 MHz</span>
        <h1>UR4MTN</h1>
        <div className="hero-subbrand">
          <span />
          WEB SDR
          <span />
        </div>
        <p>Весь мир на одной волне. Настройтесь на эфир прямо в браузере.</p>
        <button
          className="hero-cta"
          aria-label="Открыть приёмник и включить звук"
          disabled={disabled}
          onClick={listen}
        >
          <span className="play-icon">▶</span>
          <span>
            Слушать эфир<small>Публичные KiwiSDR по всему миру</small>
          </span>
          <span aria-hidden="true">↗</span>
        </button>
      </div>
      <a className="qsl-preview" href="#about">
        <img
          src="/ur4mtn-qsl.jpg"
          alt="QSL UR4MTN — оригинал"
          width="800"
          height="533"
        />
        <span>QSL · UR4MTN ↗</span>
      </a>
    </section>
  );
}
export function BandSelector({ tune }: { tune: (f: number, m: Mode) => void }) {
  return (
    <section
      className="band-selector panel"
      aria-label="Любительские диапазоны"
    >
      <span>ДИАПАЗОНЫ</span>
      <div>
        {[
          [160, 1840],
          [80, 3750],
          [40, 7100],
          [30, 10120],
          [20, 14200],
          [17, 18100],
          [15, 21200],
          [12, 24920],
          [10, 28400],
        ].map(([band, f]) => (
          <button
            key={band}
            onClick={() => tune(f, band >= 40 ? "LSB" : "USB")}
          >
            <strong>{band}m</strong>
            <small>{f / 1000} MHz</small>
          </button>
        ))}
      </div>
    </section>
  );
}
