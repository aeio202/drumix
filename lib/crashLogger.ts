import { File, Directory, Paths } from 'expo-file-system';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { addLog, getLogs, setPersistCallback } from './debugLog';

const CRASH_DIR_NAME = 'crash-reports';
const LIVE_SESSION_NAME = 'live-session.log';
const MAX_REPORTS = 20;

let crashDir: Directory | null = null;
let liveFile: File | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let sessionStartedAt = '';

function ensureDirs() {
  if (!crashDir) {
    crashDir = new Directory(Paths.document, CRASH_DIR_NAME);
    if (!crashDir.exists) {
      try { crashDir.create({ intermediates: true, idempotent: true }); } catch {}
    }
  }
  if (!liveFile) {
    liveFile = new File(crashDir, LIVE_SESSION_NAME);
  }
  return { crashDir: crashDir!, liveFile: liveFile! };
}

function fmtTs(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-');
}

function deviceHeader(): string {
  const version = Constants.expoConfig?.version ?? 'unknown';
  return [
    '=== Drumix log ===',
    `Time:    ${new Date().toISOString()}`,
    `Session: ${sessionStartedAt}`,
    `App:     ${version}`,
    `Device:  ${Platform.OS} ${Platform.Version}`,
    `Brand:   ${(Constants as any).deviceName ?? 'unknown'}`,
    '==================',
  ].join('\n');
}

function logsToText(): string {
  return getLogs()
    .map((l) => `${l.time} [${l.category}] ${l.message}`)
    .join('\n');
}

function writeLiveNow() {
  try {
    const { liveFile } = ensureDirs();
    const content = `${deviceHeader()}\n\n--- LOGS (${getLogs().length}) ---\n${logsToText()}\n`;
    if (!liveFile.exists) {
      try { liveFile.create({ overwrite: true }); } catch {}
    }
    liveFile.write(content);
  } catch {
    // ignore — never let logging crash the app
  }
}

function schedulePersist() {
  if (!installed) return;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writeLiveNow();
  }, 800);
}

function flushNow() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  writeLiveNow();
}

function pruneOldReports() {
  try {
    const reports = getCrashReports();
    if (reports.length > MAX_REPORTS) {
      const toDelete = reports.slice(MAX_REPORTS);
      for (const r of toDelete) {
        try { new File(crashDir!, r.name).delete(); } catch {}
      }
    }
  } catch {}
}

function saveReport(prefix: string, error: any, isFatal?: boolean) {
  try {
    const { crashDir } = ensureDirs();
    const file = new File(crashDir, `${prefix}-${fmtTs()}.log`);
    const errMsg = error && error.message ? error.message : String(error);
    const stack = error && error.stack ? error.stack : '(no stack)';
    const content = [
      deviceHeader(),
      '',
      '--- CRASH ---',
      `Type:    ${prefix}`,
      `Fatal:   ${isFatal ? 'YES' : 'no'}`,
      `Message: ${errMsg}`,
      '',
      'Stack:',
      stack,
      '',
      `--- LOGS (${getLogs().length}) ---`,
      logsToText(),
      '',
    ].join('\n');
    if (!file.exists) {
      try { file.create({ overwrite: true }); } catch {}
    }
    file.write(content);
    pruneOldReports();
  } catch {
    // swallow
  }
}

export function installCrashHandler() {
  if (installed) return;
  sessionStartedAt = new Date().toISOString();

  try {
    ensureDirs();
    // Rotate previous live session into a "prev-session" report.
    // If the previous run ended cleanly, the file will only contain logs
    // up to the moment the user closed the app. If it ended via a native
    // crash, OOM kill or force-close, this is the only trace we have.
    if (liveFile && liveFile.exists) {
      try {
        const rotated = new File(crashDir!, `prev-session-${fmtTs()}.log`);
        liveFile.copy(rotated);
      } catch {}
      try { liveFile.delete(); } catch {}
      liveFile = new File(crashDir!, LIVE_SESSION_NAME);
    }
  } catch {}

  installed = true;

  // Wire debug log → disk persistence (debounced)
  setPersistCallback(schedulePersist);

  // Wrap whatever global handler is currently installed (e.g. the
  // 'keep awake' filter from _layout.tsx) so we save crashes too.
  const EU: any = (global as any).ErrorUtils;
  if (EU && typeof EU.setGlobalHandler === 'function') {
    const prev = EU.getGlobalHandler ? EU.getGlobalHandler() : null;
    EU.setGlobalHandler((error: any, isFatal?: boolean) => {
      flushNow();
      saveReport(isFatal ? 'fatal' : 'error', error, isFatal);
      if (prev) {
        try { prev(error, isFatal); } catch {}
      }
    });
  }

  // Unhandled promise rejections (Hermes)
  try {
    const g: any = global as any;
    if (g.HermesInternal && typeof g.HermesInternal.enablePromiseRejectionTracker === 'function') {
      g.HermesInternal.enablePromiseRejectionTracker({
        allRejections: true,
        onUnhandled: (_id: number, rejection: any) => {
          saveReport('rejection', rejection, false);
        },
      });
    }
  } catch {}

  // Flush logs whenever the app loses foreground — gives us the latest
  // state on disk in case the OS kills us in the background.
  try {
    AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        flushNow();
      }
    });
  } catch {}

  addLog('SOCKET', `Crash logger ready · ${Platform.OS} ${Platform.Version} · session ${sessionStartedAt}`);
  // Force a first write so even an immediate native crash leaves something.
  flushNow();
}

export type CrashReport = {
  name: string;
  uri: string;
  size: number;
  modificationTime: number | null;
};

export function getCrashReports(): CrashReport[] {
  try {
    const { crashDir } = ensureDirs();
    const items = crashDir.list();
    const out: CrashReport[] = [];
    for (const item of items) {
      if (item instanceof File && item.name !== LIVE_SESSION_NAME) {
        out.push({
          name: item.name,
          uri: item.uri,
          size: item.size ?? 0,
          modificationTime: item.modificationTime ?? null,
        });
      }
    }
    out.sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
    return out;
  } catch {
    return [];
  }
}

export function readCrashReport(name: string): string {
  try {
    const { crashDir } = ensureDirs();
    const f = new File(crashDir, name);
    return f.exists ? f.textSync() : '(fișier lipsă)';
  } catch (e: any) {
    return `(eroare la citire: ${e?.message ?? e})`;
  }
}

export function deleteCrashReport(name: string) {
  try {
    const { crashDir } = ensureDirs();
    const f = new File(crashDir, name);
    if (f.exists) f.delete();
  } catch {}
}

export function clearCrashReports() {
  try {
    const { crashDir } = ensureDirs();
    for (const item of crashDir.list()) {
      if (item instanceof File && item.name !== LIVE_SESSION_NAME) {
        try { item.delete(); } catch {}
      }
    }
  } catch {}
}

/** Manually force a crash-report style snapshot (useful for "send me logs" flows). */
export function captureSnapshot(reason: string) {
  saveReport('snapshot', new Error(reason), false);
}
