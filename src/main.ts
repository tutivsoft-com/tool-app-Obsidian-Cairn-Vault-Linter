import {
  App,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf
} from "obsidian";
import { applyIgnoredFindings, findingCounts, scanVault, type VaultReader } from "./core";
import { applyTextRepairs, canRollback } from "./repair";
import { initializeBilling, hasWritableRepairPlans, openCheckout, reserveRepairBatch, syncBalance } from "./billing";
import type { CairnSettings, Finding, FindingType, RepairJournal, RepairProposal, ScanError, ScanProgress, ScanResult, Severity } from "./types";
import { DEFAULT_CHECKS, DEFAULT_SETTINGS } from "./types";

export const VIEW_TYPE_CAIRN = "cairn-vault-linter";

const FINDING_LABELS: Record<FindingType, string> = {
  "broken-wikilink": "Broken wikilink",
  "broken-markdown-link": "Broken Markdown link",
  "broken-embed": "Broken embed",
  "missing-heading": "Missing heading",
  "missing-block-id": "Missing block ID",
  "missing-alias": "Missing alias",
  "duplicate-link": "Duplicate link",
  "empty-stub": "Empty note stub",
  "duplicate-block-id": "Duplicate block ID",
  "duplicate-heading-id": "Duplicate heading ID",
  "malformed-link": "Malformed link"
};

const SEVERITY_LABELS: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low", info: "Info" };

function mergeSettings(data: Partial<CairnSettings> | null | undefined): CairnSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...data,
    checks: { ...DEFAULT_CHECKS, ...(data?.checks || {}) },
    lastFileSignatures: data?.lastFileSignatures || {},
    ignoredFindings: data?.ignoredFindings || [],
    pendingRepairCharges: data?.pendingRepairCharges || []
  };
}

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function diffPreview(before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let first = 0;
  while (first < beforeLines.length && first < afterLines.length && beforeLines[first] === afterLines[first]) first++;
  const beforeEnd = Math.min(beforeLines.length, first + 8);
  const afterEnd = Math.min(afterLines.length, first + 8);
  return [
    "Before:",
    ...beforeLines.slice(first, beforeEnd).map((line) => `- ${line}`),
    "After:",
    ...afterLines.slice(first, afterEnd).map((line) => `+ ${line}`)
  ].join("\n");
}

interface RepairPlan {
  path: string;
  before: string;
  after: string;
  proposals: RepairProposal[];
}

