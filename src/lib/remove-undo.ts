import { useStore, type Task } from "./store";
import { useToast } from "./toast";

/**
 * Removes downloads and, when it is safe, offers an Undo toast.
 *
 * Undo re-adds the original source URIs with `continue=true` into the same
 * folder, so partial data on disk is picked up again. It is only offered when:
 *  - the files were NOT deleted from disk,
 *  - the task was not already completed, and
 *  - aria2 reported source URIs (torrents/magnets without URIs are not restorable).
 */
export async function removeTasks(tasks: Task[], alsoDeleteFiles: boolean) {
  const store = useStore.getState();
  const snapshots = alsoDeleteFiles
    ? []
    : await Promise.all(
        tasks
          .filter((task) => task.state !== "done")
          .map(async (task) => ({
            task,
            uris: await store.taskUris(task.gid).catch(() => [] as string[]),
          }))
      );
  const errors: string[] = [];
  for (const task of tasks) {
    try {
      await store.removeTask(task, alsoDeleteFiles);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const restorable = snapshots.filter((item) => item.uris.length);
  if (restorable.length && errors.length < tasks.length) {
    useToast.getState().show({
      message:
        restorable.length === 1
          ? `Removed “${restorable[0].task.name}”`
          : `Removed ${restorable.length} downloads`,
      actionLabel: "Undo",
      onAction: async () => {
        for (const { task, uris } of restorable)
          await useStore.getState().restoreTask(task, uris);
      },
    });
  }
  if (errors.length) throw new Error(errors.join("\n"));
}
