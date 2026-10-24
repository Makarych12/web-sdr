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

  if (/DuckDuckGo/i.test(ua)) {
    return isAndroid ? "duckduckgo_android" : "generic";
  }

  if (/SamsungBrowser/i.test(ua)) {
    return "samsung_internet";
  }

  if (/EdgA?|Edge/i.test(ua)) {
    return "edge";
  }

  if (/Firefox|FxiOS/i.test(ua)) {
    return isAndroid ? "firefox_android" : "generic";
  }

  if (/Chrome|CriOS/i.test(ua)) {
    return isAndroid ? "chrome_android" : "chrome_desktop";
  }

  if (isAndroid) {
    return "generic_android";
  }

  return "generic";
}

interface InstructionConfig {
  badge: string;
  title: string;
  steps: string[];
}

const INSTRUCTIONS: Record<BrowserType, InstructionConfig> = {
  duckduckgo_android: {
    badge: "DuckDuckGo · Android",
    title: "Установка в DuckDuckGo",
    steps: [
      "В браузере DuckDuckGo нажмите кнопку меню ⋮ (три точки) в правом углу адресной строки.",
      "В открывшемся меню выберите пункт «На главный экран» (Add to Home).",
      "В системном окне Android нажмите «Добавить». Приложение появится на рабочем столе телефона.",
    ],
  },
  chrome_android: {
    badge: "Google Chrome · Android",
    title: "Установка в Google Chrome",
    steps: [
      "Нажмите кнопку меню ⋮ (три точки) в правом верхнем углу браузера.",
      "Выберите пункт «Установить приложение» (или «Добавить на главный экран»).",
      "Подтвердите установку кнопкой «Установить».",
    ],
  },
  samsung_internet: {
    badge: "Samsung Internet",
    title: "Установка в Samsung Internet",
    steps: [
      "Нажмите значок меню ☰ (три полоски) в правом нижнем углу браузера (или ⋮ вверху).",
      "Выберите пункт «Добавить страницу в» → «Главный экран» (или «Установить веб-приложение»).",
      "Нажмите «Добавить» для размещения иконки на главном экране.",
    ],
  },
  safari_ios: {
    badge: "iOS / iPadOS · Safari",
    title: "Установка на iPhone / iPad",
    steps: [
      "В нижней панели Safari нажмите кнопку «Поделиться» (значок квадрата со стрелкой вверх ⎋).",
      "Прокрутите меню действий вниз и выберите «На экран „Домой“» (Add to Home Screen).",
      "В правом верхнем углу нажмите «Добавить». Приложение появится на домашнем экране.",
    ],
  },
  edge: {
    badge: "Microsoft Edge",
    title: "Установка в Microsoft Edge",
    steps: [
      "На телефоне: нажмите меню ⋯ внизу и выберите «Добавить на главный экран».",
      "На компьютере: нажмите значок ⊕ («Установить») в адресной строке или меню ⋯ → «Приложения» → «Установить этот сайт как приложение».",
      "Подтвердите установку кнопкой «Установить».",
    ],
  },
  chrome_desktop: {
    badge: "Chrome / Chromium · Desktop",
    title: "Установка на компьютер",
    steps: [
      "В адресной строке браузера (справа) нажмите значок ⊕ («Установить UR4MTN WEB SDR») или иконку монитора.",
      "Либо откройте меню браузера ⋮ (три точки) → «Сохранить и поделиться» → «Установить страницу как приложение».",
      "Нажмите «Установить». Приложение запустится в отдельном окне без рамок браузера.",
    ],
  },
  firefox_android: {
    badge: "Firefox · Android",
    title: "Установка в Firefox",
    steps: [
      "Нажмите кнопку меню ⋮ (три точки) возле адресной строки браузера.",
      "Выберите пункт «Установить» (или «Добавить на главный экран»).",
      "Подтвердите добавление кнопкой «Добавить».",
    ],
  },
  generic_android: {
    badge: "Android Browser",
    title: "Установка веб-приложения",
    steps: [
      "Откройте главное меню вашего браузера (кнопка ⋮ или ☰).",
      "Выберите пункт «Установить приложение», «На главный экран» или «Добавить на главный экран».",
      "Подтвердите размещение иконки приложения на главном экране телефона.",
    ],
  },
  generic: {
    badge: "Web App (PWA)",
    title: "Установка приложения",
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

    // 2. If beforeinstallprompt is unavailable (DuckDuckGo, Safari, already dismissed, etc.)
    // ALWAYS open the instructional modal for the detected browser
    const detected = detectBrowser();
    setModalBrowser(detected);
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

              <ol className="pwa-dialog-steps">
                {instruction.steps.map((step, idx) => (
                  <li key={idx} className="pwa-dialog-step">
                    <span className="pwa-step-num">{idx + 1}</span>
                    <span className="pwa-step-content">{step}</span>
                  </li>
                ))}
              </ol>

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
