const BASE_URL = "https://app.tutivsoft.com";
export const CAIRN_APP_ID = "cairn-vault-linter";

// Keep the live catalog IDs in one public, auditable map. Checkout also
// validates the shape at runtime so a bad catalog edit cannot open checkout.
export type CairnPackKey = "usd_001" | "usd_010";

export const CAIRN_PRICE_IDS: Record<CairnPackKey, string> = {
  usd_001: "pri_01m28hmgj33fkt4epnk2rvzgcw", // $1 -> 100 repair batches
  usd_010: "pri_01m28hmhe4ceh5g46ay287f0vc", // $10 -> 1,000 repair batches
} as const;

export interface BillingSettings {
  constanceDeviceId: string;
  billingEmail: string;
  freeRepairDay: string;
  freeRepairBatchesUsed: number;
  purchasedRepairBatches: number;
}

export interface BillingHost {
  settings: BillingSettings;
  persistBillingSettings(): Promise<void>;
}

export interface BillingHttpResponse {
  status: number;
  json?: {
    data?: {
      credits?: {
        balance?: number | string;
      };
    };
  };
}

export interface BillingRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  throw: false;
}

export type BillingRequester = (request: BillingRequest) => Promise<BillingHttpResponse>;

const defaultRequester: BillingRequester = async (request) => {
  const { requestUrl } = await import("obsidian");
  return requestUrl(request);
};

function showNotice(message: string): void {
  void import("obsidian").then(({ Notice }) => new Notice(message));
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

export async function fetchBalance(deviceId: string, requester: BillingRequester = defaultRequester): Promise<number> {
  const response = await requester({
    url: `${BASE_URL}/api/v1/public/browser/entitlements`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: CAIRN_APP_ID, external_customer_id: deviceId, machine_id: deviceId }),
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`Entitlement sync failed: HTTP ${response.status}`);
  return Math.max(0, Number(response.json?.data?.credits?.balance) || 0);
}

export type SpendResult =
  | { kind: "ok"; balance: number }
  | { kind: "insufficient" }
  | { kind: "error" };

export async function spendConstanceCredits(deviceId: string, amount: number, requester: BillingRequester = defaultRequester): Promise<SpendResult> {
  if (!Number.isInteger(amount) || amount !== 1) return { kind: "error" };
  try {
    const response = await requester({
      url: `${BASE_URL}/api/v1/public/browser/credits/spend`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: CAIRN_APP_ID, external_customer_id: deviceId, machine_id: deviceId, amount, event_id: eventId() }),
      throw: false,
    });
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
    host.settings.purchasedRepairBatches = await fetchBalance(deviceId, requester);
    await host.persistBillingSettings();
  } catch (error) {
    console.warn("Cairn: Constance balance sync failed", error);
  }
}

export async function initializeBilling(host: BillingHost): Promise<void> {
  ensureDeviceId(host);
  resetDailyFreeRepairs(host.settings);
  await host.persistBillingSettings();
  void syncBalance(host);
}

export interface RepairReservation {
  source: "free" | "purchased";
  rollback(): Promise<void>;
}

/** Authorize one approved repair batch. Scans, previews, exports and rollback do not call this. */
export async function reserveRepairBatch(host: BillingHost, requester: BillingRequester = defaultRequester): Promise<RepairReservation | null> {
  ensureDeviceId(host);
  resetDailyFreeRepairs(host.settings);

  if (host.settings.freeRepairBatchesUsed < 3) {
    const previous = host.settings.freeRepairBatchesUsed;
    host.settings.freeRepairBatchesUsed += 1;
    await host.persistBillingSettings();
    return {
      source: "free",
      rollback: async () => {
        host.settings.freeRepairBatchesUsed = previous;
        await host.persistBillingSettings();
      },
    };
  }

  const result = await spendConstanceCredits(host.settings.constanceDeviceId, 1, requester);
  if (result.kind === "ok") {
    host.settings.purchasedRepairBatches = result.balance;
    await host.persistBillingSettings();
    return { source: "purchased", rollback: async () => undefined };
  }
  if (result.kind === "insufficient") {
    host.settings.purchasedRepairBatches = 0;
    await host.persistBillingSettings();
    showNotice("Cairn: today's 3 free repair batches are used. Buy more repair credits in Cairn settings.");
    return null;
  }
  showNotice("Cairn could not verify repair credits. No note changes were made.");
  return null;
}

export function openCheckout(host: BillingHost, pack: CairnPackKey): void {
  const email = host.settings.billingEmail.trim();
  const priceId = CAIRN_PRICE_IDS[pack];
  const deviceId = ensureDeviceId(host);
  if (!email || !email.includes("@")) {
    showNotice("Enter a valid billing email in Cairn settings first.");
    return;
  }
  if (!deviceId) {
    showNotice("Cairn could not create a billing device ID. Try reopening Obsidian.");
    return;
  }
  if (!/^pri_[a-z0-9]+$/i.test(priceId)) {
    showNotice("Cairn billing has an invalid price configuration. No checkout was opened.");
    return;
  }
  const params = new URLSearchParams({ app_id: CAIRN_APP_ID, price_id: priceId, email, external_customer_id: deviceId });
  window.open(`${BASE_URL}/buy?${params.toString()}`, "_blank");
}
