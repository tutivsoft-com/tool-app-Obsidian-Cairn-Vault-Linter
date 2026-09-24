export type Severity = "high" | "medium" | "low" | "info";

export type FindingType =
  | "broken-wikilink"
  | "broken-markdown-link"
  | "broken-embed"
  | "missing-heading"
  | "missing-block-id"
  | "missing-alias"
  | "duplicate-link"
  | "empty-stub"
  | "duplicate-block-id"
  | "duplicate-heading-id"
  | "malformed-link";

export interface RuleSettings {
  [key: string]: boolean;
}

export interface CairnSettings {
  checks: RuleSettings;
  ignoredFolders: string;
  ignoredPatterns: string;
  scanHiddenFiles: boolean;
  scanNonMarkdownFiles: boolean;
  emptyStubMaxCharacters: number;
  emptyStubMaxMeaningfulLines: number;
  reportFolder: string;
  lastScanAt: string;
  lastScanFindingCount: number;
  lastScanHighCount: number;
  lastScanFileCount: number;
  lastScanDurationMs: number;
  lastFileSignatures: Record<string, string>;
  previousFindingCount: number;
  ignoredFindings: IgnoredFinding[];
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
  reviewBeforeApply: boolean;
  defaultReportFormat: "markdown" | "csv" | "json";
}

export interface IgnoredFinding {
  key: string;
  reason: string;
  scope: "finding" | "source" | "folder";
  createdAt: string;
}

export interface VaultFileRecord {
  path: string;
  basename: string;
  extension: string;
  mtime: number;
  size: number;
  content?: string;
}

export interface Finding {
  id: string;
  type: FindingType;
  severity: Severity;
  sourcePath: string;
  line: number;
  section: string;
  context: string;
  target: string;
  explanation: string;
  resolved: boolean;
  ignored?: boolean;
  ignoredReason?: string;
  repair?: RepairProposal;
}

export interface RepairProposal {
  label: string;
  before: string;
  after: string;
  start: number;
  end: number;
}

export interface ScanError {
  path: string;
  message: string;
}

export interface ScanProgress {
  phase: "reading" | "indexing" | "checking" | "complete";
  currentPath: string;
  scanned: number;
  total: number;
  findings: number;
}

export interface ScanResult {
  findings: Finding[];
  errors: ScanError[];
  filesScanned: number;
  durationMs: number;
  cancelled: boolean;
  signatures: Record<string, string>;
}

export interface RepairJournalEntry {
  path: string;
  before: string;
  after: string;
}

export interface RepairJournal {
  batchId: string;
  createdAt: string;
  entries: RepairJournalEntry[];
}

export const DEFAULT_CHECKS: RuleSettings = {
  "broken-wikilink": true,
  "broken-markdown-link": true,
  "broken-embed": true,
  "missing-heading": true,
  "missing-block-id": true,
  "missing-alias": true,
  "duplicate-link": true,
  "empty-stub": true,
  "duplicate-block-id": true,
  "duplicate-heading-id": true,
  "malformed-link": true
};

export const DEFAULT_SETTINGS: CairnSettings = {
  checks: { ...DEFAULT_CHECKS },
  ignoredFolders: ".obsidian\n.trash",
  ignoredPatterns: "Templates/**\nAttachments/**",
  scanHiddenFiles: false,
  scanNonMarkdownFiles: false,
  emptyStubMaxCharacters: 120,
  emptyStubMaxMeaningfulLines: 3,
  reportFolder: "Cairn Reports",
  lastScanAt: "",
  lastScanFindingCount: 0,
  lastScanHighCount: 0,
  lastScanFileCount: 0,
  lastScanDurationMs: 0,
  lastFileSignatures: {},
  previousFindingCount: 0,
  ignoredFindings: [],
  constanceDeviceId: "",
  billingEmail: "",
  billingAccessToken: "",
  billingRefreshToken: "",
  billingAccountLinked: false,
  freeRepairDay: "",
  freeRepairBatchesUsed: 0,
  purchasedRepairBatches: 0,
  pendingFreeUsageClaims: [],
  pendingRepairCharges: [],
  pendingCheckoutKeys: {},
  reviewBeforeApply: false,
  defaultReportFormat: "markdown"
};
