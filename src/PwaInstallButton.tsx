import { useState, useEffect, memo } from "react";
import { createPortal } from "react-dom";
import "./pwa-install.css";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export type BrowserType =
  | "duckduckgo_android"
  | "chrome_android"
  | "samsung_internet"
  | "safari_ios"
  | "edge"
  | "firefox_android"
  | "chrome_desktop"
  | "generic_android"
  | "generic";

function checkIsStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function detectBrowser(): BrowserType {
  if (typeof navigator === "undefined") return "generic";
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isIos =
    (/iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
    !("MSStream" in window);

  if (isIos) return "safari_ios";

  // Explicit browser identity takes priority over privacy/GPC heuristics.
  if (/SamsungBrowser/i.test(ua)) return "samsung_internet";

  // DuckDuckGo detection:
  // 1. Explicit token in User-Agent (e.g. DuckDuckGo/5 or ddg_android)
  // 2. Client hints brands array
  // 3. Android WebView with Global Privacy Control enabled (standard in DDG)
  const hasDdgToken = /DuckDuckGo|ddg_android|duckduckgo/i.test(ua);
  const hasDdgBrand = (
    (navigator as unknown as { userAgentData?: { brands?: { brand: string }[] } })
      .userAgentData?.brands || []
  ).some((b) => /DuckDuckGo/i.test(b.brand));
  const isGpc =
    (navigator as unknown as { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true;
  const isWebView =
    /Version\/[0-9.]+\s+(?:Mobile\s+)?(?:Safari\/[0-9.]+\s+)?Chrome|; wv\b/i.test(
      ua,
    );

  if (hasDdgToken || hasDdgBrand || (isAndroid && isGpc)) {
    return isAndroid ? "duckduckgo_android" : "generic";
  }

  if (/EdgA?|Edge/i.test(ua)) {
    return "edge";
  }

  if (/Firefox|FxiOS/i.test(ua)) {
    return isAndroid ? "firefox_android" : "generic";
  }

  // On Android, if it's a generic WebView or not confirmed Chrome, do NOT assume Chrome
  if (isAndroid) {
    if (isWebView) {
      return "generic_android";
    }
    if (/Chrome/i.test(ua)) {
      return "chrome_android";
    }
    return "generic_android";
  }

  if (/Chrome|CriOS/i.test(ua)) {
    return "chrome_desktop";
  }

  return "generic";
}

interface InstructionConfig {
  badge: string;
  title: string;
  note?: string;
  steps: string[];
  supportsPwa: boolean;
}

const INSTRUCTIONS: Record<BrowserType, InstructionConfig> = {
  duckduckgo_android: {
    badge: "DuckDuckGo · Android",
    title: "Установка из DuckDuckGo",
    note: "Браузер DuckDuckGo ориентирован на приватность и не поддерживает прямую установку PWA на рабочий стол Android.",
    supportsPwa: false,
    steps: [
      "В браузере DuckDuckGo в правом нижнем углу нажмите кнопку меню ☰ (или ⋮).",
      "В открывшемся меню нажмите «Поделиться…» (Share) и выберите Google Chrome, чтобы открыть сайт.",
      "В браузере Chrome нажмите кнопку «Установить приложение» для добавления ярлыка на рабочий стол.",
    ],
  },
  chrome_android: {
    badge: "Google Chrome · Android",
    title: "Установка в Google Chrome",
    supportsPwa: true,
    steps: [
      "В правом верхнем углу браузера нажмите меню ⋮ (три точки).",
      "В списке действий выберите «Установить приложение» (или «Добавить на главный экран»).",
      "Подтвердите установку кнопкой «Установить».",
    ],
  },
  samsung_internet: {
    badge: "Samsung Internet · Android",
    title: "Установка через Google Chrome",
    note: "Для установки приложения рекомендуем открыть UR4MTN WEB SDR в Google Chrome",
    supportsPwa: false,
    steps: [
      "Нажмите «Скопировать ссылку» ниже.",
      "Откройте Google Chrome и вставьте ссылку в адресную строку.",
      "В Chrome откройте меню ⋮ и выберите «Установить приложение» или «Добавить на главный экран», если этот пункт доступен.",
      "Если Samsung Internet показывает предупреждение о старой версии Android или блокирует установку, продолжите в Chrome. Обходить предупреждение не нужно.",
    ],
  },
  safari_ios: {
    badge: "iOS / iPadOS · Safari",
    title: "Установка на iPhone / iPad",
    supportsPwa: true,
    steps: [
      "В нижней панели Safari нажмите кнопку «Поделиться» (значок квадрата со стрелкой вверх ⎋).",
      "Прокрутите меню действий вниз и выберите «На экран „Домой“» (Add to Home Screen).",
      "В правом верхнем углу нажмите «Добавить». Приложение появится на домашнем экране.",
    ],
  },
  edge: {
    badge: "Microsoft Edge",
    title: "Установка в Microsoft Edge",
    supportsPwa: true,
    steps: [
      "На телефоне: нажмите меню ⋯ внизу экрана и выберите «Добавить на главный экран».",
      "На компьютере: нажмите значок ⊕ («Установить») в правой части строки адреса.",
      "Подтвердите установку кнопкой «Установить».",
    ],
  },
  chrome_desktop: {
    badge: "Chrome / Chromium · Desktop",
    title: "Установка на компьютер",
    supportsPwa: true,
    steps: [
      "В адресной строке браузера (справа) нажмите значок ⊕ («Установить UR4MTN WEB SDR») или иконку монитора.",
      "Либо откройте меню браузера ⋮ (три точки) → «Сохранить и поделиться» → «Установить страницу как приложение».",
      "Нажмите «Установить». Приложение запустится в отдельном окне без рамок браузера.",
    ],
  },
  firefox_android: {
    badge: "Firefox · Android",
    title: "Установка в Firefox",
    supportsPwa: true,
    steps: [
      "Возле адресной строки нажмите меню ⋮ (три точки).",
      "Выберите пункт «Установить» (или «Добавить на главный экран»).",
      "Подтвердите добавление кнопкой «Добавить».",
    ],
  },
  generic_android: {
    badge: "Android Browser",
    title: "Установка веб-приложения",
    note: "Если ваш браузер не поддерживает установку PWA, откройте сайт в Google Chrome.",
    supportsPwa: true,
    steps: [
      "Откройте меню браузера (кнопка ☰ внизу или ⋮ вверху).",
      "Найдите пункт «Установить приложение», «На главный экран» или «Добавить на главный экран».",
      "Либо нажмите «Поделиться…» и откройте сайт через Google Chrome для полноценной установки.",
    ],
  },
  generic: {
    badge: "Web App (PWA)",
    title: "Установка приложения",
    supportsPwa: true,
    steps: [
      "Откройте меню вашего браузера (⋮, ☰ или ⋯).",
      "Выберите «Установить приложение» или «Добавить на главный экран».",
      "Для полноценной работы PWA рекомендуется использовать Google Chrome, Edge или Safari.",
    ],
  },
};

export const PwaInstallButton = memo(function PwaInstallButton() {
  const [isStandalone, setIsStandalone] = useState(checkIsStandalone);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [modalBrowser, setModalBrowser] = useState<BrowserType | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    setIsStandalone(checkIsStandalone());

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
      setModalBrowser(null);
    };

    const media = window.matchMedia("(display-mode: standalone)");
    const onDisplayModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    media.addEventListener("change", onDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      media.removeEventListener("change", onDisplayModeChange);
    };
  }, []);

  // Handle escape key to close modal
  useEffect(() => {
    if (!modalBrowser) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalBrowser(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalBrowser]);

  if (isStandalone) {
    return null;
  }

  const handleClick = async () => {
    setCopied(false);
    setCopyFailed(false);
    const detected = detectBrowser();
    // Samsung's WebAPK install may be blocked even when it exposes a prompt.
    if (detected === "samsung_internet") {
      setModalBrowser(detected);
      return;
    }
    // 1. If native install prompt is available, trigger it
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
          setDeferredPrompt(null);
          return;
        }
      } catch {
        // Fall back to instructions modal if prompt failed
      }
    }

    // 2. If beforeinstallprompt is unavailable, ALWAYS open the instructional modal
    setModalBrowser(detected);
  };

  const handleShare = async () => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "UR4MTN WEB SDR",
          text: "UR4MTN WEB SDR — Приёмник коротких волн",
          url: window.location.href,
        });
      } catch {
        // User cancelled share dialog
      }
    } else {
      handleCopy();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  const instruction = modalBrowser ? INSTRUCTIONS[modalBrowser] : null;

  const modal =
    modalBrowser && instruction && typeof document !== "undefined"
      ? createPortal(
          <div
            className="pwa-dialog-backdrop"
            onClick={() => setModalBrowser(null)}
            role="presentation"
          >
            <div
              className="pwa-dialog"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="pwa-dialog-title"
            >
              <div className="pwa-dialog-header">
                <div>
                  <span className="pwa-dialog-badge">{instruction.badge}</span>
                  <h3 id="pwa-dialog-title" className="pwa-dialog-title">
                    <svg
                      className="pwa-install-icon"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />
                    </svg>
                    {instruction.title}
                  </h3>
                </div>
                <button
                  type="button"
                  className="pwa-dialog-close"
                  onClick={() => setModalBrowser(null)}
                  aria-label="Закрыть"
                >
                  ×
                </button>
              </div>

              {/* Quick browser switcher tabs */}
              <div className="pwa-browser-tabs" role="tablist" aria-label="Выбор браузера">
                <button
                  type="button"
                  className={
                    "pwa-tab-btn " +
                    (modalBrowser === "duckduckgo_android" ? "active" : "")
                  }
                  onClick={() => setModalBrowser("duckduckgo_android")}
                >
                  DuckDuckGo
                </button>
                <button
                  type="button"
                  className={
                    "pwa-tab-btn " +
                    (modalBrowser === "chrome_android" ||
                    modalBrowser === "chrome_desktop"
                      ? "active"
                      : "")
                  }
                  onClick={() => setModalBrowser("chrome_android")}
                >
                  Chrome
                </button>
                <button
                  type="button"
                  className={
                    "pwa-tab-btn " +
                    (modalBrowser === "safari_ios" ? "active" : "")
                  }
                  onClick={() => setModalBrowser("safari_ios")}
                >
                  Safari
                </button>
                <button
                  type="button"
                  className={
                    "pwa-tab-btn " +
                    (modalBrowser === "generic_android" ||
                    modalBrowser === "generic" ||
                    modalBrowser === "samsung_internet" ||
                    modalBrowser === "edge" ||
                    modalBrowser === "firefox_android"
                      ? "active"
                      : "")
                  }
                  onClick={() => setModalBrowser(detectBrowser() === "samsung_internet" ? "samsung_internet" : "generic_android")}
                >
                  Другие
                </button>
              </div>

              {instruction.note && (
                <div className="pwa-dialog-alert">
                  <span className="pwa-alert-icon" aria-hidden="true">ℹ</span>
                  <span>{instruction.note}</span>
                </div>
              )}

              <ol className="pwa-dialog-steps">
                {instruction.steps.map((step, idx) => (
                  <li key={idx} className="pwa-dialog-step">
                    <span className="pwa-step-num">{idx + 1}</span>
                    <span className="pwa-step-content">{step}</span>
                  </li>
                ))}
              </ol>

              {/* Action buttons for copying or sharing link to Chrome */}
              <div className="pwa-action-row">
                {typeof navigator !== "undefined" &&
                  typeof navigator.share === "function" && (
                    <button
                      type="button"
                      className="pwa-action-btn secondary"
                      onClick={handleShare}
                      title="Поделиться ссылкой с другим браузером"
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="18" cy="5" r="3" />
                        <circle cx="6" cy="12" r="3" />
                        <circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                      Поделиться сайтом
                    </button>
                  )}
                <button
                  type="button"
                  className="pwa-action-btn secondary"
                  onClick={handleCopy}
                  title="Скопировать ссылку для открытия в Chrome"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  <span role="status">{copied ? "✓ Ссылка скопирована!" : "Скопировать ссылку"}</span>
                </button>
              </div>

              {copyFailed && <label className="pwa-copy-fallback">
                <span role="status">Не удалось скопировать автоматически. Нажмите на адрес и скопируйте его вручную.</span>
                <input aria-label="Адрес сайта для копирования" readOnly value={window.location.href} onFocus={event => event.currentTarget.select()} />
              </label>}
              <button
                type="button"
                className="pwa-dialog-btn"
                onClick={() => setModalBrowser(null)}
              >
                Понятно
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        className="pwa-install-btn"
        onClick={handleClick}
        aria-label="Установить приложение UR4MTN WEB SDR"
        title="Установить веб-приложение на устройство"
      >
        <svg
          className="pwa-install-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />
        </svg>
        <span className="pwa-install-text-full">Установить приложение</span>
        <span className="pwa-install-text-short">Установить</span>
      </button>

      {modal}
    </>
  );
});
