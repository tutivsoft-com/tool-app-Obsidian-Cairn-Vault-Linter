import {refreshBillingSession} from "./constance-account";
import {syncEntitlements} from "./constance-v2";
import {openAccountCheckout} from "./billing-checkout";
import {resumeAccountCheckout} from "./billing-checkout";
import { diagnostics } from "./diagnostics.ts";


async function claimAccountFreeUsage(...args: Parameters<typeof import("./constance-account")["claimAccountFreeUsage"]>): ReturnType<typeof import("./constance-account")["claimAccountFreeUsage"]> {
const diagnosticEnd1 = diagnostics?.start?.("billing.claimAccountFreeUsage") ?? (() => {});
try {

  const module = await import("./constance-account");
  return await (module.claimAccountFreeUsage(...args));

} catch (diagnosticError1) { diagnostics?.failure?.("billing.claimAccountFreeUsage", diagnosticError1); throw diagnosticError1; } finally { diagnosticEnd1(); }
}

const BASE_URL = "https://app.tutivsoft.com";
export const CAIRN_APP_ID = "cairn-vault-linter";

export type CairnPackKey = "usd_001" | "usd_010";

// Legacy plan names remain for recovery of previously saved checkout records.
export const CAIRN_PLAN_CODES: Record<CairnPackKey, string> = {
  usd_001: "one_time",
  usd_010: "standard",
} as const;


export interface BillingSettings {
  constanceDeviceId: string;
  billingEmail: string;
  billingAccessToken: string;
  billingRefreshToken: string;
  billingAccountLinked: boolean;
  freeRepairDay: string;
  freeRepairBatchesUsed: number;
  purchasedRepairBatches: number;
  pendingFreeUsageClaims: string[];
  pendingRepairCharges: string[];
  pendingCheckoutKeys: Record<string, string>;
  pendingCheckoutIds?: Record<string, string>;
}

export interface BillingHost {
  settings: BillingSettings;
  persistBillingSettings(): Promise<void>;
  pollAfterCheckout?(checkoutId: string): void;
  refreshBillingSummary?(): void;
}

export interface BillingHttpResponse {
  status: number;
  json?: {
    data?: {
      credits?: {
        balance?: number | string;
        total_available?: number | string;
      };
      free_usage?: { remaining?: number; used?: number; period_key?: string };
      checkout_url?: string;
      checkout_id?: string | number;
      settled?: boolean;
      checkout_pending?: boolean;
      status?: string;
      payment_status?: string;
    };
  };
}

export interface BillingRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  throw: false;
}

export type BillingRequester = (request: BillingRequest) => Promise<BillingHttpResponse>;

const defaultRequester: BillingRequester = async (request) => {
const diagnosticEnd2 = diagnostics?.start?.("billing.defaultRequester") ?? (() => {});
try {

  const { requestUrl } = await import("obsidian");
  return (diagnostics?.request?.("network.billing.request", requestUrl, request) ?? requestUrl(request));

} catch (diagnosticError2) { diagnostics?.failure?.("billing.defaultRequester", diagnosticError2); throw diagnosticError2; } finally { diagnosticEnd2(); }
};

const billingLocks = new WeakMap<object, Promise<unknown>>();

function withBillingLock<T>(host: BillingHost, work: () => Promise<T>): Promise<T> {
  const previous = billingLocks.get(host as object) ?? Promise.resolve();
  const current = previous.catch((error) => { diagnostics.failure("billing.rejected_1", error); return undefined; }).then(work);
  billingLocks.set(host as object, current);
  return current.finally(() => {
    if (billingLocks.get(host as object) === current) billingLocks.delete(host as object);
  });
}

function showNotice(message: string): void {
  void diagnostics.guard("billing.background_1", () => (import("obsidian").then(({ Notice }) => new Notice(message)).catch((rejectedError1) => { diagnostics.failure("billing.rejected_2", rejectedError1); return (undefined); })));
}

