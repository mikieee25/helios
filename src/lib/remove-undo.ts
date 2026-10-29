import { useStore, type Task } from "./store";
import { useToast } from "./toast";

/**
 * Removes downloads and offers Undo while the toast is visible.
 * Completed tasks stay in aria2 until the toast expires so Undo can restore
 * the exact result without re-downloading an existing file.
 */
export async function removeTasks(tasks: Task[], alsoDeleteFiles: boolean) {
  const store = useStore.getState();
  const deferred = alsoDeleteFiles
    ? []
    : tasks.filter((task) => task.state === "done");
  const deferredGids = new Set(deferred.map((task) => task.gid));
  const immediate = tasks.filter((task) => !deferredGids.has(task.gid));
  const snapshots = alsoDeleteFiles
    ? []
    : await Promise.all(
        immediate
          .filter((task) => task.state !== "done")
          .map(async (task) => ({
            task,
            uris: await store.taskUris(task.gid).catch(() => [] as string[]),
          }))
      );
  const errors: string[] = [];
  const removed = new Set<string>();

  if (deferred.length) store.hidePendingRemoval(deferred.map((task) => task.gid));
  for (const task of immediate) {
    try {
      await store.removeTask(task, alsoDeleteFiles);
      removed.add(task.gid);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const restorable = snapshots.filter(
    (item) => item.uris.length && removed.has(item.task.gid)
  );
  if (restorable.length || deferred.length) {
    useToast.getState().show({
      message:
        restorable.length + deferred.length === 1
          ? `Removed “${[...restorable.map((item) => item.task), ...deferred][0].name}”`
          : `Removed ${restorable.length + deferred.length} downloads`,
      actionLabel: "Undo",
      onAction: async () => {
        useStore.getState().restorePendingRemoval(deferred);
        for (const { task, uris } of restorable)
          await useStore.getState().restoreTask(task, uris);
      },
      onExpire: async () => {
        const failed: Task[] = [];
        for (const task of deferred) {
          try {
            await useStore.getState().removeTask(task, false);
          } catch (error) {
            failed.push(task);
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
        if (failed.length) {
          useStore.getState().restorePendingRemoval(failed);
          useToast.getState().show({ message: errors.join("\n") });
        }
      },
    });
  }

  if (errors.length) throw new Error(errors.join("\n"));
}
