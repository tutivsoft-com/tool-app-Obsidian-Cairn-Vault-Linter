
async function claimAccountFreeUsage(...args: Parameters<typeof import("./constance-account")["claimAccountFreeUsage"]>): ReturnType<typeof import("./constance-account")["claimAccountFreeUsage"]> {
  const module = await import("./constance-account");
  return module.claimAccountFreeUsage(...args);
}

const BASE_URL = "https://app.tutivsoft.com";
export const CAIRN_APP_ID = "cairn-vault-linter";

export type CairnPackKey = "usd_001" | "usd_010";

// Authenticated checkout uses server-owned catalog plan codes. Paddle price
// IDs remain only for the guarded legacy /buy fallback.
export const CAIRN_PLAN_CODES: Record<CairnPackKey, string> = {
  usd_001: "one_time",
  usd_010: "standard",
} as const;

export const CAIRN_PRICE_IDS: Record<CairnPackKey, string> = {
  usd_001: "pri_01m28hmgj33fkt4epnk2rvzgcw", // $1 -> 100 repair batches
  usd_010: "pri_01m28hmhe4ceh5g46ay287f0vc", // $10 -> 1,000 repair batches
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
  pendingRepairCharges: string[];
  pendingCheckoutKeys: Record<string, string>;
}

export interface BillingHost {
  settings: BillingSettings;
  persistBillingSettings(): Promise<void>;
  pollAfterCheckout?(checkoutId: string): void;
}

export interface BillingHttpResponse {
  status: number;
  json?: {
    data?: {
      credits?: {
        balance?: number | string;
      };
      checkout_url?: string;
      checkout_id?: string | number;
      settled?: boolean;
      checkout_pending?: boolean;
      status?: string;
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
  const { requestUrl } = await import("obsidian");
  return requestUrl(request);
};

function showNotice(message: string): void {
  void import("obsidian").then(({ Notice }) => new Notice(message)).catch(() => undefined);
}

async function requestWithFreshAccessToken(
  host: BillingHost,
  requester: BillingRequester,
  buildRequest: () => BillingRequest,
): Promise<BillingHttpResponse> {
  let response = await requester(buildRequest());
  if ((response.status === 401 || response.status === 403) && host.settings.billingRefreshToken) {
    const { refreshBillingAccessToken } = await import("./constance-account");
    if (await refreshBillingAccessToken(host.settings)) {
      await host.persistBillingSettings();
      response = await requester(buildRequest());
    }
  }
  return response;
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
    settings.freeRepairBatchesUsed = 0;
  }
  const freeUsed = Number(settings.freeRepairBatchesUsed);
  const purchased = Number(settings.purchasedRepairBatches);
  settings.freeRepairBatchesUsed = Number.isFinite(freeUsed) ? Math.max(0, Math.min(3, Math.trunc(freeUsed))) : 0;
  settings.purchasedRepairBatches = Number.isFinite(purchased) ? Math.max(0, Math.trunc(purchased)) : 0;
}

export function hasWritableRepairPlans(plans: readonly { before: string; after: string }[]): boolean {
  return plans.some((plan) => plan.before !== plan.after);
}

function eventId(): string {
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  return `evt_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function fetchBalance(host: BillingHost, requester: BillingRequester = defaultRequester): Promise<number> {
  const deviceId = ensureDeviceId(host);
  if (!host.settings.billingAccessToken || !host.settings.billingAccountLinked) throw new Error("Billing account is not linked");
  const response = await requestWithFreshAccessToken(host, requester, () => ({
    url: `${BASE_URL}/api/v1/billing/entitlements/me?${new URLSearchParams({ app_id: CAIRN_APP_ID, installation_id: deviceId }).toString()}`,
    method: "GET",
    headers: { Authorization: `Bearer ${host.settings.billingAccessToken}` },
    throw: false,
  }));
  if (response.status < 200 || response.status >= 300) throw new Error(`Entitlement sync failed: HTTP ${response.status}`);
  return Math.max(0, Number(response.json?.data?.credits?.balance) || 0);
}

export type SpendResult =
  | { kind: "ok"; balance: number }
  | { kind: "insufficient" }
  | { kind: "error" };

export async function spendConstanceCredits(host: BillingHost, amount: number, requester: BillingRequester = defaultRequester, stableEventId = eventId()): Promise<SpendResult> {
  if (!Number.isInteger(amount) || amount !== 1) return { kind: "error" };
  const deviceId = ensureDeviceId(host);
  if (!host.settings.billingAccessToken || !host.settings.billingAccountLinked) return { kind: "error" };
  try {
    const response = await requestWithFreshAccessToken(host, requester, () => ({
      url: `${BASE_URL}/api/v1/billing/credits/spend`,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.settings.billingAccessToken}` },
      body: JSON.stringify({ app_id: CAIRN_APP_ID, installation_id: deviceId, amount, event_id: stableEventId }),
      throw: false,
    }));
    if (response.status === 402 || response.status === 404) return { kind: "insufficient" };
    if (response.status < 200 || response.status >= 300) return { kind: "error" };
    return { kind: "ok", balance: Math.max(0, Number(response.json?.data?.credits?.balance) || 0) };
  } catch (error) {
    console.warn("Cairn: Constance credit spend failed", error);
    return { kind: "error" };
  }
}

