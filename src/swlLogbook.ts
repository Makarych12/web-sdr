import { MODES, type Mode } from "./radio";
export const LOG_KEY = "ur4mtn.swl-log.v1";
export type SwlEntry = {
  id: string; call: string; frequencyHz: number; mode: Mode;
  utc: string; rst: string; comment: string;
};
export function validEntry(value: unknown): value is SwlEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as SwlEntry;
  return typeof e.id === "string" && e.id.length > 0 && e.id.length <= 100 &&
    typeof e.call === "string" && /^[A-Z0-9/]{2,24}$/.test(e.call) &&
    Number.isInteger(e.frequencyHz) && e.frequencyHz > 0 && e.frequencyHz <= 30000000 &&
    MODES.includes(e.mode) && typeof e.utc === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.utc) &&
    Number.isFinite(Date.parse(e.utc)) && new Date(e.utc).toISOString() === e.utc &&
    typeof e.rst === "string" && /^(?:[1-5][1-9][1-9]?)?$/.test(e.rst) &&
    typeof e.comment === "string" && e.comment.length <= 2000;
}
export function parseLog(text: string | null): SwlEntry[] {
  if (text === null) return [];
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data) || !data.every(validEntry) || new Set(data.map(e => e.id)).size !== data.length)
    throw new Error("Некорректные данные SWL-журнала. Сохранённые данные не изменены.");
  return data;
}
export function saveLog(storage: Pick<Storage, "setItem">, entries: SwlEntry[]) {
  if (!entries.every(validEntry)) throw new Error("Проверьте поля записи");
  storage.setItem(LOG_KEY, JSON.stringify(entries));
}
function xml(value: string) {
  return Array.from(value).filter(c => {
    const n = c.codePointAt(0)!;
    return n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0xD7FF || n >= 0xE000 && n <= 0xFFFD || n >= 0x10000;
  }).join("").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}
/** ADIF 3.1.8 ADX: Unicode comments, explicit SWL, no fictitious sent/received reports.
 * https://adif.org.uk/318/ADIF_318.htm — ADX and application-defined fields.
 */
export function exportAdif(entries: SwlEntry[]) {
  const field = (name: string, value: string) => `<${name}>${xml(value)}</${name}>`;
  const records = entries.map(e => {
    const sideband = e.mode === "USB" || e.mode === "LSB";
    const comment = [e.rst && `SWL observed RST: ${e.rst}`, e.comment].filter(Boolean).join("\n");
    return "<RECORD>" + field("CALL", e.call) + field("FREQ", (e.frequencyHz / 1e6).toFixed(6)) +
      field("MODE", sideband ? "SSB" : e.mode) + (sideband ? field("SUBMODE", e.mode) : "") +
      field("QSO_DATE", e.utc.slice(0, 10).replaceAll("-", "")) +
      field("TIME_ON", e.utc.slice(11, 19).replaceAll(":", "")) + field("SWL", "Y") +
      field("QSO_COMPLETE", "N") +
      (e.rst ? `<APP PROGRAMID="UR4MTN" FIELDNAME="SWL_RST" TYPE="S">${xml(e.rst)}</APP>` : "") +
      (comment ? field("COMMENT_INTL", comment) : "") + "</RECORD>";
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<ADX><HEADER><ADIF_VER>3.1.8</ADIF_VER><PROGRAMID>UR4MTN</PROGRAMID></HEADER>\n<RECORDS>\n' + records.join("\n") + '\n</RECORDS></ADX>\n';
}
export function exportCsv(entries: SwlEntry[]) {
  const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const rows = [["CALL", "FREQ_MHZ", "MODE", "DATE_UTC", "TIME_UTC", "SWL_RST", "COMMENT", "SWL"],
    ...entries.map(e => [e.call, (e.frequencyHz / 1e6).toFixed(6), e.mode, e.utc.slice(0, 10), e.utc.slice(11, 19), e.rst, e.comment, "Y"])];
  return '\uFEFF' + rows.map(row => row.map(quote).join(",")).join("\r\n") + "\r\n";
}
