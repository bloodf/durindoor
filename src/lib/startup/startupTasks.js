/**
 * Run independent startup tasks without waiting for them or allowing one
 * failure to prevent the remaining tasks from starting.
 *
 * @param {Array<{ name: string, loader: () => Promise<unknown>, run: (loaded: any) => unknown }>} tasks
 */
export function runStartupTasks(tasks) {
  for (const task of tasks) {
    void Promise.resolve()
      .then(() => task.loader())
      .then((loaded) => task.run(loaded))
      .catch((error) => {
        console.warn(`[startup] ${task.name} failed: ${error?.message || error}`);
      });
  }
}
