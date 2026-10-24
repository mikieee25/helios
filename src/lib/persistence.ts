type Store = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
};

const inTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let storePromise: Promise<Store> | undefined;

function tauriStore() {
  return (storePromise ??= import("@tauri-apps/plugin-store").then(({ load }) =>
    load("helios.json")
  ));
}

export async function readValue<T>(key: string, fallback: T): Promise<T> {
  if (inTauri()) return (await (await tauriStore()).get<T>(key)) ?? fallback;
  const raw = localStorage.getItem(`helios:${key}`);
  return raw === null ? fallback : (JSON.parse(raw) as T);
}

export async function writeValue(key: string, value: unknown) {
  if (inTauri()) return (await tauriStore()).set(key, value);
  localStorage.setItem(`helios:${key}`, JSON.stringify(value));
}
