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
function RadioArt() {
  return (
    <svg className="radio-art" viewBox="0 0 460 260" aria-hidden="true">
      <defs>
        <linearGradient id="case" x2="1" y2="1">
          <stop stopColor="#244668" />
          <stop offset="1" stopColor="#061225" />
        </linearGradient>
        <linearGradient id="dial">
          <stop stopColor="#b2cfda" />
          <stop offset=".5" stopColor="#edf6ed" />
          <stop offset="1" stopColor="#83aebd" />
        </linearGradient>
      </defs>
      <rect
        x="10"
        y="20"
        width="438"
        height="218"
        rx="18"
        fill="url(#case)"
        stroke="#5385a2"
        strokeWidth="3"
      />
      <rect
        x="28"
        y="38"
        width="403"
        height="178"
        rx="9"
        fill="#0b2036"
        stroke="#325777"
      />
      <rect x="203" y="54" width="207" height="100" rx="5" fill="url(#dial)" />
      {Array.from({ length: 19 }, (_, i) => (
        <path
          key={i}
          d={`M${218 + i * 10} 68v${i % 3 === 0 ? 20 : 10}`}
          stroke="#204762"
        />
      ))}
      <path
        d="M225 133 Q305 55 390 133M307 131 338 78"
        fill="none"
        stroke="#234a66"
        strokeWidth="2"
      />
      <circle
        cx="307"
        cy="177"
        r="35"
        fill="#08182a"
        stroke="#5b8096"
        strokeWidth="4"
      />
      <circle cx="307" cy="177" r="24" fill="#29465c" stroke="#a0bccb" />
      <path d="m307 177 12-17" stroke="#cdf5ff" strokeWidth="3" />
      <rect
        x="46"
        y="56"
        width="132"
        height="63"
        rx="5"
        fill="#112d45"
        stroke="#4c7190"
      />
      <text x="63" y="83" fill="#7bafc5" fontSize="10" letterSpacing="3">
        SHORTWAVE
      </text>
      <text x="61" y="107" fill="#36d4ff" fontSize="21" fontFamily="monospace">
        UR4MTN
      </text>
      {[65, 116, 168, 390].map((x) => (
        <g key={x}>
          <circle
            cx={x}
            cy="177"
            r="18"
            fill="#10263d"
            stroke="#6a91ab"
            strokeWidth="3"
          />
          <path d={`M${x} 177v-12`} stroke="#b5d1df" strokeWidth="2" />
        </g>
      ))}
    </svg>
  );
}
export function Landing({
  listen,
  disabled,
  tune,
}: {
  listen: () => void;
  disabled: boolean;
  tune: (f: number, m: Mode) => void;
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
        <RadioArt />
        <div className="skyline">
          {Array.from({ length: 26 }, (_, i) => (
            <i
              key={i}
              style={{
                height: `${35 + ((i * 37) % 100)}px`,
                width: `${18 + ((i * 7) % 23)}px`,
              }}
            />
          ))}
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
        <p>
          Весь мир на одной волне.
          <br />
          Настройтесь на эфир прямо в браузере.
        </p>
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
      <div className="hero-features">
        {[
          ["◖))", "Реальный звук", "AM / USB / LSB / CW / FM"],
          ["▥", "Spectrum & Waterfall", "Эфир в реальном времени"],
          ["◎", "Публичные KiwiSDR", "Приёмники по всему миру"],
          ["★", "Избранные частоты", "Сохраните свою волну"],
          ["▣", "На любом устройстве", "Телефон, планшет, ПК · PWA"],
        ].map(([icon, title, sub]) => (
          <div key={title}>
            <span aria-hidden="true">{icon}</span>
            <div>
              <strong>{title}</strong>
              <small>{sub}</small>
            </div>
          </div>
        ))}
      </div>
      <div className="hero-bands">
        <span>Популярные диапазоны</span>
        <div>
          {[
            [160, 1.8],
            [80, 3.5],
            [40, 7],
            [30, 10],
            [20, 14],
            [17, 18],
            [15, 21],
            [12, 24],
            [10, 28],
          ].map(([band, mhz]) => (
            <button
              key={band}
              onClick={() => tune(mhz * 1000, band >= 40 ? "LSB" : "USB")}
            >
              <strong>{band}м</strong> <small>({mhz} MHz)</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