async function requestWithFreshAccessToken(
  host: BillingHost,
  requester: BillingRequester,
  buildRequest: () => BillingRequest,
): Promise<BillingHttpResponse> {
const diagnosticEnd3 = diagnostics?.start?.("billing.requestWithFreshAccessToken") ?? (() => {});
try {

  let response = await requester(buildRequest());
  if ((response.status === 401 || response.status === 403) && host.settings.billingRefreshToken) {
    const { refreshBillingAccessToken } = await import("./constance-account");
    if (await refreshBillingAccessToken(host.settings)) {
      await host.persistBillingSettings();
      response = await requester(buildRequest());
    }
  }
  return await (response);

} catch (diagnosticError3) { diagnostics?.failure?.("billing.requestWithFreshAccessToken", diagnosticError3); throw diagnosticError3; } finally { diagnosticEnd3(); }
}

export function localDateKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function generateSecureDeviceId(randomSource: { getRandomValues<T extends ArrayBufferView>(array: T): T } = window.crypto): string {
  const bytes = new Uint8Array(16);
  randomSource.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isValidDeviceId(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value);
}

export function ensureDeviceId(host: BillingHost): string {
  if (!isValidDeviceId(host.settings.constanceDeviceId)) {
    host.settings.constanceDeviceId = generateSecureDeviceId();
    // A cached balance belongs to the previous identity and must not appear
    // available for this newly generated install identity.
    host.settings.purchasedRepairBatches = 0;
  }
  return host.settings.constanceDeviceId;
}

export function resetDailyFreeRepairs(settings: BillingSettings, date = new Date()): void {
  const today = localDateKey(date);
  if (settings.freeRepairDay !== today) {
    settings.freeRepairDay = today;
    // Lifetime allowance is server-owned; a new day grants nothing.
  }
  const freeUsed = Number(settings.freeRepairBatchesUsed);
  const purchased = Number(settings.purchasedRepairBatches);
  settings.freeRepairBatchesUsed = Number.isFinite(freeUsed) ? Math.max(0, Math.min(5, Math.trunc(freeUsed))) : 0;
  settings.purchasedRepairBatches = Number.isFinite(purchased) ? Math.max(0, Math.trunc(purchased)) : 0;
}

export function hasWritableRepairPlans(plans: readonly { before: string; after: string }[]): boolean {
  return plans.some((plan) => plan.before !== plan.after);
}

