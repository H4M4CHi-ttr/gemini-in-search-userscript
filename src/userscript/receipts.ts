import { isQueryJob, type QueryJob } from "../shared/query-models";
import { isUserscriptReply, MAX_JOB_AGE_MS, RECEIPTS_KEY, type UserscriptReply } from "./protocol";

export interface Receipt { jobId: string; sourceTabId: number; createdAt: number; reply?: UserscriptReply }
export function receipts(value: unknown, now = Date.now()): Record<string, Receipt> {
  const result: Record<string, Receipt> = {};
  if (typeof value !== "object" || value === null) return result;
  for (const [id, entry] of Object.entries(value)) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Receipt;
    if (item.jobId !== id || typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt) ||
        now < item.createdAt || now - item.createdAt >= MAX_JOB_AGE_MS || !Number.isInteger(item.sourceTabId) || item.sourceTabId < 1) continue;
    result[id] = { jobId: id, sourceTabId: item.sourceTabId, createdAt: item.createdAt,
      ...(isUserscriptReply(item.reply) && item.reply.jobId === id && item.reply.sourceTabId === item.sourceTabId ? { reply: item.reply } : {}) };
  }
  return result;
}
export function readReceipt(job: QueryJob): Receipt | null {
  const entry = receipts(GM_getValue(RECEIPTS_KEY, null))[job.id];
  return entry && entry.sourceTabId === job.sourceTabId && entry.createdAt === job.createdAt ? entry : null;
}
/** Sole worker writes before touching Gemini; source tabs only read. */
export function writeReceipt(job: QueryJob, reply?: UserscriptReply): void {
  if (!isQueryJob(job)) return;
  const entries = receipts(GM_getValue(RECEIPTS_KEY, null));
  entries[job.id] = { jobId: job.id, sourceTabId: job.sourceTabId, createdAt: job.createdAt, ...(reply ? { reply } : {}) };
  GM_setValue(RECEIPTS_KEY, entries);
}
export function pruneReceipts(): void {
  const stored = GM_getValue<unknown>(RECEIPTS_KEY, null);
  const entries = receipts(stored);
  if (typeof stored === "object" && stored !== null && Object.keys(stored).length !== Object.keys(entries).length) {
    GM_setValue(RECEIPTS_KEY, entries);
  }
}
