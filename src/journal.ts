import { diagnostics } from "./diagnostics.ts";
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
const diagnosticEnd1 = diagnostics?.start?.("journal.prepareRepairJournal") ?? (() => {});
try {

  const existed = await adapter.exists(path);
  const previous = existed ? await adapter.read(path) : null;
  // Keep a durable copy in case restoring the prior journal fails.
  if (previous !== null) await adapter.write(`${path}.previous`, previous);
  const restore = async () => {
const diagnosticEnd2 = diagnostics?.start?.("journal.restore") ?? (() => {});
try {

    if (previous !== null) await adapter.write(path, previous);
    else if (await adapter.exists(path)) await adapter.remove(path);

} catch (diagnosticError2) { diagnostics?.failure?.("journal.restore", diagnosticError2); throw diagnosticError2; } finally { diagnosticEnd2(); }
};
  try {
    await adapter.write(path, content);
    if (await adapter.read(path) !== content) throw new Error("Repair recovery data could not be verified.");
  } catch (error) {
diagnostics.failure("journal.caught_1", error);
    await restore();
    throw error;
  }
  return await (restore);

} catch (diagnosticError1) { diagnostics?.failure?.("journal.prepareRepairJournal", diagnosticError1); throw diagnosticError1; } finally { diagnosticEnd1(); }
}
