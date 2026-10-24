import { useEffect, useRef } from 'react';
import './about.css';

const features = [
  { icon: 'world', title: 'Приёмники со всего мира', tag: 'SDR SERVER EXPLORER', text: 'Сотни доступных KiwiSDR. Находите приёмники по странам и городам, проверяйте информацию и свободные слоты. Сохраняйте любимые серверы.' },
  { icon: 'spectrum', title: 'Увидеть невидимое', tag: 'FFT · WATERFALL', text: 'Спектральный анализ FFT и динамический водопад превращают настоящий эфир в видимую картину. Обнаруживайте сигналы, меняйте масштаб и настраивайтесь по частоте.' },
  { icon: 'dial', title: 'Частота под контролем', tag: 'VFO · PRECISION TUNING', text: 'Большой виртуальный валкодер, точная цифровая настройка VFO и перестройка кнопками. Выбирайте режим приёма и полосу. Управляйте мышью или касанием.' },
  { icon: 'wave', title: 'Услышать больше', tag: 'DIGITAL SIGNAL PROCESSING', text: 'Noise Reduction (NR), NOTCH-фильтр и регулируемые DSP-фильтры. Эквализация и анализ аудиоспектра помогают исследовать звучание сигнала.' },
  { icon: 'antenna', title: 'В поисках дальних станций', tag: 'DX CLUSTER', text: 'Актуальные DX spots, поиск радиолюбительских станций и фильтрация по диапазонам. Переходите на частоту интересующей станции одним нажатием.' },
  { icon: 'device', title: 'Эфир всегда рядом', tag: 'DESKTOP · TABLET · ANDROID', text: 'Адаптивный интерфейс для компьютера, планшета и смартфона. Работайте прямо в браузере или используйте поддержку PWA.' },
];
const tools = [
  ['CW Decoder', 'Декодирование Морзе', '− · − ·'],
  ['FT8 Pro', 'Анализ сигналов FT8', 'FT8'],
  ['Frequency Scanner', 'Поиск активности', 'SCAN'],
  ['Memory Bank', 'Память ваших частот', 'MEM'],
  ['WAV Recorder', 'Запись радиоэфира', 'REC'],
  ['DSP Lab', 'Анализ сигналов', 'DSP'],
];
function RadioIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    world: <><circle cx="24" cy="24" r="18"/><ellipse cx="24" cy="24" rx="8" ry="18"/><path d="M7 18h34M7 30h34M24 6v36"/></>,
    spectrum: <><path d="M4 36h40M6 30h5l3-10 4 11 5-24 5 24 4-14 4 13h6"/><path d="M6 41h36" opacity=".4"/></>,
    dial: <><circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="11"/><path d="m24 24 7-8M24 3v3M24 42v3M3 24h3M42 24h3"/><circle cx="24" cy="24" r="2"/></>,
    wave: <><path d="M3 24h5c4-25 8 25 12 0S28-1 32 24s8 0 13 0"/><path d="M7 8v32M41 8v32" opacity=".3"/></>,
    antenna: <><path d="m16 43 8-25 8 25M18 36h12M21 27h6M24 18V8M10 6a20 20 0 0 0 0 24M38 6a20 20 0 0 1 0 24M16 11a11 11 0 0 0 0 14M32 11a11 11 0 0 1 0 14"/></>,
    device: <><rect x="4" y="7" width="28" height="23" rx="3"/><path d="M18 30v8M10 38h16"/><rect x="29" y="19" width="15" height="24" rx="3"/><path d="M35 38h3"/></>,
  };
  return <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.antenna}</svg>;
}
function DecorativeScope() {
  const line = Array.from({ length: 321 }, (_, i) => {
    const peak = (center: number, height: number, spread: number) => height * Math.exp(-(((i - center) / spread) ** 2));
    const y = 136 - (Math.sin(i * 1.7) ** 2 * 12 + Math.cos(i * .73) ** 2 * 8 + peak(66, 73, 2) + peak(134, 105, 1.7) + peak(194, 60, 9) + peak(253, 86, 2.4));
    return `${i ? 'L' : 'M'}${i * 3},${y.toFixed(2)}`;
  }).join(' ');
  return <div className="about-scope" aria-hidden="true">
    <div className="about-scope-top"><span><i/> SIGNAL LANDSCAPE</span><span>DEMO / ДЕКОРАТИВНЫЙ СПЕКТР</span></div>
    <svg viewBox="0 0 960 160" preserveAspectRatio="none"><defs><linearGradient id="about-spectrum-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#45f1d7" stopOpacity=".3"/><stop offset="1" stopColor="#45f1d7" stopOpacity="0"/></linearGradient></defs><path d={`${line} L960,160 L0,160Z`} fill="url(#about-spectrum-fill)"/><path className="about-scope-trace" d={line} fill="none" stroke="#6ce8e5" strokeWidth="1.3" vectorEffect="non-scaling-stroke"/></svg>
    <div className="about-scope-ruler"><span>3.5</span><span>7.0</span><span>14.0</span><span>21.0</span><span>28.0 MHz</span></div>
    <div className="about-scope-water"><div/></div>
  </div>;
}
export function About({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.showModal();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add('about-visible');
        observer.unobserve(entry.target);
      }
    }, { root: scroll.current, threshold: .08 });
    scroll.current?.querySelectorAll('[data-about-reveal]').forEach(node => observer.observe(node));
    return () => {
      observer.disconnect();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="about-dialog" aria-labelledby="about-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="about-toolbar"><a href="#about-top" className="about-wordmark" onClick={event => { event.preventDefault(); scroll.current?.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }}><RadioIcon name="antenna"/><span>UR4MTN <b>/</b> WEB SDR</span></a><button type="button" className="about-close" aria-label="Закрыть раздел О проекте" onClick={onClose} autoFocus>×</button></div>
    <div ref={scroll} className="about-scroll">
      <div className="about-content" id="about-top">
        <div className="about-hero">
          <div className="about-kicker"><span/> НЕЗАВИСИМЫЙ РАДИОПРОЕКТ <b>01 / EXPLORE</b></div>
          <h1 id="about-title">UR4MTN <span>WEB SDR</span></h1>
          <p className="about-headline">Мир радио <em>в твоём браузере</em></p>
          <div className="about-hero-bottom"><p>Настоящий эфир. Реальные сигналы.<br/>Современные технологии.</p><a href="#about-intro" className="about-explore">Исследовать возможности <span>↓</span></a></div>
          <DecorativeScope/>
          <div className="about-hero-caption"><span>ОТ ПЕРВОГО СИГНАЛА — К НОВЫМ ОТКРЫТИЯМ</span><span>73 · UR4MTN</span></div>
        </div>
        <section className="about-intro about-block" id="about-intro" data-about-reveal>
          <div><span className="about-kicker">НАСТОЯЩЕЕ РАДИО</span><h2>Открытый мир.<br/><em>Живой эфир.</em></h2></div>
          <div><p>UR4MTN WEB SDR — независимая авторская веб-платформа для приёма и исследования настоящего радиоэфира через удалённые KiwiSDR-приёмники.</p><p>Это не интернет-радиоплеер, а интерактивный SDR-приёмник с реальным управлением частотой, спектром, фильтрами и цифровой обработкой.</p></div>
        </section>
        <section className="about-block" data-about-reveal><div className="about-section-heading"><div><span className="about-kicker">02 / ВОЗМОЖНОСТИ</span><h2>Всё начинается <em>с любопытства.</em></h2></div><span className="about-section-note">НАСТРОЙТЕСЬ. УСЛЫШЬТЕ. ИССЛЕДУЙТЕ.</span></div>
          <div className="about-feature-grid">{features.map((feature, i) => <article className="about-feature" key={feature.tag}><div className="about-feature-top"><RadioIcon name={feature.icon}/><span>0{i + 1}</span></div><span className="about-card-tag">{feature.tag}</span><h3>{feature.title}</h3><p>{feature.text}</p></article>)}</div>
        </section>
        <section className="about-block about-tools" data-about-reveal><div className="about-section-heading"><div><span className="about-kicker">03 / ИНСТРУМЕНТЫ РАДИОЛЮБИТЕЛЯ</span><h2>Глубже <em>в сигнал.</em></h2></div><RadioIcon name="wave"/></div><div className="about-tool-grid">{tools.map(([name, text, mark]) => <article key={name}><span className="about-tool-mark">{mark}</span><div><h3>{name}</h3><p>{text}</p></div></article>)}</div></section>
        <section className="about-block about-tech" data-about-reveal><div><span className="about-kicker">04 / ВНУТРИ ПЛАТФОРМЫ</span><h2>Радиотехника.<br/><em>На языке веба.</em></h2><p>От удалённого приёмника до вашего браузера — современные технологии для работы с настоящими сигналами.</p></div><div><div className="about-signal-path"><span>KiwiSDR</span><i>→</i><span>WebSocket</span><i>→</i><span>Браузер</span></div><div className="about-tech-tags">{['PCM Audio', 'Web Audio API', 'AudioWorklet', 'Canvas FFT', 'Waterfall', 'Современный веб-интерфейс'].map(t => <span key={t}>{t}</span>)}</div><small>Декоративная панорама выше — иллюстрация. Настоящие сигналы поступают только в SDR-приёмник.</small></div></section>
        <section className="about-block about-author" data-about-reveal><div className="about-author-seal"><RadioIcon name="antenna"/><span>UR4MTN</span><small>AMATEUR RADIO</small></div><div><span className="about-kicker">05 / ОБ АВТОРЕ</span><h2>Максим Попков</h2><span className="about-callsign">ПОЗЫВНОЙ · UR4MTN</span><p>Независимый авторский проект, созданный из любви к радио, электронике и технологиям.</p></div></section>
        <div className="about-finale" data-about-reveal><span className="about-kicker">UR4MTN WEB SDR</span><h2>Не просто слушай радио.<br/><em>Исследуй эфир.</em></h2><p>73! До встречи на волнах эфира.</p><button type="button" onClick={() => { onClose(); document.getElementById('listen')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }}>Вернуться к приёмнику <span>↗</span></button><div className="about-footer">INDEPENDENT BY DESIGN <span>СОЗДАНО С ЛЮБОВЬЮ К РАДИО</span></div></div>
      </div>
    </div>
  </dialog>;
}
