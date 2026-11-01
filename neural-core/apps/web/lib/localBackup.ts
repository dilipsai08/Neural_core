"use client";

import { safeGet, safeSet } from "./config";

/**
 * Kiosk-side backup of name, roll number and score, in case the online
 * database (Neon) is unreachable.
 *
 * - Stored only in this browser, and every entry is deleted 24 hours after it
 *   was saved, like an expiring cookie.
 * - Encrypted with AES-GCM. The key is generated in the browser as a
 *   non-extractable CryptoKey kept in IndexedDB: scripts can use it but can
 *   never read its bytes, and the localStorage value is unreadable without it.
 * - Web Crypto only exists in a secure context (http://localhost or https).
 *   Elsewhere nothing is stored: personal data is never written unencrypted.
 */

const STORAGE_KEY = "nc.backup.v1";
const TTL_MS = 24 * 60 * 60 * 1000;
const IDB_NAME = "nc-backup";
const IDB_STORE = "keys";

export interface BackupEntry {
  playerId: number;
  name: string;
  rollNumber: string;
  runId: number | null;
  score: number | null;
  savedAt: number;
  expiresAt: number;
}

export function backupAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && Boolean(window.crypto?.subtle) && "indexedDB" in window;
}

function openKeyStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getKey(): Promise<CryptoKey> {
  const db = await openKeyStore();
  try {
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get("key");
      req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
      req.onerror = () => reject(req.error);
    });
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(key, "key");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return key;
  } finally {
    db.close();
  }
}

const toB64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function load(): Promise<BackupEntry[]> {
  const raw = safeGet(STORAGE_KEY);
  if (!raw) return [];
  try {
    const { iv, data } = JSON.parse(raw) as { iv: string; data: string };
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await getKey(), fromB64(data));
    return JSON.parse(new TextDecoder().decode(plain)) as BackupEntry[];
  } catch {
    // Unreadable (key cleared or data tampered with): drop it rather than keep junk.
    safeSet(STORAGE_KEY, null);
    return [];
  }
}

async function save(entries: BackupEntry[]): Promise<void> {
  if (entries.length === 0) {
    safeSet(STORAGE_KEY, null);
    return;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getKey(), new TextEncoder().encode(JSON.stringify(entries)));
  safeSet(STORAGE_KEY, JSON.stringify({ iv: toB64(iv), data: toB64(data) }));
}

// Serialise read-modify-write cycles so quick successive saves never clobber each other.
let queue: Promise<unknown> = Promise.resolve();
function update<T>(fn: (entries: BackupEntry[]) => { entries: BackupEntry[]; result: T }): Promise<T | null> {
  if (!backupAvailable()) return Promise.resolve(null);
  const run = queue.then(async () => {
    const now = Date.now();
    const live = (await load()).filter((e) => e.expiresAt > now);
    const { entries, result } = fn(live);
    await save(entries);
    return result;
  });
  queue = run.catch(() => undefined);
  return run.catch((err: unknown) => {
    console.warn("local backup failed", err);
    return null;
  });
}

/** Called at registration: remember who is playing on this kiosk. */
export function backupPlayer(playerId: number, name: string, rollNumber: string): Promise<null | void> {
  return update((entries) => {
    const now = Date.now();
    if (!entries.some((e) => e.playerId === playerId && e.runId === null)) {
      entries.push({ playerId, name, rollNumber, runId: null, score: null, savedAt: now, expiresAt: now + TTL_MS });
    }
    return { entries, result: undefined };
  });
}

/** Called when a shift ends: attach the score (one entry per run). */
export function backupScore(playerId: number, runId: number, score: number): Promise<null | void> {
  return update((entries) => {
    const now = Date.now();
    const known = entries.find((e) => e.playerId === playerId);
    if (!known) return { entries, result: undefined };
    const pending = entries.find((e) => e.playerId === playerId && e.runId === null);
    const existing = entries.find((e) => e.runId === runId);
    const target = existing ?? pending;
    if (target) {
      target.runId = runId;
      target.score = score;
      target.savedAt = now;
      target.expiresAt = now + TTL_MS;
    } else {
      entries.push({ ...known, runId, score, savedAt: now, expiresAt: now + TTL_MS });
    }
    return { entries, result: undefined };
  });
}

/** All entries younger than 24 h; expired ones are deleted as a side effect. */
export async function readBackup(): Promise<BackupEntry[]> {
  return (await update((entries) => ({ entries, result: entries }))) ?? [];
}

export async function clearBackup(): Promise<void> {
  safeSet(STORAGE_KEY, null);
}