export async function syncBalance(host: BillingHost, requester: BillingRequester = defaultRequester): Promise<void> {
  const deviceId = ensureDeviceId(host);
  try {
    if (!host.settings.billingAccessToken || !host.settings.billingAccountLinked) return;
    host.settings.purchasedRepairBatches = await fetchBalance(host, requester);
    await host.persistBillingSettings();
  } catch (error) {
    console.warn("Cairn: Constance balance sync failed", error);
  }
}

export async function initializeBilling(host: BillingHost): Promise<void> {
  ensureDeviceId(host);
  host.settings.pendingRepairCharges = [...new Set((host.settings.pendingRepairCharges ?? []).filter((id) => typeof id === "string" && id.startsWith("evt_")))];
  host.settings.pendingCheckoutKeys = Object.fromEntries(Object.entries(host.settings.pendingCheckoutKeys ?? {}).filter(([pack, key]) => (pack === "usd_001" || pack === "usd_010") && typeof key === "string" && key.startsWith("checkout_")));
  resetDailyFreeRepairs(host.settings);
  await host.persistBillingSettings();
  void syncBalance(host).then(() => retryPendingRepairCharges(host));
}

export type RepairCommitResult = { kind: "committed" } | { kind: "pending" } | { kind: "insufficient" };

export interface RepairReservation {
  source: "free" | "purchased";
  commit(): Promise<RepairCommitResult>;
  rollback(): Promise<void>;
}

export async function retryPendingRepairCharges(host: BillingHost, requester: BillingRequester = defaultRequester): Promise<void> {
  const pending = [...(host.settings.pendingRepairCharges ?? [])];
  for (const stableEventId of pending) {
    const result = await spendConstanceCredits(host, 1, requester, stableEventId);
    if (result.kind === "error") break;
    host.settings.pendingRepairCharges = host.settings.pendingRepairCharges.filter((id) => id !== stableEventId);
    host.settings.purchasedRepairBatches = result.kind === "insufficient" ? 0 : result.balance;
    await host.persistBillingSettings();
  }
}

/** Authorize one approved repair batch. Scans, previews, exports and rollback do not call this. */
export async function reserveRepairBatch(host: BillingHost, requester: BillingRequester = defaultRequester): Promise<RepairReservation | null> {
  ensureDeviceId(host);
  resetDailyFreeRepairs(host.settings);
  if (!host.settings.billingAccessToken || !host.settings.billingAccountLinked) {
    showNotice("Cairn: sign in or create a billing account in plugin settings before applying repairs.");
    return null;
  }

  if (host.settings.freeRepairBatchesUsed < 3) {
    const accountFree = await claimAccountFreeUsage(host.settings, CAIRN_APP_ID, host.settings.constanceDeviceId, `free_${eventId()}`, 1);
    if (accountFree.kind !== "ok") {
      if (accountFree.kind === "auth-required") { host.settings.billingAccessToken = ""; host.settings.billingRefreshToken = ""; host.settings.billingAccountLinked = false; await host.persistBillingSettings(); }
      showNotice(accountFree.kind === "insufficient" ? "Cairn: today's account free allowance is exhausted." : "Cairn: the account allowance could not be verified.");
      return null;
    }
    host.settings.freeRepairBatchesUsed = Math.max(0, 3 - accountFree.remaining);
    await host.persistBillingSettings();
    return {
      source: "free",
      commit: async () => ({ kind: "committed" }),
      rollback: async () => undefined,
    };
  }

  if (host.settings.purchasedRepairBatches <= 0) await syncBalance(host, requester);
  if (host.settings.purchasedRepairBatches <= 0) {
    host.settings.purchasedRepairBatches = 0;
    await host.persistBillingSettings();
    showNotice("Cairn: today's 3 free repair batches are used. Buy more repair credits in Cairn settings.");
    return null;
  }

  const stableEventId = eventId();
  host.settings.pendingRepairCharges = [...(host.settings.pendingRepairCharges ?? []), stableEventId];
  await host.persistBillingSettings();
  let settled = false;
  return {
    source: "purchased",
    commit: async () => {
      if (settled) return { kind: "committed" };
      const result = await spendConstanceCredits(host, 1, requester, stableEventId);
      if (result.kind === "error") return { kind: "pending" };
      settled = true;
      host.settings.pendingRepairCharges = host.settings.pendingRepairCharges.filter((id) => id !== stableEventId);
      if (result.kind === "insufficient") {
        host.settings.purchasedRepairBatches = 0;
        await host.persistBillingSettings();
        return { kind: "insufficient" };
      }
      host.settings.purchasedRepairBatches = result.balance;
      try {
        await host.persistBillingSettings();
      } catch {
        host.settings.pendingRepairCharges = [...host.settings.pendingRepairCharges, stableEventId];
        return { kind: "pending" };
      }
      return { kind: "committed" };
    },
    rollback: async () => {
      if (settled) return;
      host.settings.pendingRepairCharges = host.settings.pendingRepairCharges.filter((id) => id !== stableEventId);
      await host.persistBillingSettings();
    },
  };
}

