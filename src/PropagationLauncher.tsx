import { lazy, Suspense, useState, type MutableRefObject } from "react";
import type { History } from "./ft8Monitor";
import type { DxFeed } from "./useDxCluster";
import "./propagation.css";
const MapPanel = lazy(() => import("./PropagationMap"));
export function PropagationLauncher({
  feed,
  history,
}: {
  feed: DxFeed;
  history: MutableRefObject<History>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="propagation-launch"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          feed.enable();
          setOpen(true);
        }}
      >
        ◉ DX PROPAGATION MAP
      </button>
      {open && (
        <Suspense fallback={<p role="status">Загрузка карты…</p>}>
          <MapPanel
            feed={feed}
            history={history}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