export default class CairnVaultLinterPlugin extends Plugin {
  declare settings: CairnSettings;
  lastFindings: Finding[] = [];
  lastErrors: ScanError[] = [];
  lastScan: ScanResult | null = null;
  scanAbort: AbortController | null = null;
  private repairApplying = false;
  private reader!: VaultReader;

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    await initializeBilling(this);
    this.reader = this.createReader();
    this.registerView(VIEW_TYPE_CAIRN, (leaf) => new CairnView(leaf, this));
    this.addRibbonIcon("checkmark", "Open Cairn Vault Linter", () => void this.openDashboard());
    this.addCommand({ id: "scan-full-vault", name: "Cairn: Scan full vault", callback: () => void this.runScan() });
    this.addCommand({ id: "scan-current-note", name: "Cairn: Scan current note", checkCallback: (checking) => this.scanCurrentNote(checking) });
    this.addCommand({ id: "scan-current-folder", name: "Cairn: Scan current folder", checkCallback: (checking) => this.scanCurrentFolder(checking) });
    this.addCommand({ id: "scan-changed-notes", name: "Cairn: Scan changed notes (incremental)", callback: () => void this.runScan(undefined, true) });
    this.addCommand({ id: "cancel-scan", name: "Cairn: Cancel active scan", callback: () => this.cancelScan() });
    this.addCommand({ id: "rollback-last-repair", name: "Cairn: Roll back last repair batch", callback: () => void this.rollbackLastRepair() });
    this.addSettingTab(new CairnSettingTab(this.app, this));
  }

  onunload(): void {
    this.scanAbort?.abort();
  }

  async persistBillingSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  pollAfterCheckout(): void {
    let attempts = 0;
    const intervalId = window.setInterval(() => {
      attempts += 1;
      void syncBalance(this);
      if (attempts >= 8) window.clearInterval(intervalId);
    }, 15000);
    this.registerInterval(intervalId);
  }

  private createReader(): VaultReader {
    const getFiles = () => this.app.vault.getFiles().map((file) => ({ path: file.path, basename: file.basename, extension: file.extension, mtime: file.stat.mtime, size: file.stat.size }));
    return {
      getFiles,
      read: async (record) => {
        const file = this.app.vault.getAbstractFileByPath(record.path);
        if (!(file instanceof TFile)) throw new Error("File is no longer available");
        return this.app.vault.read(file);
      }
    };
  }

  async openDashboard(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CAIRN)[0];
    const leaf = existing || this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_CAIRN, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async refreshDashboard(): Promise<void> {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_CAIRN).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof CairnView) view.render();
    });
  }

  scanCurrentNote(checking: boolean): boolean {
    const file = this.app.workspace.getActiveFile();
    if (checking) return !!file && file.extension.toLowerCase() === "md";
    if (file) void this.runScan([file.path]);
    return true;
  }

  scanCurrentFolder(checking: boolean): boolean {
    const file = this.app.workspace.getActiveFile();
    const folder = file?.parent;
    if (checking) return !!folder;
    if (folder) void this.runScan(this.app.vault.getMarkdownFiles().filter((candidate) => candidate.path === folder.path || candidate.path.startsWith(`${folder.path}/`)).map((candidate) => candidate.path));
    return true;
  }

  async runScan(scopePaths?: string[], incremental = false): Promise<void> {
    if (this.scanAbort) {
      new Notice("Cairn is already scanning. Use Cancel scan to stop it first.");
      return;
    }
    await this.openDashboard();
    this.scanAbort = new AbortController();
    const view = this.getView();
    view?.setProgress({ phase: "indexing", currentPath: "", scanned: 0, total: 0, findings: 0 });
    try {
      const result = await scanVault(this.reader, this.settings, scopePaths, incremental, this.scanAbort.signal, (progress) => view?.setProgress(progress), this.lastFindings);
      if (result.cancelled) {
        new Notice(`Cairn scan cancelled after ${result.filesScanned} file(s).`);
        return;
      }
      this.lastScan = result;
      this.lastErrors = result.errors;
      this.lastFindings = applyIgnoredFindings(result.findings, this.settings.ignoredFindings);
      const counts = findingCounts(this.lastFindings);
      this.settings.previousFindingCount = this.settings.lastScanFindingCount;
      this.settings.lastScanAt = new Date().toISOString();
      this.settings.lastScanFindingCount = counts.total;
      this.settings.lastScanHighCount = counts.high;
      this.settings.lastScanFileCount = result.filesScanned;
      this.settings.lastScanDurationMs = result.durationMs;
      this.settings.lastFileSignatures = result.signatures;
      await this.saveData(this.settings);
      await this.refreshDashboard();
      new Notice(`Cairn found ${counts.total} finding(s) in ${result.filesScanned} file(s).`);
    } catch (error) {
      new Notice(`Cairn scan failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.scanAbort = null;
      view?.setProgress(null);
    }
  }

  cancelScan(): void {
    if (!this.scanAbort) {
      new Notice("No Cairn scan is active.");
      return;
    }
    this.scanAbort.abort();
  }

  getView(): CairnView | undefined {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_CAIRN)[0]?.view;
    return view instanceof CairnView ? view : undefined;
  }

  async ignoreFinding(finding: Finding): Promise<void> {
    new IgnoreModal(this.app, finding, async (reason, scope) => {
      this.settings.ignoredFindings = [...this.settings.ignoredFindings.filter((item) => item.key !== finding.id), { key: scope === "finding" ? finding.id : scope === "source" ? finding.sourcePath : finding.sourcePath.split("/")[0], reason, scope, createdAt: new Date().toISOString() }];
      this.lastFindings = applyIgnoredFindings(this.lastFindings, this.settings.ignoredFindings);
      await this.saveData(this.settings);
      await this.refreshDashboard();
    }).open();
  }

  async reviewRepairs(findings: Finding[]): Promise<void> {
    const candidates = findings.filter((finding) => finding.repair && !finding.ignored);
    if (!candidates.length) {
      new Notice("There are no exact, reviewable repairs in the current results.");
      return;
    }
    const grouped = new Map<string, Finding[]>();
    candidates.forEach((finding) => grouped.set(finding.sourcePath, [...(grouped.get(finding.sourcePath) || []), finding]));
    const plans: RepairPlan[] = [];
    for (const [path, fileFindings] of grouped) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      const before = await this.app.vault.read(file);
      const proposals = fileFindings.map((finding) => finding.repair!);
      const after = applyTextRepairs(before, proposals).after;
      if (after !== before) plans.push({ path, before, after, proposals });
    }
    if (!plans.length) {
      new Notice("Cairn found no note changes to apply. Nothing was charged.");
      return;
    }
    new RepairPreviewModal(this.app, plans, (selected) => void this.applyRepairPlans(selected)).open();
  }

  private async applyRepairPlans(plans: RepairPlan[]): Promise<void> {
    if (this.repairApplying) {
      new Notice("Cairn is already applying a repair batch.");
      return;
    }
    this.repairApplying = true;
    try {
      const readyPlans: RepairPlan[] = [];
      const skipped: string[] = [];
      // Re-read at the write boundary. This prevents stale previews and
      // filters that resolve to no-op text from consuming a repair credit.
      for (const plan of plans) {
        const file = this.app.vault.getAbstractFileByPath(plan.path);
        if (!(file instanceof TFile)) { skipped.push(plan.path); continue; }
        const current = await this.app.vault.read(file);
        if (current !== plan.before || current === plan.after) { skipped.push(plan.path); continue; }
        readyPlans.push(plan);
      }
      if (!hasWritableRepairPlans(readyPlans)) {
        new Notice(`Cairn repair skipped ${skipped.length} file(s); there were no note changes to apply. Nothing was charged.`);
        return;
      }

      const journal: RepairJournal = { batchId: `cairn-${Date.now()}`, createdAt: new Date().toISOString(), entries: readyPlans.map((plan) => ({ path: plan.path, before: plan.before, after: plan.after })) };
      await this.writeJournal(journal);
      const reservation = await reserveRepairBatch(this);
      if (!reservation) return;

      const changed: string[] = [];
      const failed: string[] = [];
      for (const plan of readyPlans) {
        try {
          const file = this.app.vault.getAbstractFileByPath(plan.path);
          if (!(file instanceof TFile)) { skipped.push(plan.path); continue; }
          const current = await this.app.vault.read(file);
          if (current !== plan.before) { skipped.push(plan.path); continue; }
          await this.app.vault.modify(file, plan.after);
          changed.push(plan.path);
        } catch (error) {
          failed.push(`${plan.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!changed.length) {
        await reservation.rollback();
      } else {
        const billingResult = await reservation.commit();
        if (billingResult.kind === "pending") new Notice("Cairn repair applied. Billing is pending and will retry automatically.");
      }
      new Notice(`Cairn repair complete: ${changed.length} changed, ${skipped.length} skipped, ${failed.length} failed. Rollback is available.`);
      await this.refreshDashboard();
    } catch (error) {
      new Notice(`Cairn repair could not be applied: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.repairApplying = false;
    }
  }

  private journalPath(): string {
    return `${this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`}/repair-journal.json`;
  }

  private async writeJournal(journal: RepairJournal): Promise<void> {
    await this.app.vault.adapter.write(this.journalPath(), JSON.stringify(journal));
  }

  async rollbackLastRepair(): Promise<void> {
    try {
      const journal = JSON.parse(await this.app.vault.adapter.read(this.journalPath())) as RepairJournal;
      const rolledBack: string[] = [];
      const skipped: string[] = [];
      for (const entry of journal.entries) {
        const file = this.app.vault.getAbstractFileByPath(entry.path);
        if (!(file instanceof TFile)) { skipped.push(entry.path); continue; }
        const current = await this.app.vault.read(file);
        if (!canRollback(current, entry.after)) { skipped.push(entry.path); continue; }
        await this.app.vault.modify(file, entry.before);
        rolledBack.push(entry.path);
      }
      new Notice(`Cairn rollback: ${rolledBack.length} restored, ${skipped.length} skipped to protect newer edits.`);
      await this.refreshDashboard();
    } catch (error) {
      new Notice(`No recoverable Cairn repair batch was found: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async exportReport(format: "markdown" | "csv" | "json"): Promise<void> {
    if (!this.lastScan) {
      new Notice("Run a scan before exporting a report.");
      return;
    }
    const content = format === "markdown" ? this.markdownReport() : format === "csv" ? this.csvReport() : this.jsonReport();
    new ExportPreviewModal(this.app, format, content, async () => {
      const folder = this.settings.reportFolder.trim().replace(/^\/+|\/+$/g, "") || "Cairn Reports";
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      const extension = format === "markdown" ? "md" : format;
      const path = `${folder}/cairn-report-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
      await this.app.vault.create(path, content);
      new Notice(`Cairn report exported to ${path}.`);
    }).open();
  }

  private markdownReport(): string {
    const counts = findingCounts(this.lastFindings);
    const lines = [`# Cairn Vault Linter report`, ``, `- Scanned: ${this.settings.lastScanAt}`, `- Files scanned: ${this.lastScan?.filesScanned || 0}`, `- Findings: ${counts.total} (${counts.high} high)`, ``];
    const groups = new Map<string, Finding[]>();
    this.lastFindings.forEach((finding) => groups.set(finding.sourcePath, [...(groups.get(finding.sourcePath) || []), finding]));
    groups.forEach((findings, path) => {
      lines.push(`## ${path}`, "");
      findings.forEach((finding) => lines.push(`- **${SEVERITY_LABELS[finding.severity]} · ${FINDING_LABELS[finding.type]}** line ${finding.line}: \`${finding.target}\` — ${finding.explanation}`, `  - Context: ${finding.context || "(none)"}`));
      lines.push("");
    });
    if (this.lastErrors.length) lines.push("## Files that could not be read", "", ...this.lastErrors.map((error) => `- ${error.path}: ${error.message}`));
    return lines.join("\n");
  }

  private csvReport(): string {
    const header = ["id", "type", "severity", "source", "line", "section", "target", "resolved", "ignored", "context", "explanation"];
    return [header, ...this.lastFindings.map((finding) => [finding.id, finding.type, finding.severity, finding.sourcePath, String(finding.line), finding.section, finding.target, String(finding.resolved), String(!!finding.ignored), finding.context, finding.explanation])].map((row) => row.map(escapeCsv).join(",")).join("\n");
  }

  private jsonReport(): string {
    return JSON.stringify({ generatedAt: new Date().toISOString(), summary: { filesScanned: this.lastScan?.filesScanned || 0, ...findingCounts(this.lastFindings) }, findings: this.lastFindings, errors: this.lastErrors }, null, 2);
  }
}

class CairnView extends ItemView {
  private plugin: CairnVaultLinterPlugin;
  private progress: ScanProgress | null = null;
  private typeFilter = "all";
  private severityFilter = "all";
  private folderFilter = "all";
  private stateFilter = "unresolved";

  constructor(leaf: WorkspaceLeaf, plugin: CairnVaultLinterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_CAIRN; }
  getDisplayText(): string { return "Cairn Vault Linter"; }
  getIcon(): string { return "checkmark"; }

  onOpen(): Promise<void> { this.render(); return Promise.resolve(); }
  onClose(): Promise<void> { return Promise.resolve(); }

  setProgress(progress: ScanProgress | null): void {
    this.progress = progress;
    this.render();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("cairn-view");
    const heading = root.createEl("h1", { text: "Cairn Vault Linter" });
    heading.setAttr("tabindex", "-1");
    root.createEl("p", { text: "A local, reviewable health report for links, references, and dangling notes. Scanning never edits vault content." }).addClass("cairn-subtitle");
    const actions = root.createDiv({ cls: "cairn-actions" });
    this.button(actions, "Scan full vault", () => void this.plugin.runScan(), true);
    this.button(actions, "Changed notes", () => void this.plugin.runScan(undefined, true));
    this.button(actions, "Current note", () => this.plugin.scanCurrentNote(false));
    this.button(actions, "Current folder", () => this.plugin.scanCurrentFolder(false));
    this.button(actions, "Cancel", () => this.plugin.cancelScan(), false, !!this.plugin.scanAbort);
    this.button(actions, "Rollback last repair", () => void this.plugin.rollbackLastRepair());
    if (this.progress) {
      const progress = root.createDiv({ cls: "cairn-progress" });
      progress.setAttr("role", "status");
      progress.setAttr("aria-live", "polite");
      progress.createEl("strong", { text: `Scanning ${this.progress.phase}…` });
      progress.createEl("p", { text: `${this.progress.scanned}/${this.progress.total || "?"} files · ${this.progress.findings} findings${this.progress.currentPath ? ` · ${this.progress.currentPath}` : ""}` });
      const bar = progress.createEl("progress");
      bar.max = this.progress.total || 1;
      bar.value = Math.min(this.progress.scanned, bar.max);
      bar.setAttr("aria-label", "Cairn scan progress");
    }
    this.renderSummary(root);
    if (this.plugin.lastFindings.length || this.plugin.lastErrors.length) this.renderResults(root);
    else root.createEl("p", { text: "Run a scan to see grouped findings and safe repair options." }).addClass("cairn-empty");
  }

  private renderSummary(root: HTMLElement): void {
    const counts = findingCounts(this.plugin.lastFindings);
    const grid = root.createDiv({ cls: "cairn-summary", attr: { role: "region", "aria-label": "Scan summary" } });
    const trend = this.plugin.settings.lastScanFindingCount - this.plugin.settings.previousFindingCount;
    this.metric(grid, "Findings", String(counts.total), trend ? `${trend > 0 ? "+" : ""}${trend} since previous scan` : "No previous comparison");
    this.metric(grid, "High severity", String(counts.high), "Needs attention first");
    this.metric(grid, "Files scanned", String(this.plugin.lastScan?.filesScanned || this.plugin.settings.lastScanFileCount || 0), this.plugin.settings.lastScanAt ? new Date(this.plugin.settings.lastScanAt).toLocaleString() : "Not scanned yet");
    this.metric(grid, "Ignored", String(counts.ignored), "Ignored findings remain reviewable");
  }

  private renderResults(root: HTMLElement): void {
    const toolbar = root.createDiv({ cls: "cairn-filters" });
    this.select(toolbar, "Finding type", this.typeFilter, ["all", ...Object.keys(FINDING_LABELS)], (value) => { this.typeFilter = value; this.render(); });
    this.select(toolbar, "Severity", this.severityFilter, ["all", "high", "medium", "low", "info"], (value) => { this.severityFilter = value; this.render(); });
    const folders = [...new Set(this.plugin.lastFindings.map((finding) => finding.sourcePath.split("/").slice(0, -1).join("/") || "/"))].sort();
    this.select(toolbar, "Folder", this.folderFilter, ["all", ...folders], (value) => { this.folderFilter = value; this.render(); });
    this.select(toolbar, "State", this.stateFilter, ["all", "unresolved", "ignored"], (value) => { this.stateFilter = value; this.render(); });
    const exportButton = this.button(toolbar, "Export…", () => new ExportChoiceModal(this.app, (format) => void this.plugin.exportReport(format)).open());
    exportButton.setAttr("aria-label", "Export the current Cairn report");
    this.button(toolbar, "Review safe repairs", () => void this.plugin.reviewRepairs(this.filteredFindings()));
    const findings = this.filteredFindings();
    root.createEl("p", { text: `${findings.length} finding(s) shown${this.plugin.lastErrors.length ? ` · ${this.plugin.lastErrors.length} unreadable file(s)` : ""}` }).addClass("cairn-filter-summary");
    const groups = new Map<string, Finding[]>();
    findings.forEach((finding) => groups.set(finding.sourcePath, [...(groups.get(finding.sourcePath) || []), finding]));
    groups.forEach((group, path) => {
      const details = root.createEl("details", { cls: "cairn-source-group" });
      details.open = true;
      details.createEl("summary", { text: `${path} (${group.length})` });
      group.forEach((finding) => this.renderFinding(details, finding));
    });
    if (this.plugin.lastErrors.length) {
      const errors = root.createEl("details", { cls: "cairn-errors" });
      errors.createEl("summary", { text: `Unreadable or malformed files (${this.plugin.lastErrors.length})` });
      this.plugin.lastErrors.forEach((error) => errors.createEl("p", { text: `${error.path}: ${error.message}` }));
    }
  }

  private filteredFindings(): Finding[] {
    return this.plugin.lastFindings.filter((finding) => (this.typeFilter === "all" || finding.type === this.typeFilter) && (this.severityFilter === "all" || finding.severity === this.severityFilter) && (this.folderFilter === "all" || (finding.sourcePath.split("/").slice(0, -1).join("/") || "/") === this.folderFilter) && (this.stateFilter === "all" || (this.stateFilter === "ignored" ? finding.ignored : !finding.ignored)));
  }

  private renderFinding(parent: HTMLElement, finding: Finding): void {
    const card = parent.createDiv({ cls: `cairn-finding cairn-${finding.severity}` });
    const title = card.createEl("h3", { text: `${FINDING_LABELS[finding.type]} · line ${finding.line}` });
    title.setAttr("tabindex", "0");
    const badge = title.createSpan({ cls: "cairn-badge", text: SEVERITY_LABELS[finding.severity] });
    badge.setAttr("aria-label", `${SEVERITY_LABELS[finding.severity]} severity`);
    card.createEl("p", { text: finding.explanation });
    const meta = card.createEl("p", { cls: "cairn-meta" });
    meta.createEl("code", { text: finding.target || "(no target)" });
    meta.appendText(` · ${finding.section} · ${finding.ignored ? `Ignored: ${finding.ignoredReason}` : finding.resolved ? "Resolved target" : "Unresolved"}`);
    if (finding.context) card.createEl("pre", { text: finding.context }).addClass("cairn-context");
    const buttons = card.createDiv({ cls: "cairn-finding-actions" });
    if (finding.repair && !finding.ignored) this.button(buttons, "Preview exact repair", () => void this.plugin.reviewRepairs([finding]), true);
    this.button(buttons, finding.ignored ? "Keep ignored" : "Ignore…", () => void this.plugin.ignoreFinding(finding));
  }

  private metric(parent: HTMLElement, label: string, value: string, hint: string): void {
    const item = parent.createDiv({ cls: "cairn-metric" });
    item.createEl("span", { text: label }).addClass("cairn-metric-label");
    item.createEl("strong", { text: value });
    item.createEl("small", { text: hint });
  }

  private select(parent: HTMLElement, label: string, value: string, options: string[], onChange: (value: string) => void): void {
    const wrapper = parent.createDiv({ cls: "cairn-filter" });
    const id = `cairn-${label.toLowerCase().replace(/\s+/g, "-")}`;
    const labelEl = wrapper.createEl("label", { text: label, attr: { for: id } });
    labelEl.addClass("cairn-filter-label");
    const select = wrapper.createEl("select", { attr: { id } });
    options.forEach((option) => select.createEl("option", { text: option === "all" ? "All" : FINDING_LABELS[option as FindingType] || SEVERITY_LABELS[option as Severity] || option, value: option }));
    select.value = value;
    select.onchange = () => onChange(select.value);
  }

  private button(parent: HTMLElement, text: string, callback: () => void, primary = false, enabled = true): HTMLButtonElement {
    const button = parent.createEl("button", { text });
    if (primary) button.addClass("mod-cta");
    button.disabled = !enabled;
    button.onclick = callback;
    return button;
  }
}

class IgnoreModal extends Modal {
  constructor(app: App, private finding: Finding, private onSave: (reason: string, scope: "finding" | "source" | "folder") => Promise<void>) { super(app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Ignore finding" });
    contentEl.createEl("p", { text: `${this.finding.sourcePath}:${this.finding.line} · ${this.finding.explanation}` });
    let reason = "";
    new Setting(contentEl).setName("Reason").setDesc("Keep a short local explanation for future reviews.").addText((text) => { text.setPlaceholder("Intentional link, generated note, etc."); text.onChange((value) => reason = value); });
    let scope: "finding" | "source" | "folder" = "finding";
    new Setting(contentEl).setName("Scope").addDropdown((dropdown) => dropdown.addOptions({ finding: "This finding", source: "This source note", folder: "This source folder" }).setValue(scope).onChange((value) => scope = value as typeof scope));
    const actions = contentEl.createDiv({ cls: "cairn-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", { text: "Ignore" });
    save.addClass("mod-cta");
    save.onclick = () => { void this.onSave(reason.trim() || "Ignored by user", scope).then(() => this.close()); };
  }
}

class RepairPreviewModal extends Modal {
  constructor(app: App, private plans: RepairPlan[], private onApply: (plans: RepairPlan[]) => void) { super(app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Review exact repairs" });
    contentEl.createEl("p", { text: `${this.plans.length} file(s) will change. No note is written until you choose Apply repairs. A recovery journal is created first.` });
    const preview = contentEl.createEl("pre", { text: this.plans.map((plan) => `## ${plan.path}\n${diffPreview(plan.before, plan.after)}`).join("\n\n").slice(0, 16000) });
    preview.setAttr("aria-label", "Before and after repair preview");
    preview.style.maxHeight = "420px";
    preview.style.overflow = "auto";
    const actions = contentEl.createDiv({ cls: "cairn-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const apply = actions.createEl("button", { text: "Apply repairs" });
    apply.addClass("mod-cta");
    apply.onclick = () => { this.close(); this.onApply(this.plans); };
  }
}

class ExportChoiceModal extends Modal {
  constructor(app: App, private onChoose: (format: "markdown" | "csv" | "json") => void) { super(app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Export Cairn report" });
    contentEl.createEl("p", { text: "Choose a local format. Cairn will show a preview before creating the report file." });
    (["markdown", "csv", "json"] as const).forEach((format) => { const button = contentEl.createEl("button", { text: format.toUpperCase() }); button.onclick = () => { this.close(); this.onChoose(format); }; });
  }
}

class ExportPreviewModal extends Modal {
  constructor(app: App, private format: string, private report: string, private onApply: () => Promise<void>) { super(app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Preview ${this.format.toUpperCase()} export` });
    contentEl.createEl("p", { text: "This creates a new report note in the configured report folder; it does not change existing notes." });
    const pre = contentEl.createEl("pre", { text: this.report.slice(0, 12000) });
    pre.style.maxHeight = "400px";
    pre.style.overflow = "auto";
    const actions = contentEl.createDiv({ cls: "cairn-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const apply = actions.createEl("button", { text: "Create report" });
    apply.addClass("mod-cta");
    apply.onclick = () => { void this.onApply().then(() => this.close()); };
  }
}

class CairnSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CairnVaultLinterPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Cairn Vault Linter" });
    containerEl.createEl("p", { text: "All checks run locally. Resetting settings does not change vault notes." });
    new Setting(containerEl).setName("Billing").setHeading();
    containerEl.createEl("p", { text: "Scanning, previews, exports, ignores, rollback, and local inspection are always free. Applying one approved repair batch uses one credit only when a note actually changes. You get 3 free repair batches per local calendar day." });
    const billingSummary = containerEl.createEl("p");
    const renderBillingSummary = () => {
      const used = Math.min(3, Math.max(0, this.plugin.settings.freeRepairBatchesUsed));
      billingSummary.setText(`Today: ${used}/3 free repair batches used · Purchased balance: ${Math.max(0, this.plugin.settings.purchasedRepairBatches).toLocaleString()} credits`);
    };
    renderBillingSummary();
    new Setting(containerEl).setName("Billing email").setDesc("Used for the secure TutivSoft checkout receipt.").addText((text) => text.setPlaceholder("you@example.com").setValue(this.plugin.settings.billingEmail).onChange(async (value) => { this.plugin.settings.billingEmail = value.trim(); await this.plugin.persistBillingSettings(); }));
    const buySetting = new Setting(containerEl).setName("Buy repair credits").setDesc("One credit authorizes one approved repair batch. Checkout opens only after the exact Cairn price is provisioned.");
    buySetting.addButton((button) => button.setButtonText("Buy $1 (100 credits)").onClick(() => openCheckout(this.plugin, "usd_001")));
    buySetting.addButton((button) => button.setButtonText("Buy $10 (1,000 credits)").setCta().onClick(() => openCheckout(this.plugin, "usd_010")));
    new Setting(containerEl).setName("Refresh balance").setDesc("Sync purchased repair credits for this install.").addButton((button) => button.setButtonText("Refresh balance").onClick(async () => { button.setDisabled(true); button.setButtonText("Refreshing…"); await syncBalance(this.plugin); renderBillingSummary(); button.setDisabled(false); button.setButtonText("Refresh balance"); }));
    void syncBalance(this.plugin).then(renderBillingSummary);
    containerEl.createEl("h3", { text: "Checks" });
    (Object.keys(DEFAULT_CHECKS) as FindingType[]).forEach((type) => new Setting(containerEl).setName(FINDING_LABELS[type]).addToggle((toggle) => toggle.setValue(this.plugin.settings.checks[type]).onChange(async (value) => { this.plugin.settings.checks[type] = value; await this.plugin.saveData(this.plugin.settings); })));
    new Setting(containerEl).setName("Ignored folders").setDesc("One vault-relative folder per line.").addTextArea((text) => text.setValue(this.plugin.settings.ignoredFolders).onChange(async (value) => { this.plugin.settings.ignoredFolders = value; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(containerEl).setName("Ignored file patterns").setDesc("Simple * wildcards, one pattern per line.").addTextArea((text) => text.setValue(this.plugin.settings.ignoredPatterns).onChange(async (value) => { this.plugin.settings.ignoredPatterns = value; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(containerEl).setName("Scan hidden files").addToggle((toggle) => toggle.setValue(this.plugin.settings.scanHiddenFiles).onChange(async (value) => { this.plugin.settings.scanHiddenFiles = value; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(containerEl).setName("Scan non-Markdown files").setDesc("Include local attachments in broken-embed checks; note contents remain Markdown-only.").addToggle((toggle) => toggle.setValue(this.plugin.settings.scanNonMarkdownFiles).onChange(async (value) => { this.plugin.settings.scanNonMarkdownFiles = value; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(containerEl).setName("Nearly empty maximum characters").addText((text) => text.setValue(String(this.plugin.settings.emptyStubMaxCharacters)).onChange(async (value) => { const number = Number(value); if (Number.isFinite(number) && number >= 0) { this.plugin.settings.emptyStubMaxCharacters = number; await this.plugin.saveData(this.plugin.settings); } }));
    new Setting(containerEl).setName("Nearly empty maximum meaningful lines").addText((text) => text.setValue(String(this.plugin.settings.emptyStubMaxMeaningfulLines)).onChange(async (value) => { const number = Number(value); if (Number.isFinite(number) && number >= 0) { this.plugin.settings.emptyStubMaxMeaningfulLines = number; await this.plugin.saveData(this.plugin.settings); } }));
    new Setting(containerEl).setName("Report folder").setDesc("Vault-relative folder for exported reports.").addText((text) => text.setValue(this.plugin.settings.reportFolder).onChange(async (value) => { this.plugin.settings.reportFolder = value; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(containerEl).setName("Reset Cairn settings").setDesc("Restore default checks and folders; ignored findings are also cleared. Billing identity and balance settings are preserved.").addButton((button) => button.setButtonText("Reset").onClick(async () => { const billing = { constanceDeviceId: this.plugin.settings.constanceDeviceId, billingEmail: this.plugin.settings.billingEmail, freeRepairDay: this.plugin.settings.freeRepairDay, freeRepairBatchesUsed: this.plugin.settings.freeRepairBatchesUsed, purchasedRepairBatches: this.plugin.settings.purchasedRepairBatches, pendingRepairCharges: this.plugin.settings.pendingRepairCharges }; this.plugin.settings = { ...mergeSettings(null), ...billing }; await this.plugin.saveData(this.plugin.settings); this.display(); new Notice("Cairn settings reset."); }));
  }
}
