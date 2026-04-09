export type LogEntry = {
  id: number;
  time: string;
  category: string;
  message: string;
};

let counter = 0;
const logs: LogEntry[] = [];
const listeners: Set<() => void> = new Set();
let persistCallback: (() => void) | null = null;

export function setPersistCallback(cb: (() => void) | null) {
  persistCallback = cb;
}

export function addLog(category: string, message: string) {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');
  const ms = now.getMilliseconds().toString().padStart(3, '0');
  const entry: LogEntry = { id: ++counter, time: `${h}:${m}:${s}.${ms}`, category, message };
  logs.push(entry);
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  listeners.forEach((cb) => cb());
  if (persistCallback) {
    try { persistCallback(); } catch {}
  }
}

export function getLogs(): LogEntry[] {
  return [...logs];
}

export function clearLogs() {
  logs.length = 0;
  counter = 0;
  listeners.forEach((cb) => cb());
}

export function subscribeToLogs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
