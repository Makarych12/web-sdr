import { useState, useEffect, memo } from "react";
import "./pwa-install.css";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

function checkIsStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    (typeof document !== "undefined" &&
      document.referrer.includes("android-app://"))
  );
}

function checkIsIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    (/iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
    !("MSStream" in window)
  );
}

export const PwaInstallButton = memo(function PwaInstallButton() {
  const [isStandalone, setIsStandalone] = useState(checkIsStandalone);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showModal, setShowModal] = useState<"ios" | "desktop" | null>(null);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    setIsIos(checkIsIos());
    setIsStandalone(checkIsStandalone());

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
      setShowModal(null);
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

  if (isStandalone) {
    return null;
  }

  const handleClick = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
          setDeferredPrompt(null);
        }
      } catch {
        // User dismiss or browser interruption
      }
      return;
    }

    if (isIos) {
      setShowModal("ios");
      return;
    }

    // Desktop or other browser without deferredPrompt
    setShowModal("desktop");
  };

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

      {showModal === "ios" && (
        <div
          className="pwa-dialog-backdrop"
          onClick={() => setShowModal(null)}
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
              <h3 id="pwa-dialog-title" className="pwa-dialog-title">
                <svg
                  className="pwa-install-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />
                </svg>
                Установка на iPhone / iPad
              </h3>
              <button
                type="button"
                className="pwa-dialog-close"
                onClick={() => setShowModal(null)}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            <ol className="pwa-dialog-steps">
              <li className="pwa-dialog-step">
                <span className="pwa-step-num">1</span>
                <span className="pwa-step-content">
                  В нижней панели Safari нажмите кнопку{" "}
                  <strong>«Поделиться»</strong> (значок квадрата со стрелкой вверх{" "}
                  <span aria-hidden="true">⎋</span>).
                </span>
              </li>
              <li className="pwa-dialog-step">
                <span className="pwa-step-num">2</span>
                <span className="pwa-step-content">
                  Прокрутите список действий и выберите{" "}
                  <strong>«На экран „Домой“»</strong> (Add to Home Screen).
                </span>
              </li>
              <li className="pwa-dialog-step">
                <span className="pwa-step-num">3</span>
                <span className="pwa-step-content">
                  В правом верхнем углу нажмите <strong>«Добавить»</strong>.
                  Приложение появится на главном экране.
                </span>
              </li>
            </ol>
            <button
              type="button"
              className="pwa-dialog-btn"
              onClick={() => setShowModal(null)}
            >
              Понятно
            </button>
          </div>
        </div>
      )}

      {showModal === "desktop" && (
        <div
          className="pwa-dialog-backdrop"
          onClick={() => setShowModal(null)}
          role="presentation"
        >
          <div
            className="pwa-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-desktop-title"
          >
            <div className="pwa-dialog-header">
              <h3 id="pwa-desktop-title" className="pwa-dialog-title">
                Установка UR4MTN WEB SDR
              </h3>
              <button
                type="button"
                className="pwa-dialog-close"
                onClick={() => setShowModal(null)}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            <p style={{ margin: "0 0 16px 0", lineHeight: 1.5, fontSize: "14px" }}>
              Для установки приложения нажмите значок{" "}
              <strong>⊕ «Установить»</strong> или иконку монитора в адресной
              строке браузера (справа), либо выберите в меню браузера (⋮) пункт{" "}
              <strong>«Установить приложение UR4MTN WEB SDR»</strong>.
            </p>
            <button
              type="button"
              className="pwa-dialog-btn"
              onClick={() => setShowModal(null)}
            >
              Понятно
            </button>
          </div>
        </div>
      )}
    </>
  );
});
