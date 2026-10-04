export type Tune = {
  frequency: number;
  mode: string;
  zoom: number;
  lowCut?: number;
  highCut?: number;
  viewCenter?: number;
  agc?: string;
};
export class KiwiProtocol {
  constructor(
    url: string,
    emit: (event: Uint8Array | Record<string, unknown>) => void,
    socketFactory: (url: URL) => unknown,
  );
  start(tune: Tune): void;
  apply(tune: Tune): void;
  close(): void;
}