function eventId(): string {
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  return `v2consume_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function fetchBalance(host: BillingHost, requester: BillingRequester = defaultRequester): Promise<number> {
const diagnosticEnd4 = diagnostics?.start?.("billing.fetchBalance") ?? (() => {});
try {

  const deviceId = ensureDeviceId(host);
  if (!host.settings.billingAccessToken || !host.settings.billingAccountLinked) throw new Error("Billing account is not linked");
  const response = await requestWithFreshAccessToken(host, requester, () => ({
    url: `${BASE_URL}/api/v2/billing/entitlements/me?${new URLSearchParams({ app_id: CAIRN_APP_ID, installation_id: deviceId }).toString()}`,
    method: "GET",
    headers: { Authorization: `Bearer ${host.settings.billingAccessToken}` },
    throw: false,
  }));
  if (response.status < 200 || response.status >= 300) throw new Error(`Your account could not be updated. Check your connection and try again.`);
  const paid = response.json?.data?.credits?.total_available ?? response.json?.data?.credits?.balance;
  if (paid === undefined || paid === null || String(paid).trim() === "" || !Number.isFinite(Number(paid)) || Number(paid) < 0) throw new Error("Your balance could not be updated. Refresh it and try again.");
  if (!response.json?.data?.free_usage) throw new Error("Your balance could not be updated. Refresh it and try again.");
  if (response.json?.data?.free_usage) {
    const remaining = response.json.data.free_usage.remaining;
    if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0) throw new Error("Your balance could not be updated. Refresh it and try again.");
    host.settings.freeRepairDay = localDateKey();
    host.settings.freeRepairBatchesUsed = Math.max(0, 5 - Number(remaining));
  }
  return Number(paid);

} catch (diagnosticError4) { diagnostics?.failure?.("billing.fetchBalance", diagnosticError4); throw diagnosticError4; } finally { diagnosticEnd4(); }
}

export type SpendResult =
  | { kind: "ok"; balance: number }
  | { kind: "insufficient" }
  | { kind: "error" };

export async function spendConstanceCredits(host: BillingHost, amount: number, requester: BillingRequester = defaultRequester, stableEventId = eventId()): Promise<SpendResult> {
const diagnosticEnd5 = diagnostics?.start?.("billing.spendConstanceCredits") ?? (() => {});
try {

  if (!Number.isInteger(amount) || amount !== 1) return { kind: "error" };
  const deviceId = ensureDeviceId(host);
  if (!host.settings.billingAccessToken || !host.settings.billingAccountLinked) return { kind: "error" };
  try {
    const response = await requestWithFreshAccessToken(host, requester, () => ({
      url: `${BASE_URL}/api/v2/billing/credits/spend`,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.settings.billingAccessToken}` },
      body: JSON.stringify({ app_id: CAIRN_APP_ID, installation_id: deviceId, amount, event_id: stableEventId }),
      throw: false,
    }));
    if (response.status === 402 || response.status === 404) return { kind: "insufficient" };
    if (response.status < 200 || response.status >= 300) return { kind: "error" };
    return { kind: "ok", balance: Math.max(0, Number(response.json?.data?.credits?.total_available ?? response.json?.data?.credits?.balance) || 0) };
  } catch (error) {
diagnostics.failure("billing.caught_extra_1", error);
    diagnostics?.legacy?.("warn", "billing.cairn_constance_credit_spend_failed");
    return { kind: "error" };
  }

} catch (diagnosticError5) { diagnostics?.failure?.("billing.spendConstanceCredits", diagnosticError5); throw diagnosticError5; } finally { diagnosticEnd5(); }
}

export async function syncBalance(host: BillingHost, requester: BillingRequester = defaultRequester, strict = false): Promise<void> {
await syncEntitlements(host.settings,()=>host.persistBillingSettings());
(host as any).refreshBillingSummary?.();
}

export async function initializeBilling(host: BillingHost): Promise<void> {
const diagnosticEnd7 = diagnostics?.start?.("billing.initializeBilling") ?? (() => {});
try {

  ensureDeviceId(host);
  host.settings.pendingFreeUsageClaims = [...new Set((host.settings.pendingFreeUsageClaims ?? []).filter((id) => typeof id === "string" && id.startsWith("free_")))];
  host.settings.pendingRepairCharges = [...new Set((host.settings.pendingRepairCharges ?? []).filter((id) => typeof id === "string" && id.startsWith("evt_")))];
  host.settings.pendingCheckoutKeys = Object.fromEntries(Object.entries(host.settings.pendingCheckoutKeys ?? {}).filter(([pack, key]) => /^[a-zA-Z0-9_-]{1,80}$/.test(pack) && typeof key === "string" && key.startsWith("checkout_")));
  resetDailyFreeRepairs(host.settings);
  await host.persistBillingSettings();
  void diagnostics.guard("billing.background_2", () => (syncBalance(host).then(async () => {
const diagnosticEnd8 = diagnostics?.start?.("billing.background.9811") ?? (() => {});
try {

    await retryPendingFreeUsageClaims(host);
    await retryPendingRepairCharges(host);
    for (const id of Object.values(host.settings.pendingCheckoutIds ?? {})) host.pollAfterCheckout?.(id);

} catch (diagnosticError8) { diagnostics?.failure?.("billing.background.9811", diagnosticError8); throw diagnosticError8; } finally { diagnosticEnd8(); }
})));

} catch (diagnosticError7) { diagnostics?.failure?.("billing.initializeBilling", diagnosticError7); throw diagnosticError7; } finally { diagnosticEnd7(); }
}

export type RepairCommitResult = { kind: "committed" } | { kind: "pending" } | { kind: "insufficient" };

export interface RepairReservation {
  source: "free" | "purchased";
  markWriting?(evidence?:import("./native-operations").WriteEvidence[]): Promise<boolean>;
  commit(): Promise<RepairCommitResult>;
  rollback(): Promise<void>;
}

