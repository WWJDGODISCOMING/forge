// Which bottom sheets are open, so a route change can close them (v0.12.1). Pure, no DOM: ui.js sheet()
// registers each sheet's close() here and js/app.js calls closeAllSheets() on hashchange.

const open = new Set();

/** Track a sheet's close function. Returns a function that forgets it again. */
export function registerSheet(close) {
  open.add(close);
  changed();
  return () => { open.delete(close); changed(); };
}

const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());
/** Call fn whenever a sheet opens or closes (the quick-log + hides while one is up). */
export const onSheetsChange = (fn) => { listeners.add(fn); };

/** Close every open sheet (each close() is idempotent, so a sheet already closing is fine). Returns how many were open. */
export function closeAllSheets() {
  const all = [...open];
  open.clear();
  for (const close of all) close();
  return all.length;
}

export const openSheetCount = () => open.size;
