/**
 * Goal pictures live on this Mac only (§11), never on the backend.
 *
 * - In the Tauri app: files in the app data dir, `goal-pictures/<goalId>`,
 *   through @tauri-apps/plugin-fs (capability scoped to that folder).
 * - In a plain browser (vite without Tauri): IndexedDB.
 * A missing picture (e.g. on a new Mac) shows a placeholder and "Add picture".
 */
import { useEffect, useState } from "react";
import { isTauri } from "../../native/bridge.ts";

export interface PictureStore {
  get(goalId: string): Promise<Blob | null>;
  put(goalId: string, picture: Blob): Promise<void>;
  remove(goalId: string): Promise<void>;
}

export const PICTURE_CHANGED_EVENT = "ft:goal-picture-changed";
const DIR = "goal-pictures";
const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_");

function tauriStore(): PictureStore {
  const fs = () => import("@tauri-apps/plugin-fs");
  return {
    async get(goalId) {
      const { readFile, exists, BaseDirectory } = await fs();
      const path = `${DIR}/${safe(goalId)}`;
      if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) return null;
      return new Blob([await readFile(path, { baseDir: BaseDirectory.AppData })]);
    },
    async put(goalId, picture) {
      const { writeFile, mkdir, exists, BaseDirectory } = await fs();
      if (!(await exists(DIR, { baseDir: BaseDirectory.AppData }))) await mkdir(DIR, { baseDir: BaseDirectory.AppData, recursive: true });
      await writeFile(`${DIR}/${safe(goalId)}`, new Uint8Array(await picture.arrayBuffer()), { baseDir: BaseDirectory.AppData });
    },
    async remove(goalId) {
      const { remove, exists, BaseDirectory } = await fs();
      const path = `${DIR}/${safe(goalId)}`;
      if (await exists(path, { baseDir: BaseDirectory.AppData })) await remove(path, { baseDir: BaseDirectory.AppData });
    },
  };
}

function idbStore(): PictureStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("ft-goal-pictures", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("pictures");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction("pictures", mode).objectStore("pictures"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).finally(() => db.close());
  };
  return {
    get: async (goalId) => ((await tx("readonly", (s) => s.get(goalId))) as Blob | undefined) ?? null,
    put: async (goalId, picture) => void (await tx("readwrite", (s) => s.put(picture, goalId))),
    remove: async (goalId) => void (await tx("readwrite", (s) => s.delete(goalId))),
  };
}

/** No storage at all (e.g. tests without IndexedDB): every picture is missing. */
const noStore: PictureStore = { get: async () => null, put: async () => {}, remove: async () => {} };

let store: PictureStore | null = null;

export function pictureStore(): PictureStore {
  if (!store) store = isTauri() ? tauriStore() : typeof indexedDB !== "undefined" ? idbStore() : noStore;
  return store;
}

/** Tests (or a future cache) can swap the store. */
export function setPictureStore(s: PictureStore | null): void {
  store = s;
}

export async function saveGoalPicture(goalId: string, picture: Blob): Promise<void> {
  await pictureStore().put(goalId, picture);
  window.dispatchEvent(new CustomEvent(PICTURE_CHANGED_EVENT, { detail: goalId }));
}

export async function removeGoalPicture(goalId: string): Promise<void> {
  await pictureStore().remove(goalId);
  window.dispatchEvent(new CustomEvent(PICTURE_CHANGED_EVENT, { detail: goalId }));
}

export type PictureState = { status: "loading" } | { status: "missing" } | { status: "ready"; url: string };

/** The goal's picture as an object URL, updating when it's added or replaced anywhere. */
export function useGoalPicture(goalId: string): PictureState {
  const [state, setState] = useState<PictureState>({ status: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === goalId && setTick((t) => t + 1);
    window.addEventListener(PICTURE_CHANGED_EVENT, on);
    return () => window.removeEventListener(PICTURE_CHANGED_EVENT, on);
  }, [goalId]);
  useEffect(() => {
    let live = true;
    let url: string | null = null;
    pictureStore()
      .get(goalId)
      .then(
        (blob) => {
          if (!live) return;
          if (!blob) return setState({ status: "missing" });
          url = URL.createObjectURL(blob);
          setState({ status: "ready", url });
        },
        () => live && setState({ status: "missing" }),
      );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [goalId, tick]);
  return state;
}
