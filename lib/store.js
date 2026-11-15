import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function createStore(filePath) {
  let state = { version: 2, predictions: [], trades: [], sessions: {}, lastSnapshotTimestamp: null, lastTradeDate: null, reports: [], researchHistory: [], researchSignals: [], researchOutcomes: [], shadowTrades: [], marketEvents: [], newsItems: [], researchUpdatedAt: null, researchError: null, newsError: null };
  let queue = Promise.resolve();
  async function init() {
    await mkdir(path.dirname(filePath), { recursive: true });
    try { state = { ...state, ...JSON.parse(await readFile(filePath, "utf8")), version: 2 }; }
    catch (error) { if (error.code !== "ENOENT") throw error; await persist(); }
    return snapshot();
  }
  function snapshot() { return structuredClone(state); }
  async function persist() {
    const temp = filePath + ".tmp";
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, filePath);
  }
  function transact(mutator) {
    queue = queue.catch(() => {}).then(async () => { await mutator(state); await persist(); });
    return queue.then(snapshot);
  }
  return { init, snapshot, transact };
}