export async function retryPendingFreeUsageClaims(host: BillingHost): Promise<void> {
return;
}

export async function retryPendingRepairCharges(host: BillingHost, requester: BillingRequester = defaultRequester): Promise<void> {
return;
}

/** Authorize one approved repair batch. Scans, previews, exports and rollback do not call this. */
export async function reserveRepairBatch(host: BillingHost, requester: BillingRequester = defaultRequester, source = "", result = "", dimensions = {files:1,edits:1}, stableEventId = `v2native_${globalThis.crypto.randomUUID()}`): Promise<RepairReservation | null> {
const {reserveNative,jobId}=await import("./native-operations");return reserveNative({app:(host as any).app,settings:host.settings as any,persistNative:()=>host.persistBillingSettings()},CAIRN_APP_ID,stableEventId,source,result,dimensions);
}

export async function pollCheckout(host: BillingHost, checkoutId: string, requester: BillingRequester = defaultRequester): Promise<"pending" | "settled" | "failed" | "error"> {
const diagnosticEnd12 = diagnostics?.start?.("billing.pollCheckout") ?? (() => {});
try {

  if (!host.settings.billingAccessToken || !host.settings.billingAccountLinked) return "error";
  const response = await requestWithFreshAccessToken(host, requester, () => ({
    url: `${BASE_URL}/api/v2/billing/checkouts/${encodeURIComponent(checkoutId)}`,
    method: "GET",
    headers: { Authorization: `Bearer ${host.settings.billingAccessToken}` },
    throw: false,
  }));
  if (response.status < 200 || response.status >= 300) return "error";
  const data = response.json?.data;
  const status = String(data?.status || data?.payment_status || "").toLowerCase();
  const settled = data?.settled === true || ["paid", "completed", "success", "succeeded"].includes(status);
  const failed = ["failed", "canceled", "cancelled", "expired", "voided", "rejected"].includes(status);
  if (settled || failed) {
    await syncBalance(host, requester);
    const pendingIds = host.settings.pendingCheckoutIds ?? {};
    const pendingKeys = host.settings.pendingCheckoutKeys ?? {};
    let cleared = false;
    for (const [pack, id] of Object.entries(pendingIds)) {
      if (String(id) !== String(checkoutId)) continue;
      delete pendingIds[pack];
      delete pendingKeys[pack];
      cleared = true;
    }
    if (cleared) await host.persistBillingSettings();
    host.refreshBillingSummary?.();
    return settled ? "settled" : "failed";
  }
  return "pending";

} catch (diagnosticError12) { diagnostics?.failure?.("billing.pollCheckout", diagnosticError12); throw diagnosticError12; } finally { diagnosticEnd12(); }
}

export async function openCheckout(host: BillingHost, pack: CairnPackKey, requester: BillingRequester = defaultRequester, openBrowser = true): Promise<void> {
await openAccountCheckout({state:host.settings,appId:"cairn-vault-linter",installationId:host.settings.constanceDeviceId,persist:()=>host.persistBillingSettings(),syncBalance:async()=>{await syncEntitlements(host.settings,()=>host.persistBillingSettings());(host as any).refreshBillingSummary?.();},refreshSession:()=>refreshBillingSession(host.settings,()=>host.persistBillingSettings())}, typeof pack === "string" && pack.includes("010") ? "onetime-standard" : "onetime");
}

export async function openPriceCheckout(host: BillingHost, priceId: string, requester: BillingRequester = defaultRequester, openBrowser = true): Promise<void> {
await openAccountCheckout({state:host.settings,appId:"cairn-vault-linter",installationId:host.settings.constanceDeviceId,persist:()=>host.persistBillingSettings(),syncBalance:async()=>{await syncEntitlements(host.settings,()=>host.persistBillingSettings());(host as any).refreshBillingSummary?.();},refreshSession:()=>refreshBillingSession(host.settings,()=>host.persistBillingSettings())},priceId);
}
