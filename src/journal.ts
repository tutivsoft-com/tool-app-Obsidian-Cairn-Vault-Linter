/** Prepare a rollback journal before a server-side free-use claim can be spent. */
export interface JournalAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export async function prepareRepairJournal(
  adapter: JournalAdapter,
  path: string,
  content: string,
): Promise<() => Promise<void>> {
  const existed = await adapter.exists(path);
  const previous = existed ? await adapter.read(path) : null;
  // Keep a durable copy in case restoring the prior journal fails.
  if (previous !== null) await adapter.write(`${path}.previous`, previous);
  const restore = async () => {
    if (previous !== null) await adapter.write(path, previous);
    else if (await adapter.exists(path)) await adapter.remove(path);
  };
  try {
    await adapter.write(path, content);
    if (await adapter.read(path) !== content) throw new Error("Repair journal verification failed");
  } catch (error) {
    await restore();
    throw error;
  }
  return restore;
}
