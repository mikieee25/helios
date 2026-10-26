import { relaunch } from "@tauri-apps/plugin-process";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { useStore } from "@/lib/store";

export async function installUpdate(update: Update, onProgress?: (event: DownloadEvent) => void) {
  await update.download(onProgress);
  await useStore.getState().saveSession().catch(() => {});
  await update.install({ restartAfterInstall: true });
  await relaunch();
}