export async function pollCheckout(host: BillingHost, checkoutId: string, requester: BillingRequester = defaultRequester): Promise<"pending" | "settled" | "error"> {
  if (!host.settings.billingAccessToken || !host.settings.billingAccountLinked) return "error";
  const response = await requestWithFreshAccessToken(host, requester, () => ({
    url: `${BASE_URL}/api/v1/billing/checkouts/${encodeURIComponent(checkoutId)}`,
    method: "GET",
    headers: { Authorization: `Bearer ${host.settings.billingAccessToken}` },
    throw: false,
  }));
  if (response.status < 200 || response.status >= 300) return "error";
  const data = response.json?.data;
  const status = String(data?.status || "").toLowerCase();
  if (data?.settled === true || ["paid", "completed", "success", "succeeded"].includes(status)) {
    await syncBalance(host, requester);
    return "settled";
  }
  return "pending";
}

export async function openCheckout(host: BillingHost, pack: CairnPackKey, requester: BillingRequester = defaultRequester): Promise<void> {
  if (!host.settings.billingAccessToken || !host.settings.billingAccountLinked) { showNotice("Sign in or create a billing account in Cairn settings before buying credits."); return; }
  const email = host.settings.billingEmail.trim();
  const planCode = CAIRN_PLAN_CODES[pack];
  const priceId = CAIRN_PRICE_IDS[pack];
  const deviceId = ensureDeviceId(host);
  if (!email || !email.includes("@")) {
    showNotice("Enter a valid billing email in Cairn settings first.");
    return;
  }
  if (!deviceId || !planCode) {
    showNotice("Cairn billing has an invalid pack configuration. No checkout was opened.");
    return;
  }

  const pendingCheckoutKeys = host.settings.pendingCheckoutKeys ?? {};
  const idempotencyKey = pendingCheckoutKeys[pack] || `checkout_${eventId()}`;
  host.settings.pendingCheckoutKeys = { ...pendingCheckoutKeys, [pack]: idempotencyKey };
  await host.persistBillingSettings();

  let response: BillingHttpResponse;
  try {
    response = await requestWithFreshAccessToken(host, requester, () => ({
      url: `${BASE_URL}/api/v1/billing/checkout`,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.settings.billingAccessToken}`, "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ app_id: CAIRN_APP_ID, plan_code: planCode, installation_id: deviceId, quantity: 1, coupon_code: null }),
      throw: false,
    }));
  } catch (error) {
    console.warn("Cairn: authenticated checkout request failed", error);
    showNotice("Cairn checkout could not be reached. Try again; the same checkout request will be reused safely.");
    return;
  }

  const checkoutUrl = response.json?.data?.checkout_url;
  if (response.status >= 200 && response.status < 300 && typeof checkoutUrl === "string" && checkoutUrl) {
    window.open(checkoutUrl, "_blank");
    const checkoutId = response.json?.data?.checkout_id;
    if (checkoutId !== undefined && checkoutId !== null) host.pollAfterCheckout?.(String(checkoutId));
    const nextKeys = { ...(host.settings.pendingCheckoutKeys ?? {}) };
    delete nextKeys[pack];
    host.settings.pendingCheckoutKeys = nextKeys;
    await host.persistBillingSettings();
    return;
  }

  // /buy is retained only as the Contract v9 compatibility fallback when an
  // older central does not expose authenticated checkout. It is not used for
  // current checkout errors because it cannot carry the idempotency key.
  if (response.status === 404 || response.status === 405) {
    if (!/^pri_[a-z0-9]+$/i.test(priceId)) {
      showNotice("Cairn billing has no valid legacy fallback price configuration.");
      return;
    }
    const params = new URLSearchParams({ app_id: CAIRN_APP_ID, price_id: priceId, email, external_customer_id: deviceId });
    window.open(`${BASE_URL}/buy?${params.toString()}`, "_blank");
    const nextKeys = { ...(host.settings.pendingCheckoutKeys ?? {}) };
    delete nextKeys[pack];
    host.settings.pendingCheckoutKeys = nextKeys;
    await host.persistBillingSettings();
    return;
  }
  showNotice("Cairn checkout could not be created. Try again; no new checkout was opened.");
}
