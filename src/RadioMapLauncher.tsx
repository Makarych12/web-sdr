import { useRef, useState, type ComponentType } from "react";

export function RadioMapLauncher() {
  const [Panel, setPanel] = useState<ComponentType<{ close: () => void }>>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setFailed(false);
          try {
            const module = await import("./RadioMap");
            setPanel(() => module.RadioMap);
            setOpen(true);
          } catch {
            setFailed(true);
          } finally {
            setLoading(false);
          }
        }}
        style={{
          position: "fixed",
          bottom: 18,
          right: 18,
          zIndex: 50,
          border: "1px solid #39dcca",
          borderRadius: 24,
          background: "#081820",
          color: "#9bfff0",
          padding: "11px 18px",
          boxShadow: "0 0 18px #20d4ba25",
          cursor: "pointer",
        }}
      >
        {loading
          ? "Загрузка карты…"
          : failed
            ? "Повторить загрузку карты"
            : "◎ Карта репитеров"}
      </button>
      {open && Panel && (
        <Panel
          close={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </>
  );
}
