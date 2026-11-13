import { initializeMatomo } from "./matomo-plugin";
import { selectedFiles, markdownFile, registerSelectionAction } from "./selection-scope";
import { diagnostics } from "./diagnostics.ts";
import { reserveNative, nativeCost, renderNativePacks, jobId, digest, recoverNative, type NativeReservation } from "./native-operations";
import {
  App,
  ItemView,
  Menu,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf
} from "obsidian";
import { applyIgnoredFindings, findingCounts, ignoreRuleMatches, scanSettingsKey, scanVault, sourceFolder, type VaultReader } from "./core";
import { applyTextRepairs, canRollback } from "./repair";
import { prepareRepairJournal } from "./journal";
import { initializeBilling, hasWritableRepairPlans, pollCheckout, reserveRepairBatch, syncBalance } from "./billing";
import { addBillingAccountSettings } from "./constance-account";
import type { CairnSettings, Finding, FindingType, RepairJournal, RepairProposal, ScanError, ScanProgress, ScanResult, Severity } from "./types";
import { DEFAULT_CHECKS, DEFAULT_SETTINGS } from "./types";
import { PluginSupport } from "./plugin-support";
import { registerSidebarIcon } from "./sidebar-icon";

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
    settingsMode: data?.settingsMode === "advanced" ? "advanced" : "simple",
    defaultReportFormat: data?.defaultReportFormat === "csv" || data?.defaultReportFormat === "json" ? data.defaultReportFormat : "markdown",
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
  support!: PluginSupport;
  declare settings: CairnSettings;
  billingSummaryRefresh?: () => void;
  lastFindings: Finding[] = [];
  lastErrors: ScanError[] = [];
  lastScan: ScanResult | null = null;
  scanAbort: AbortController | null = null;
  reportNeedsScan = false;
  comparisonDelta: number | null = null;
  private sourceFiles = new Map<string, TFile>();
  private lastNote: TFile | null = null;
  private repairApplying = false;
  nativeWriting = false;
  private scannedSources=new Map<string,string>();
  private scanPreview?: {id:string;result:ScanResult;findings:Finding[];revealed:boolean;authorization?:NativeReservation};
  private repairAuthorizations=new WeakMap<RepairPlan[],NativeReservation>();
  async revealReport(): Promise<boolean> {
const diagnosticEnd1 = diagnostics?.start?.("main.revealReport") ?? (() => {});
try {

    const preview=this.scanPreview;if(!preview)return false;
    preview.revealed=true;
    this.lastFindings=preview.findings;await this.refreshDashboard();return true;

} catch (diagnosticError1) { diagnostics?.failure?.("main.revealReport", diagnosticError1); throw diagnosticError1; } finally { diagnosticEnd1(); }
}
  private reader!: VaultReader;

  async onload(): Promise<void> {
    initializeMatomo(this);
let diagnosticStartupEnd: () => void = () => {};

const diagnosticEnd2 = diagnostics?.start?.("main.onload") ?? (() => {});
try {

    this.support = new PluginSupport(this, { name: "Cairn Vault Linter", summary: "Scan vault health, review findings, and confirm repair changes and credit costs.", quickStart: ["Open the Cairn view.", "Run a scan with the default checks.", "Review available repairs and confirm their credit cost."], commands: ["Open vault linter", "Scan vault", "Rollback last repair"], troubleshooting: ["Use Copy diagnostic log before reporting a problem.", "Run a fresh scan if files changed after the report was created."] });
    this.support.start();
    this.settings = mergeSettings(await this.loadData());
diagnosticStartupEnd = diagnostics?.start?.("startup.initialize") ?? (() => {});

    await initializeBilling(this);
    await recoverNative({app:this.app,settings:this.settings,persistNative:()=>this.persistBillingSettings()});
    this.registerInterval(window.setInterval(() => {
return diagnostics.guard("main.timer_1", () => { if (Object.keys(this.settings.pendingCheckoutKeys ?? {}).length) void diagnostics.guard("main.background_2", () => (syncBalance(this)));
});
}, 15000));
    this.reader = this.createReader();
    this.lastNote = this.app.workspace.getActiveFile();
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file?.extension.toLowerCase() === "md") this.lastNote = file;
    }));
    this.registerView(VIEW_TYPE_CAIRN, (leaf) => new CairnView(leaf, this));
    registerSidebarIcon(this, VIEW_TYPE_CAIRN, "checkmark");
    this.addRibbonIcon("checkmark", "Open Cairn Vault Linter", () => diagnostics.guard("main.event_3", () => (void diagnostics.guard("main.background_4", () => (this.openDashboard(true))))));
    this.addCommand({ id: "scan-full-vault", name: "Scan full vault", callback: () => this.runScan() });
    this.addCommand({ id: "scan-current-note", name: "Scan current note", checkCallback: (checking) => this.scanCurrentNote(checking) });
    this.addCommand({ id: "scan-current-folder", name: "Scan current folder", checkCallback: (checking) => this.scanCurrentFolder(checking) });
    this.addCommand({ id: "scan-changed-notes", name: "Scan changed notes (incremental)", callback: () => this.runScan(undefined, true) });
    this.addCommand({ id: "cancel-scan", name: "Cancel active scan", callback: () => this.cancelScan() });
    this.addCommand({ id: "rollback-last-repair", name: "Roll back last repair batch", callback: () => this.rollbackLastRepair() });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => diagnostics.guard("main.event_5", () => (this.addFileMenuItems(menu, file)))));
    this.registerEvent(this.app.workspace.on("files-menu", (menu, files) => diagnostics.guard("main.event_6", () => (this.addFilesMenuItems(menu, files)))));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, _editor, info) => {
return diagnostics.guard("main.event_7", () => { if (info.file instanceof TFile) this.addScanMenuItem(menu, [info.file.path], "Cairn: Scan this note");
});
}));
    this.addSettingTab(new CairnSettingTab(this.app, this));
    this.support.showWelcome();

} catch (diagnosticError2) { diagnostics?.failure?.("main.onload", diagnosticError2); throw diagnosticError2; } finally { diagnosticStartupEnd();  diagnostics?.legacy?.("info", "startup.finished"); diagnosticEnd2(); }
}

  onunload(): void {
return diagnostics.guard("main.onunload_8", () => {
const diagnosticAction3 = () => {

    this.scanAbort?.abort();

}; return diagnostics?.run ? diagnostics.run("main.onunload", diagnosticAction3) : diagnosticAction3();

});
}

  async persistBillingSettings(): Promise<void> {
const diagnosticEnd4 = diagnostics?.start?.("main.persistBillingSettings") ?? (() => {});
try {

    await this.saveData(this.settings);

} catch (diagnosticError4) { diagnostics?.failure?.("main.persistBillingSettings", diagnosticError4); throw diagnosticError4; } finally { diagnosticEnd4(); }
}

  refreshBillingSummary(): void {
    this.billingSummaryRefresh?.();
  }

  pollAfterCheckout(checkoutId: string): void {
    let attempts = 0;
    const poll = () => {
      attempts += 1;
      void diagnostics.guard("main.background_9", () => (pollCheckout(this, checkoutId).then((status) => {
        if (status !== "pending" || attempts >= 8) window.clearInterval(intervalId);
      })));
    };
    const intervalId = window.setInterval(diagnostics.wrap("main.timer_10", poll), 15000);
    this.registerInterval(intervalId);
    poll();
  }

  private createReader(): VaultReader {
    const getFiles = () => this.app.vault.getFiles().map((file) => ({ path: file.path, basename: file.basename, extension: file.extension, mtime: file.stat.mtime, size: file.stat.size }));
    return {
      getFiles,
      read: async (record) => {
const diagnosticEnd5 = diagnostics?.start?.("main.background.7408") ?? (() => {});
try {

        const file = this.app.vault.getAbstractFileByPath(record.path);
        if (!(file instanceof TFile)) throw new Error("File is no longer available");
        const content=await this.app.vault.read(file);this.sourceFiles.set(file.path,file);this.scannedSources.set(file.path,content);return await (content);

} catch (diagnosticError5) { diagnostics?.failure?.("main.background.7408", diagnosticError5); throw diagnosticError5; } finally { diagnosticEnd5(); }
}
    };
  }

  async openDashboard(inTab = false): Promise<void> {
const diagnosticEnd6 = diagnostics?.start?.("main.openDashboard") ?? (() => {});
try {

    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CAIRN)[0];
    const leaf = inTab && existing?.getRoot() !== this.app.workspace.rootSplit
      ? this.app.workspace.getLeaf("tab") : existing || this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_CAIRN, active: true });
    if (existing && existing !== leaf) existing.detach();
    this.app.workspace.revealLeaf(leaf);

} catch (diagnosticError6) { diagnostics?.failure?.("main.openDashboard", diagnosticError6); throw diagnosticError6; } finally { diagnosticEnd6(); }
}

  async refreshDashboard(): Promise<void> {
const diagnosticEnd7 = diagnostics?.start?.("main.refreshDashboard") ?? (() => {});
try {

    this.app.workspace.getLeavesOfType(VIEW_TYPE_CAIRN).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof CairnView) view.render();
    });

} catch (diagnosticError7) { diagnostics?.failure?.("main.refreshDashboard", diagnosticError7); throw diagnosticError7; } finally { diagnosticEnd7(); }
}

  scanFile(): TFile | null {
    const file = this.app.workspace.getActiveFile() || this.lastNote;
    return file?.extension.toLowerCase() === "md" && this.app.vault.getAbstractFileByPath(file.path) === file ? file : null;
  }

  async rescanReport(): Promise<void> {
    await this.runScan(this.lastScan?.scope?.kind === "selection" ? this.lastScan.scope.paths : undefined);
  }

  scanCurrentNote(checking: boolean): boolean {
    const file = this.scanFile();
    if (checking) return !!file && file.extension.toLowerCase() === "md";
    if (file) void diagnostics.guard("main.background_11", () => (this.runScan([file.path])));
    else new Notice("Open a Markdown note first, then scan it from Cairn.");
    return true;
  }

  scanCurrentFolder(checking: boolean): boolean {
    const file = this.scanFile();
    const folder = file?.parent;
    if (checking) return !!folder;
    if (folder) void diagnostics.guard("main.background_12", () => (this.runScan(this.app.vault.getMarkdownFiles().filter((candidate) => !folder.parent || candidate.path === folder.path || candidate.path.startsWith(`${folder.path}/`)).map((candidate) => candidate.path))));
    else new Notice("Open a Markdown note first to scan its folder.");
    return true;
  }

  private addScanMenuItem(menu: Menu, paths: string[], title: string): void {
    if (!paths.length) return;
    menu.addItem((item) => item.setTitle(title).onClick(() => {
return diagnostics.guard("main.control_13", () => { const diagnosticAction8 = () => (void diagnostics.guard("main.background_14", () => (this.runScan(paths)))); return diagnostics?.run ? diagnostics.run("control.9178.onClick", diagnosticAction8) : diagnosticAction8();
});
}));
  }

  private addFileMenuItems(menu: Menu, file: TAbstractFile): void {
    if (file instanceof TFile && file.extension.toLowerCase() === "md") {
      this.addScanMenuItem(menu, [file.path], "Cairn: Scan this note");
      return;
    }
    if (file instanceof TFolder) {
      const paths = selectedFiles([file], markdownFile).map(note => note.path);
      this.addScanMenuItem(menu, paths, "Cairn: Scan this folder");
    }
  }

  private addFilesMenuItems(menu: Menu, selected: TAbstractFile[]): void {
    const paths = new Set(selectedFiles(selected, markdownFile).map(file => file.path));

    this.addScanMenuItem(menu, [...paths], `Cairn: Scan ${paths.size} selected note${paths.size === 1 ? "" : "s"}`);
  }

  async runScan(scopePaths?: string[], incremental = false): Promise<void> {
const diagnosticEnd9 = diagnostics?.start?.("main.runScan") ?? (() => {});
try {

    if (this.repairApplying) { new Notice("Wait for the current repair or rollback to finish before scanning."); return; }
    if (this.scanAbort) {
      new Notice("Cairn is already scanning. Use Cancel scan to stop it first.");
      return;
    }
    this.scanAbort = new AbortController();
    try {
      await this.openDashboard();
    } catch (error) {
      this.scanAbort = null;
      throw error;
    }
    const view = this.getView();
    view?.setProgress({ phase: "indexing", currentPath: "", scanned: 0, total: 0, findings: 0 });
    try {
      const result = await scanVault(this.reader, this.settings, scopePaths, incremental, this.scanAbort.signal, (progress) => view?.setProgress(progress), this.lastFindings, this.reportNeedsScan ? undefined : this.lastScan);
      if (result.cancelled) {
        new Notice(`Cairn scan cancelled after ${result.filesScanned} file(s).`);
        return;
      }
      this.comparisonDelta = !this.reportNeedsScan && !result.errors.length && !this.lastScan?.errors.length && !!result.comparisonKey && this.lastScan?.comparisonKey === result.comparisonKey ? findingCounts(result.findings).total - findingCounts(this.lastFindings).total : null;
      this.lastScan = result;
      this.reportNeedsScan = false;
      this.lastErrors = result.errors;
      const fullFindings=applyIgnoredFindings(result.findings, this.settings.ignoredFindings);
      this.scanPreview={id:jobId(),result,findings:fullFindings,revealed:true};
      this.lastFindings = fullFindings;
      this.lastErrors = result.errors;
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
diagnostics.failure("main.caught_15", error);
      new Notice(`Cairn scan failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.scanAbort = null;
      view?.setProgress(null);
    }

} catch (diagnosticError9) { diagnostics?.failure?.("main.runScan", diagnosticError9); throw diagnosticError9; } finally { diagnosticEnd9(); }
}

  cancelScan(): void {
const diagnosticAction10 = () => {

    if (!this.scanAbort) {
      new Notice("No Cairn scan is active.");
      return;
    }
    this.scanAbort.abort();

}; return diagnostics?.run ? diagnostics.run("main.cancelScan", diagnosticAction10) : diagnosticAction10();
}

  getView(): CairnView | undefined {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_CAIRN)[0]?.view;
    return view instanceof CairnView ? view : undefined;
  }

  async ignoreFinding(finding: Finding): Promise<void> {
const diagnosticEnd11 = diagnostics?.start?.("main.ignoreFinding") ?? (() => {});
try {

    new IgnoreModal(this.app, finding, async (reason, scope) => {
const diagnosticEnd12 = diagnostics?.start?.("main.background.12634") ?? (() => {});
try {

      const key = scope === "finding" ? finding.id : scope === "source" ? finding.sourcePath : sourceFolder(finding.sourcePath) || "/";
      this.settings.ignoredFindings = [...this.settings.ignoredFindings.filter(item => item.key !== key || item.scope !== scope), { key, reason, scope, createdAt: new Date().toISOString() }];
      await this.refreshIgnoreRules();

} catch (diagnosticError12) { diagnostics?.failure?.("main.background.12634", diagnosticError12); throw diagnosticError12; } finally { diagnosticEnd12(); }
}).open();

} catch (diagnosticError11) { diagnostics?.failure?.("main.ignoreFinding", diagnosticError11); throw diagnosticError11; } finally { diagnosticEnd11(); }
}

  async refreshIgnoreRules(): Promise<void> {
    this.lastFindings = applyIgnoredFindings(this.lastFindings, this.settings.ignoredFindings);
    if (this.scanPreview) this.scanPreview.findings = this.lastFindings;
    this.comparisonDelta = null;
    await this.saveData(this.settings);
    await this.refreshDashboard();
  }

  async restoreFinding(finding: Finding): Promise<void> {
    this.settings.ignoredFindings = this.settings.ignoredFindings.filter(item => !ignoreRuleMatches(finding, item));
    await this.refreshIgnoreRules();
    new Notice("Matching ignore rules removed. Other findings covered by those rules are restored too.");
  }

  async openFinding(finding: Finding): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(finding.sourcePath) || this.sourceFiles.get(finding.sourcePath);
    if (!(file instanceof TFile) || this.app.vault.getAbstractFileByPath(file.path) !== file) {
      new Notice(`The note ${finding.sourcePath} is missing. Run a new scan to locate current findings.`);
      return;
    }
    try {
      const leaf = this.app.workspace.getLeavesOfType("markdown").find(item => item.view instanceof MarkdownView && item.view.file === file) || this.app.workspace.getLeaf("tab");
      await leaf.openFile(file, { eState: { line: Math.max(0, finding.line - 1) } });
      if (leaf.view instanceof MarkdownView) {
        const line = Math.max(0, Math.min(finding.line - 1, leaf.view.editor.lineCount() - 1));
        leaf.view.editor.setCursor({ line, ch: 0 });
        leaf.view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
      }
      await this.app.workspace.revealLeaf(leaf);
      if (file.path !== finding.sourcePath) new Notice(`Opened renamed note ${file.path}. Run a new scan to refresh its findings.`);
    } catch (error) {
      diagnostics.failure("main.openFinding", error);
      new Notice(`Could not open ${file.path}. Run a new scan and try again.`);
    }
  }

  reportScope(): string {
    const scope = this.lastScan?.scope;
    if (!scope) return "No current report";
    return scope.kind === "vault" ? "Full vault (eligible notes)" : `Selected notes (${scope.paths.length}): ${scope.paths.join(", ") || "none"}`;
  }

  reportIsStale(): boolean {
    return this.reportNeedsScan || (!!this.lastScan?.settingsKey && this.lastScan.settingsKey !== scanSettingsKey(this.settings));
  }

  async reviewRepairs(findings: Finding[]): Promise<void> {
const diagnosticEnd13 = diagnostics?.start?.("main.reviewRepairs") ?? (() => {});
try {

    if (this.reportIsStale()) { new Notice("Run a new scan before applying repairs. The report needs updating."); return; }
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
      const before = this.scannedSources.get(path);
      if(before===undefined || await this.app.vault.read(file)!==before){new Notice("The source changed since the scan. Your original report is saved. Run a new scan before applying repairs.");continue;}
      const proposals = fileFindings.map((finding) => finding.repair!);
      const after = applyTextRepairs(before, proposals).after;
      if (after !== before) plans.push({ path, before, after, proposals });
    }
    if (!plans.length) {
      new Notice("Cairn found no note changes to apply. Nothing was charged.");
      return;
    }
    new RepairPreviewModal(this.app, plans, (selected) => void diagnostics.guard("main.background_16", () => this.applyRepairPlans(selected)), this.settings).open();

} catch (diagnosticError13) { diagnostics?.failure?.("main.reviewRepairs", diagnosticError13); throw diagnosticError13; } finally { diagnosticEnd13(); }
}

  private async applyRepairPlans(plans: RepairPlan[]): Promise<void> {
const diagnosticEnd15 = diagnostics?.start?.("main.applyRepairPlans") ?? (() => {});
try {

    if (this.reportIsStale()) { new Notice("Run a new scan before applying repairs."); return; }
    if (this.scanAbort) { new Notice("Wait for the current scan to finish before applying repairs."); return; }
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
      const restoreJournal = await prepareRepairJournal(this.app.vault.adapter, this.journalPath(), JSON.stringify(journal));
      let reservation;
      try {
        reservation = this.repairAuthorizations.get(plans) || await reserveRepairBatch(this,undefined,JSON.stringify(readyPlans.map(p=>p.before)),JSON.stringify(readyPlans),{files:readyPlans.length,edits:readyPlans.reduce((n,p)=>n+p.proposals.length,0)});
      } catch (error) {
diagnostics.failure("main.caught_17", error);
        await restoreJournal();
        throw error;
      }
      if (!reservation) {
        await restoreJournal();
        return;
      }

      if(reservation.markWriting && !await reservation.markWriting(await Promise.all(readyPlans.map(async plan=>{ const diagnosticEnd16 = diagnostics?.start?.("main.background.16573") ?? (() => {}); try { return await (({path:plan.path,before:await digest(plan.before),after:await digest(plan.after)})); } catch (diagnosticError16) { diagnostics?.failure?.("main.background.16573", diagnosticError16); throw diagnosticError16; } finally { diagnosticEnd16(); } }))))return;
      const changed: string[] = [];
      const failed: string[] = [];
      const unwritten: string[] = [];
      for (const plan of readyPlans) {
        try {
          const file = this.app.vault.getAbstractFileByPath(plan.path);
          if (!(file instanceof TFile)) { skipped.push(plan.path); unwritten.push(plan.path); continue; }
          const current = await this.app.vault.read(file);
          if (current !== plan.before) { skipped.push(plan.path); unwritten.push(plan.path); continue; }
          this.reportNeedsScan = true;
          this.comparisonDelta = null;
          await this.app.vault.process(file,latest=>{if(latest!==plan.before){unwritten.push(plan.path);throw new Error("The source changed. Your original preview is saved.");}return plan.after;});
          if(await this.app.vault.read(file)!==plan.after)throw new Error("The repair could not be confirmed. Recovery data is saved. Check the note before retrying.");
          changed.push(plan.path);
        } catch (error) {
diagnostics.failure("main.caught_18", error);
          failed.push(`${plan.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await reservation.completeWrites?.(unwritten);
      if (!changed.length) {
        await reservation.rollback();
        // A write can succeed even if its verification read failed. Keep its
        // recovery text whenever any output is present or cannot be read.
        const unchanged = await Promise.all(readyPlans.map(async plan => {
          try { return await this.app.vault.adapter.read(plan.path) === plan.before; } catch { return false; }
        }));
        if (unchanged.every(Boolean)) await restoreJournal();
      } else {
        const billingResult = await reservation.commit();
        if (billingResult.kind === "pending") new Notice("Cairn repair applied. Billing is pending and will retry automatically.");
      }
      new Notice(`Cairn repair complete: ${changed.length} changed, ${skipped.length} skipped, ${failed.length} failed. Rollback is available.`);
      await this.refreshDashboard();
    } catch (error) {
diagnostics.failure("main.caught_19", error);
      await this.refreshDashboard();
      new Notice(`Cairn repair could not be applied: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.nativeWriting = false;
      this.repairApplying = false;
    }

} catch (diagnosticError15) { diagnostics?.failure?.("main.applyRepairPlans", diagnosticError15); throw diagnosticError15; } finally { diagnosticEnd15(); }
}

  private journalPath(): string {
    return `${this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`}/repair-journal.json`;
  }

  async rollbackLastRepair(): Promise<void> {
const diagnosticEnd17 = diagnostics?.start?.("main.rollbackLastRepair") ?? (() => {});
try {

    if (this.repairApplying || this.scanAbort) { new Notice("Wait for the current scan, repair or rollback to finish."); return; }
    this.repairApplying = true;
    try {
      const journal = JSON.parse(await this.app.vault.adapter.read(this.journalPath())) as RepairJournal;
      const rolledBack: string[] = [];
      const skipped: string[] = [];
      for (const entry of journal.entries) {
        const file = this.app.vault.getAbstractFileByPath(entry.path);
        if (!(file instanceof TFile)) { skipped.push(entry.path); continue; }
        const current = await this.app.vault.read(file);
        if (!canRollback(current, entry.after)) { skipped.push(entry.path); continue; }
        this.reportNeedsScan = true;
        this.comparisonDelta = null;
        await this.app.vault.process(file, latest => {
          if (!canRollback(latest, entry.after)) throw new Error("The note changed before rollback. Newer edits were preserved.");
          return entry.before;
        });
        if (await this.app.vault.read(file) !== entry.before) throw new Error("Rollback could not be verified. Recovery data is saved.");
        rolledBack.push(entry.path);
      }
      new Notice(`Cairn rollback: ${rolledBack.length} restored, ${skipped.length} skipped to protect newer edits.`);
      await this.refreshDashboard();
    } catch (error) {
diagnostics.failure("main.caught_20", error);
      await this.refreshDashboard();
      new Notice(`Cairn rollback could not finish: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.repairApplying = false;
    }

} catch (diagnosticError17) { diagnostics?.failure?.("main.rollbackLastRepair", diagnosticError17); throw diagnosticError17; } finally { diagnosticEnd17(); }
}

  async exportReport(format: "markdown" | "csv" | "json"): Promise<void> {
const diagnosticEnd18 = diagnostics?.start?.("main.exportReport") ?? (() => {});
try {

    if (!this.lastScan) {
      new Notice("Run a scan before exporting a report.");
      return;
    }
    if(!await this.revealReport())return;
    const content = format === "markdown" ? this.markdownReport() : format === "csv" ? this.csvReport() : this.jsonReport();
    const createReport = async () => {
const diagnosticEnd19 = diagnostics?.start?.("main.createReport") ?? (() => {});
try {

      const folder = this.settings.reportFolder.trim().replace(/^\/+|\/+$/g, "") || "Cairn Reports";
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      const extension = format === "markdown" ? "md" : format;
      const path = `${folder}/cairn-report-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
      await this.app.vault.create(path, content);
      new Notice(`Cairn report exported to ${path}.`);

} catch (diagnosticError19) { diagnostics?.failure?.("main.createReport", diagnosticError19); throw diagnosticError19; } finally { diagnosticEnd19(); }
};
    if (this.settings.reviewBeforeApply) new ExportPreviewModal(this.app, format, content, createReport).open();
    else void diagnostics.guard("main.background_21", () => (createReport()));

} catch (diagnosticError18) { diagnostics?.failure?.("main.exportReport", diagnosticError18); throw diagnosticError18; } finally { diagnosticEnd18(); }
}

  private markdownReport(): string {
    const counts = findingCounts(this.lastFindings);
    const lines = [`# Cairn Vault Linter report`, ``, `- Scanned: ${this.settings.lastScanAt}`, `- Scope: ${this.reportScope()}`, `- Report needs scan: ${this.reportIsStale()}`, `- Notes indexed: ${this.lastScan?.notesIndexed || 0}`, `- Files scanned: ${this.lastScan?.filesScanned || 0}`, `- Findings: ${counts.total} (${counts.high} high)`, ``];
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
    const header = ["id", "type", "severity", "source", "line", "section", "target", "resolved", "ignored", "context", "explanation", "scan_scope", "report_needs_scan"];
    const rows = this.lastFindings.map((finding) => [finding.id, finding.type, finding.severity, finding.sourcePath, String(finding.line), finding.section, finding.target, String(finding.resolved), String(!!finding.ignored), finding.context, finding.explanation, this.reportScope(), String(this.reportIsStale())]);
    if (!rows.length) rows.push([...Array<string>(11).fill(""), this.reportScope(), String(this.reportIsStale())]);
    return [header, ...rows].map(row => row.map(escapeCsv).join(",")).join("\n");
  }

  private jsonReport(): string {
    return JSON.stringify({ generatedAt: new Date().toISOString(), summary: { scope: this.lastScan?.scope, scopeLabel: this.reportScope(), needsScan: this.reportIsStale(), notesIndexed: this.lastScan?.notesIndexed || 0, filesScanned: this.lastScan?.filesScanned || 0, ...findingCounts(this.lastFindings) }, findings: this.lastFindings, errors: this.lastErrors }, null, 2);
  }
}

class CairnView extends ItemView {
  private plugin: CairnVaultLinterPlugin;
  private progress: ScanProgress | null = null;
  private typeFilter = "all";
  private severityFilter = "all";
  private folderFilter = "all";
  private stateFilter = "unresolved";
  private scanScope = "vault";
  private filtersOpen = false;
  private suggestionsOpen = false;

  constructor(leaf: WorkspaceLeaf, plugin: CairnVaultLinterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_CAIRN; }
  getDisplayText(): string { return "Cairn Vault Linter"; }
  getIcon(): string { return "checkmark"; }

  onOpen(): Promise<void> {
return diagnostics.guard("main.onOpen_22", () => {
const diagnosticAction20 = () => {
 this.render(); return Promise.resolve();
}; return diagnostics?.run ? diagnostics.run("main.onOpen", diagnosticAction20) : diagnosticAction20();

});
}
  onClose(): Promise<void> {
return diagnostics.guard("main.onClose_23", () => {
const diagnosticAction21 = () => {
 return Promise.resolve();
}; return diagnostics?.run ? diagnostics.run("main.onClose", diagnosticAction21) : diagnosticAction21();

});
}

  setProgress(progress: ScanProgress | null): void {
    this.progress = progress;
    const existing = this.contentEl.querySelector(".cairn-progress");
    if (progress && existing) {
      const title = existing.querySelector("strong");
      const text = existing.querySelector("p");
      const bar = existing.querySelector("progress");
      if (title) title.textContent = `Scanning ${progress.phase}...`;
      if (text) text.textContent = progress.phase === "reading" || progress.phase === "indexing"
        ? `Reading notes for target indexing${progress.currentPath ? `: ${progress.currentPath}` : ""}`
        : `${progress.scanned}/${progress.total} notes checked, ${progress.findings} findings${progress.currentPath ? `: ${progress.currentPath}` : ""}`;
      if (bar) { bar.max = progress.total || 1; bar.value = Math.min(progress.scanned, bar.max); }
      return;
    }
    this.render();
  }

  render(): void {
const diagnosticAction22 = () => {

    const root = this.contentEl;
    const scrollTop = root.scrollTop;
    root.empty();
    root.addClass("cairn-view");
    const heading = root.createEl("h1", { text: "Cairn Vault Linter" });
    heading.setAttr("tabindex", "-1");
    root.createEl("p", { text: "Find broken links. Scanning never changes your notes." }).addClass("cairn-subtitle");
    const actions = root.createDiv({ cls: "cairn-actions" });
    this.select(actions, "Scan scope", this.scanScope, ["vault", "note", "folder", "changed"], (value) => { this.scanScope = value; });
    this.button(actions, "Scan", () => {
      if (this.scanScope === "note") this.plugin.scanCurrentNote(false);
      else if (this.scanScope === "folder") this.plugin.scanCurrentFolder(false);
      else void this.plugin.runScan(undefined, this.scanScope === "changed");
    }, true, !this.plugin.scanAbort);
    if (this.plugin.scanAbort) this.button(actions, "Cancel scan", () => this.plugin.cancelScan());
    if (this.leaf.getRoot() !== this.app.workspace.rootSplit) this.button(actions, "Open in tab", () => void this.plugin.openDashboard(true));
    if (this.progress) {
      const progress = root.createDiv({ cls: "cairn-progress" });
      progress.setAttr("role", "status");
      progress.setAttr("aria-live", "polite");
      progress.createEl("strong", { text: `Scanning ${this.progress.phase}…` });
      progress.createEl("p", { text: this.progress.phase === "reading" || this.progress.phase === "indexing" ? `Reading notes for target indexing${this.progress.currentPath ? `: ${this.progress.currentPath}` : ""}` : `${this.progress.scanned}/${this.progress.total} notes checked, ${this.progress.findings} findings${this.progress.currentPath ? `: ${this.progress.currentPath}` : ""}` });
      const bar = progress.createEl("progress");
      bar.max = this.progress.total || 1;
      bar.value = Math.min(this.progress.scanned, bar.max);
      bar.setAttr("aria-label", "Cairn scan progress");
    }
    if (this.plugin.lastScan) {
      const scope = root.createEl("details", { cls: "cairn-report-details" });
      scope.createEl("summary", { text: `${this.plugin.lastScan.filesScanned} note${this.plugin.lastScan.filesScanned === 1 ? "" : "s"} checked. Scan details` });
      scope.createEl("p", { text: `Scope: ${this.plugin.reportScope()}. ${this.plugin.lastScan.notesIndexed || 0} notes read for indexing${this.plugin.lastScan.incremental ? "; unchanged findings retained" : ""}.` });
    }
    if (this.plugin.reportIsStale()) {
      const stale = root.createDiv({ attr: { role: "status" } });
      stale.createEl("p", { text: "This report needs a new scan after note changes or changed check settings. Related findings may still be listed. Repair actions are paused." });
      this.button(stale, "Rescan this report", () => void this.plugin.rescanReport(), true);
    }
    this.renderSummary(root);
    const recovery = root.createDiv({ cls: "cairn-recovery" });
    this.button(recovery, "Undo last repair", () => void this.plugin.rollbackLastRepair());
    if (this.plugin.lastFindings.length || this.plugin.lastErrors.length) this.renderResults(root);
    else root.createEl("p", { text: this.plugin.lastScan ? "No findings in the checked scope." : "Run a scan to see grouped findings and safe repair options." }).addClass("cairn-empty");
    root.createEl("small", { text: `Cairn Vault Linter ${this.plugin.manifest.version}` });
    root.scrollTop = scrollTop;

}; return diagnostics?.run ? diagnostics.run("main.render", diagnosticAction22) : diagnosticAction22();
}

  private renderSummary(root: HTMLElement): void {
const diagnosticAction23 = () => {

    if (!this.plugin.lastScan) return;
    const active = this.plugin.lastFindings.filter(finding => !finding.ignored);
    const suggestions = active.filter(finding => finding.type === "duplicate-link").length;
    const problems = active.length - suggestions;
    root.createEl("p", { cls: "cairn-summary", attr: { role: "status" }, text: `${problems} ${problems === 1 ? "needs" : "need"} attention${suggestions ? `, ${suggestions} optional suggestions` : ""}${this.plugin.comparisonDelta === null ? "." : this.plugin.comparisonDelta === 0 ? ". No change." : `. ${this.plugin.comparisonDelta > 0 ? "+" : ""}${this.plugin.comparisonDelta} since the previous scan of this scope.`}` });

}; return diagnostics?.run ? diagnostics.run("main.renderSummary", diagnosticAction23) : diagnosticAction23();
}

  private renderResults(root: HTMLElement): void {
const diagnosticAction24 = () => {

    const findings = this.filteredFindings();
    const filterDetails = root.createEl("details", { cls: "cairn-filter-details" });
    filterDetails.open = this.filtersOpen;
    filterDetails.createEl("summary", { text: `Filters (${findings.length} shown)` });
    filterDetails.ontoggle = () => { this.filtersOpen = filterDetails.open; };
    const toolbar = filterDetails.createDiv({ cls: "cairn-filters" });
    this.select(toolbar, "Finding type", this.typeFilter, ["all", ...Object.keys(FINDING_LABELS)], (value) => { this.typeFilter = value; this.render(); });
    this.select(toolbar, "Severity", this.severityFilter, ["all", "high", "medium", "low", "info"], (value) => { this.severityFilter = value; this.render(); });
    const folders = [...new Set(this.plugin.lastFindings.map((finding) => finding.sourcePath.split("/").slice(0, -1).join("/") || "/"))].sort();
    this.select(toolbar, "Folder", this.folderFilter, ["all", ...folders], (value) => { this.folderFilter = value; this.render(); });
    this.select(toolbar, "State", this.stateFilter, ["all", "unresolved", "ignored"], (value) => { this.stateFilter = value; this.render(); });
    const repairable = findings.filter(finding => finding.repair && !finding.ignored);
    const actions = root.createDiv({ cls: "cairn-actions" });
    if (repairable.length) this.button(actions, `Review ${repairable.length} repair${repairable.length === 1 ? "" : "s"}`, () => void this.plugin.reviewRepairs(findings), true, !this.plugin.reportIsStale());
    this.button(actions, "Export report", () => void this.plugin.exportReport(this.plugin.settings.defaultReportFormat));
    const suggestions = root.createEl("details", { cls: "cairn-suggestions" });
    const optionalCount = findings.filter(finding => finding.type === "duplicate-link").length;
    suggestions.hidden = optionalCount === 0;
    suggestions.open = this.suggestionsOpen;
    suggestions.createEl("summary", { text: `Repeated links (${optionalCount} optional suggestions)` });
    suggestions.ontoggle = () => { this.suggestionsOpen = suggestions.open; };
    const issues = root.createDiv({ cls: "cairn-issues" });
    root.insertBefore(issues, suggestions);
    const groups = new Map<string, Finding[]>();
    const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
    [...findings].sort((a, b) => rank[a.severity] - rank[b.severity] || a.sourcePath.localeCompare(b.sourcePath) || a.line - b.line).forEach((finding) => {
      const key = `${finding.type === "duplicate-link" ? "suggestion" : "issue"}:${finding.sourcePath}`;
      groups.set(key, [...(groups.get(key) || []), finding]);
    });
    groups.forEach((group) => {
      const path = group[0].sourcePath;
      const parent = group[0].type === "duplicate-link" ? suggestions : issues;
      const details = parent.createEl("details", { cls: "cairn-source-group" });
      details.open = true;
      details.createEl("summary", { text: `${path} (${group.length})` });
      group.forEach((finding) => this.renderFinding(details, finding));
    });
    if (this.plugin.lastErrors.length) {
      const errors = root.createEl("details", { cls: "cairn-errors" });
      errors.createEl("summary", { text: `Unreadable or malformed files (${this.plugin.lastErrors.length})` });
      this.plugin.lastErrors.forEach((error) => errors.createEl("p", { text: `${error.path}: ${error.message}` }));
    }

}; return diagnostics?.run ? diagnostics.run("main.renderResults", diagnosticAction24) : diagnosticAction24();
}

  private filteredFindings(): Finding[] {
    return this.plugin.lastFindings.filter((finding) => (this.typeFilter === "all" || finding.type === this.typeFilter) && (this.severityFilter === "all" || finding.severity === this.severityFilter) && (this.folderFilter === "all" || (finding.sourcePath.split("/").slice(0, -1).join("/") || "/") === this.folderFilter) && (this.stateFilter === "all" || (this.stateFilter === "ignored" ? finding.ignored : !finding.ignored)));
  }

  private renderFinding(parent: HTMLElement, finding: Finding): void {
const diagnosticAction25 = () => {

    const card = parent.createDiv({ cls: `cairn-finding cairn-${finding.severity}` });
    const title = card.createEl("h3", { text: `${finding.type === "duplicate-link" ? "Repeated link (optional)" : FINDING_LABELS[finding.type]} · line ${finding.line}` });
    title.setAttr("tabindex", "0");
    const badge = title.createSpan({ cls: "cairn-badge", text: SEVERITY_LABELS[finding.severity] });
    badge.setAttr("aria-label", `${SEVERITY_LABELS[finding.severity]} severity`);
    card.createEl("p", { text: finding.explanation });
    const meta = card.createEl("p", { cls: "cairn-meta" });
    meta.createEl("code", { text: finding.target || "(no target)" });
    meta.appendText(` · ${finding.section} · ${finding.ignored ? `Ignored: ${finding.ignoredReason}` : finding.resolved ? "Resolved target" : "Unresolved"}`);
    if (finding.context) {
      const context = card.createEl("details", { cls: "cairn-context-details" });
      context.createEl("summary", { text: "Show context" });
      context.createEl("pre", { text: finding.context }).addClass("cairn-context");
    }
    const buttons = card.createDiv({ cls: "cairn-finding-actions" });
    this.button(buttons, "Open note", () => void this.plugin.openFinding(finding));
    if (finding.repair && !finding.ignored && !this.plugin.reportIsStale()) this.button(buttons, "Review repair", () => void diagnostics.guard("main.background_29", () => (this.plugin.reviewRepairs([finding]))), true);
    if (finding.ignored) this.button(buttons, "Restore finding", () => void this.plugin.restoreFinding(finding));
    else this.button(buttons, "Ignore...", () => void diagnostics.guard("main.background_30", () => (this.plugin.ignoreFinding(finding))));

}; return diagnostics?.run ? diagnostics.run("main.renderFinding", diagnosticAction25) : diagnosticAction25();
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
    options.forEach((option) => select.createEl("option", { text: ({ vault: "Full vault", note: "Current note", folder: "Current folder", changed: "Changed notes" } as Record<string, string>)[option] || (option === "all" ? "All" : FINDING_LABELS[option as FindingType] || SEVERITY_LABELS[option as Severity] || option), value: option }));
    select.value = value;
    select.onchange = diagnostics.wrap("main.filter_changed", () => onChange(select.value));
  }

  private button(parent: HTMLElement, text: string, callback: () => void, primary = false, enabled = true): HTMLButtonElement {
    const button = parent.createEl("button", { text });
    if (primary) button.addClass("mod-cta");
    button.disabled = !enabled;
    button.onclick = diagnostics.wrap("main.dom_1", callback);
    return button;
  }
}

class IgnoreModal extends Modal {
  constructor(app: App, private finding: Finding, private onSave: (reason: string, scope: "finding" | "source" | "folder") => Promise<void>) { super(app); }
  onOpen(): void {
return diagnostics.guard("main.onOpen_32", () => {
const diagnosticAction26 = () => {

    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Ignore finding" });
    contentEl.createEl("p", { text: `${this.finding.sourcePath}:${this.finding.line} · ${this.finding.explanation}` });
    let reason = "";
    new Setting(contentEl).setName("Reason").setDesc("Keep a short local explanation for future reviews.").addText((text) => { text.setPlaceholder("Intentional link, generated note, etc."); text.onChange((value) => {
return diagnostics.guard("main.control_33", () => { const diagnosticAction27 = () => (reason = value); return diagnostics?.run ? diagnostics.run("control.31969.onChange", diagnosticAction27) : diagnosticAction27();
});
}); });
    let scope: "finding" | "source" | "folder" = "finding";
    new Setting(contentEl).setName("Scope").addDropdown((dropdown) => dropdown.addOptions({ finding: "This finding", source: `This source note: ${this.finding.sourcePath}`, folder: sourceFolder(this.finding.sourcePath) ? `This source folder: ${sourceFolder(this.finding.sourcePath)}/ (and descendants)` : "Root-level notes only (no subfolders)" }).setValue(scope).onChange((value) => {
return diagnostics.guard("main.control_34", () => { const diagnosticAction28 = () => (scope = value as typeof scope); return diagnostics?.run ? diagnostics.run("control.scope.onChange", diagnosticAction28) : diagnosticAction28();
});
}));
    const actions = contentEl.createDiv({ cls: "cairn-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.onclick = diagnostics.wrap("main.dom_2", () => this.close());
    const save = actions.createEl("button", { text: "Ignore" });
    save.addClass("mod-cta");
    save.onclick = diagnostics.wrap("main.dom_3", () => { void diagnostics.guard("main.background_35", () => (this.onSave(reason.trim() || "Ignored by user", scope).then(() => this.close()))); });

}; return diagnostics?.run ? diagnostics.run("main.onOpen", diagnosticAction26) : diagnosticAction26();

});
}
}

class RepairPreviewModal extends Modal {
  constructor(app: App, private plans: RepairPlan[], private onApply: (plans: RepairPlan[]) => void, private settings: CairnSettings) { super(app); }
  onOpen(): void {
return diagnostics.guard("main.onOpen_36", () => {
const diagnosticAction29 = () => {

    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Review repairs" });
    const edits = this.plans.reduce((total, plan) => total + plan.proposals.length, 0);
    const credits = nativeCost("cairn-vault-linter", { files: this.plans.length, edits });
    contentEl.createEl("p", { text: `${this.plans.length} file${this.plans.length === 1 ? "" : "s"}, ${edits} edit${edits === 1 ? "" : "s"}. Cost: ${credits} repair credit${credits === 1 ? "" : "s"}.` });
    contentEl.createEl("p", { text: this.settings.billingAccountLinked
      ? `Last updated balance: ${Math.max(0, 5 - this.settings.freeRepairBatchesUsed)} free, ${Math.max(0, this.settings.purchasedRepairBatches)} purchased. Free credits are used first. Availability is checked when you apply.`
      : "Connect your account in Cairn settings before applying repairs. Scanning and review are free." });
    const details = contentEl.createEl("details");
    details.open = this.settings.reviewBeforeApply;
    details.createEl("summary", { text: "Before and after changes" });
    const preview = details.createEl("pre", { text: this.plans.map((plan) => `## ${plan.path}\n${diffPreview(plan.before, plan.after)}`).join("\n\n") });
    preview.setAttr("aria-label", "Before and after repair preview");
    preview.addClass("cairn-repair-preview");
    const actions = contentEl.createDiv({ cls: "cairn-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.onclick = diagnostics.wrap("main.dom_4", () => this.close());
    const apply = actions.createEl("button", { text: `Apply for ${credits} credit${credits === 1 ? "" : "s"}` });
    apply.disabled = !this.settings.billingAccountLinked;
    apply.addClass("mod-cta");
    contentEl.createEl("p", { text: "Canceling uses no credits. Recovery data is saved before changes. Undo is free and preserves newer edits." });
    apply.onclick = diagnostics.wrap("main.dom_5", () => { if (apply.disabled) return; apply.disabled = true; this.close(); this.onApply(this.plans); });

}; return diagnostics?.run ? diagnostics.run("main.onOpen", diagnosticAction29) : diagnosticAction29();

});
}
}

class ExportChoiceModal extends Modal {
  constructor(app: App, private onChoose: (format: "markdown" | "csv" | "json") => void) { super(app); }
  onOpen(): void {
return diagnostics.guard("main.onOpen_37", () => {
const diagnosticAction30 = () => {

    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Export Cairn report" });
    contentEl.createEl("p", { text: "Choose a local format. Cairn will show a preview before creating the report file." });
    (["markdown", "csv", "json"] as const).forEach((format) => { const button = contentEl.createEl("button", { text: format.toUpperCase() }); button.onclick = diagnostics.wrap("main.dom_6", () => { this.close(); this.onChoose(format); }); });

}; return diagnostics?.run ? diagnostics.run("main.onOpen", diagnosticAction30) : diagnosticAction30();

});
}
}

class ExportPreviewModal extends Modal {
  constructor(app: App, private format: string, private report: string, private onApply: () => Promise<void>) { super(app); }
  onOpen(): void {
return diagnostics.guard("main.onOpen_38", () => {
const diagnosticAction31 = () => {

    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Preview ${this.format.toUpperCase()} export` });
    contentEl.createEl("p", { text: "This creates a new report note in the configured report folder; it does not change existing notes." });
    const pre = contentEl.createEl("pre", { text: this.report.slice(0, 12000) });
    pre.style.maxHeight = "400px";
    pre.style.overflow = "auto";
    const actions = contentEl.createDiv({ cls: "cairn-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.onclick = diagnostics.wrap("main.dom_7", () => this.close());
    const apply = actions.createEl("button", { text: "Create report" });
    apply.addClass("mod-cta");
    apply.onclick = diagnostics.wrap("main.dom_8", () => { void diagnostics.guard("main.background_39", () => (this.onApply().then(() => this.close()))); });

}; return diagnostics?.run ? diagnostics.run("main.onOpen", diagnosticAction31) : diagnosticAction31();

});
}
}

class CairnSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CairnVaultLinterPlugin) { super(app, plugin); }
  display(): void {
return diagnostics.guard("main.display_40", () => {
const diagnosticAction32 = () => {

    const { containerEl } = this;
    const diagnosticStage33 = diagnostics?.start?.("settings.render.clear") ?? (() => {});
containerEl.empty();
diagnosticStage33();

    const diagnosticStage34 = diagnostics?.start?.("settings.render.help") ?? (() => {});
this.plugin.support.addHelpSetting(containerEl);
diagnosticStage34();

this.plugin.support.addDebugSetting?.(containerEl);

    const advanced = this.plugin.settings.settingsMode === "advanced";
    const diagnosticStage35 = diagnostics?.start?.("settings.render.settings_mode") ?? (() => {});
new Setting(containerEl).setName("Settings mode").setDesc("Simple shows everyday settings. Advanced adds scan rules, limits, and diagnostics.").addDropdown((dropdown) => dropdown.addOptions({ simple: "Simple", advanced: "Advanced — optional" }).setValue(advanced ? "advanced" : "simple").onChange(async (value) => {
return diagnostics.guard("main.control_41", async () => {
const diagnosticEnd59 = diagnostics?.start?.("control.settings_mode.onChange") ?? (() => {});
try {
 this.plugin.settings.settingsMode = value === "advanced" ? "advanced" : "simple"; await this.plugin.saveData(this.plugin.settings); this.display();
} catch (diagnosticError59) { diagnostics?.failure?.("control.settings_mode.onChange", diagnosticError59); throw diagnosticError59; } finally { diagnosticEnd59(); }

});
}));
diagnosticStage35();

    const diagnosticStage36 = diagnostics?.start?.("settings.render.stage_1") ?? (() => {});
if (advanced) this.plugin.support.addDiagnosticsSetting(containerEl);
diagnosticStage36();

    const diagnosticStage37 = diagnostics?.start?.("settings.render.stage_2") ?? (() => {});
containerEl.createEl("h2", { text: "Cairn Vault Linter" });
diagnosticStage37();

    const diagnosticStage38 = diagnostics?.start?.("settings.render.stage_3") ?? (() => {});
containerEl.createEl("p", { text: "All checks run locally. Resetting settings does not change vault notes." });
diagnosticStage38();

    const diagnosticStage39 = diagnostics?.start?.("settings.render.review_repairs_before_applying") ?? (() => {});
new Setting(containerEl).setName("Expand repair preview").setDesc("Show before and after text immediately. Every repair still asks you to confirm its credit cost.").addToggle((toggle) => toggle.setValue(this.plugin.settings.reviewBeforeApply).onChange(async (value) => {
return diagnostics.guard("main.control_42", async () => {
const diagnosticEnd60 = diagnostics?.start?.("control.review_repairs_before_applying.onChange") ?? (() => {});
try {
 this.plugin.settings.reviewBeforeApply = value; await this.plugin.saveData(this.plugin.settings);
} catch (diagnosticError60) { diagnostics?.failure?.("control.review_repairs_before_applying.onChange", diagnosticError60); throw diagnosticError60; } finally { diagnosticEnd60(); }

});
}));
diagnosticStage39();

    const diagnosticStage40 = diagnostics?.start?.("settings.render.default_report_format") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Default report format").setDesc("Used by the Export report button; change it here instead of choosing a format every time.").addDropdown((dropdown) => dropdown.addOptions({ markdown: "Markdown", csv: "CSV", json: "JSON" }).setValue(this.plugin.settings.defaultReportFormat).onChange(async (value) => {
return diagnostics.guard("main.control_43", async () => {
const diagnosticEnd61 = diagnostics?.start?.("control.default_report_format.onChange") ?? (() => {});
try {
 this.plugin.settings.defaultReportFormat = value as "markdown" | "csv" | "json"; await this.plugin.saveData(this.plugin.settings);
} catch (diagnosticError61) { diagnostics?.failure?.("control.default_report_format.onChange", diagnosticError61); throw diagnosticError61; } finally { diagnosticEnd61(); }

});
}));
diagnosticStage40();

    const diagnosticStage41 = diagnostics?.start?.("settings.render.billing") ?? (() => {});
new Setting(containerEl).setName("Billing").setHeading();
diagnosticStage41();

    const diagnosticStage42 = diagnostics?.start?.("settings.render.stage_4") ?? (() => {});
containerEl.createEl("p",{text:"Scan and review repairs locally without an account. Connect your account to apply repairs. Verified accounts receive five free repair credits on their account. Each credit covers up to five files and 20 edits; larger batches use more credits. Restore and rollback are free."});
diagnosticStage42();

    const billingSummary = containerEl.createEl("p", {cls:"cairn-billing-summary",attr:{role:"status","aria-live":"polite"}});
    const renderBillingSummary = () => {
const diagnosticAction62 = () => {

      const used = Math.min(5, Math.max(0, this.plugin.settings.freeRepairBatchesUsed));
      billingSummary.setText(!this.plugin.settings.billingAccountLinked || !this.plugin.settings.billingAccessToken ? "Create an account or sign in, then Connect to load your free and purchased credits." : `Free repair credits used: ${used}/5 (last updated balance) · Purchased balance: ${Math.max(0, this.plugin.settings.purchasedRepairBatches).toLocaleString()} credits`);

}; return diagnostics?.run ? diagnostics.run("main.renderBillingSummary", diagnosticAction62) : diagnosticAction62();
};
    const diagnosticStage43 = diagnostics?.start?.("settings.render.stage_5") ?? (() => {});
this.plugin.billingSummaryRefresh = renderBillingSummary;
diagnosticStage43();

    const diagnosticStage44 = diagnostics?.start?.("settings.render.stage_6") ?? (() => {});
renderBillingSummary();
diagnosticStage44();

    const diagnosticStage45 = diagnostics?.start?.("settings.render.catalog") ?? (() => {});
void diagnostics.guard("main.background_44", () => (renderNativePacks(containerEl,{app:this.app,settings:this.plugin.settings,persistNative:()=>this.plugin.persistBillingSettings()},"cairn-vault-linter",priceId=>import("./billing").then(({openPriceCheckout})=>openPriceCheckout(this.plugin,priceId)))));
diagnosticStage45();

    const diagnosticStage46 = diagnostics?.start?.("settings.render.account") ?? (() => {});
addBillingAccountSettings(containerEl, { state: this.plugin.settings, appId: "cairn-vault-linter", installationId: this.plugin.settings.constanceDeviceId, appVersion: this.plugin.manifest.version, persist: () => this.plugin.persistBillingSettings(), syncBalance: () => syncBalance(this.plugin), refresh: () => this.display() });
diagnosticStage46();




    const diagnosticStage47 = diagnostics?.start?.("settings.render.refresh_balance") ?? (() => {});
new Setting(containerEl).setName("Refresh balance").setDesc("Sync purchased repair credits for your connected account.").addButton((button) => button.setButtonText("Refresh balance").onClick(async () => {
return diagnostics.guard("main.control_45", async () => {
const diagnosticEnd63 = diagnostics?.start?.("control.refresh_balance.onClick") ?? (() => {});
try {
 button.setDisabled(true); button.setButtonText("Refreshing…"); try { await syncBalance(this.plugin, undefined, true); renderBillingSummary(); } catch (caughtError46) {
diagnostics.failure("main.caught_47", caughtError46); new Notice("Balance could not be refreshed. Check your connection and retry."); } finally { button.setDisabled(false); button.setButtonText("Refresh balance"); }
} catch (diagnosticError63) { diagnostics?.failure?.("control.refresh_balance.onClick", diagnosticError63); throw diagnosticError63; } finally { diagnosticEnd63(); }

});
}));
diagnosticStage47();

    const diagnosticStage48 = diagnostics?.start?.("settings.render.stage_7") ?? (() => {});
void diagnostics.guard("main.background_48", () => ((this.plugin.settings.billingAccountLinked && this.plugin.settings.billingAccessToken ? syncBalance(this.plugin, undefined, true) : Promise.resolve()).then(renderBillingSummary).catch((rejectedError1) => {
diagnostics.failure("main.rejected_2", rejectedError1); billingSummary.setText("Balance unavailable. Refresh to retry."); })));
diagnosticStage48();

    const diagnosticStage49 = diagnostics?.start?.("settings.render.stage_8") ?? (() => {});
if (advanced) containerEl.createEl("h3", { text: "Checks" });
diagnosticStage49();

    const diagnosticStage50 = diagnostics?.start?.("settings.render.stage_9") ?? (() => {});
if (advanced) (Object.keys(DEFAULT_CHECKS) as FindingType[]).forEach((type) => new Setting(containerEl).setName(FINDING_LABELS[type]).setDesc("Include this check in the next scan. Findings explain the issue before any repair.").addToggle((toggle) => toggle.setValue(this.plugin.settings.checks[type]).onChange(async (value) => {
return diagnostics.guard("main.control_49", async () => {
const diagnosticEnd64 = diagnostics?.start?.("control.40380.onChange") ?? (() => {});
try {
 this.plugin.settings.checks[type] = value; await this.plugin.saveData(this.plugin.settings);
} catch (diagnosticError64) { diagnostics?.failure?.("control.40380.onChange", diagnosticError64); throw diagnosticError64; } finally { diagnosticEnd64(); }

});
})));
diagnosticStage50();

    const diagnosticStage51 = diagnostics?.start?.("settings.render.ignored_folders") ?? (() => {});
new Setting(containerEl).setName("Ignored folders").setDesc("One vault-relative folder per line, for example Templates or Private.").addTextArea((text) => text.setValue(this.plugin.settings.ignoredFolders).onChange(async (value) => {
return diagnostics.guard("main.control_50", async () => {
const diagnosticEnd65 = diagnostics?.start?.("control.ignored_folders.onChange") ?? (() => {});
try {
 this.plugin.settings.ignoredFolders = value; await this.plugin.saveData(this.plugin.settings);
} catch (diagnosticError65) { diagnostics?.failure?.("control.ignored_folders.onChange", diagnosticError65); throw diagnosticError65; } finally { diagnosticEnd65(); }

});
}));
diagnosticStage51();

    const diagnosticStage52 = diagnostics?.start?.("settings.render.ignored_file_patterns") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Ignored file patterns").setDesc("Simple * wildcards, one per line; for example Templates/**.").addTextArea((text) => text.setValue(this.plugin.settings.ignoredPatterns).onChange(async (value) => {
return diagnostics.guard("main.control_51", async () => {
const diagnosticEnd66 = diagnostics?.start?.("control.ignored_file_patterns.onChange") ?? (() => {});
try {
 this.plugin.settings.ignoredPatterns = value; await this.plugin.saveData(this.plugin.settings);
} catch (diagnosticError66) { diagnostics?.failure?.("control.ignored_file_patterns.onChange", diagnosticError66); throw diagnosticError66; } finally { diagnosticEnd66(); }

});
}));
diagnosticStage52();

    const diagnosticStage53 = diagnostics?.start?.("settings.render.scan_hidden_files") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Scan hidden files").setDesc("Include files whose names begin with a dot. Off by default.").addToggle((toggle) => toggle.setValue(this.plugin.settings.scanHiddenFiles).onChange(async (value) => {
return diagnostics.guard("main.control_52", async () => {
const diagnosticEnd67 = diagnostics?.start?.("control.scan_hidden_files.onChange") ?? (() => {});
try {
 this.plugin.settings.scanHiddenFiles = value; await this.plugin.saveData(this.plugin.settings);
} catch (diagnosticError67) { diagnostics?.failure?.("control.scan_hidden_files.onChange", diagnosticError67); throw diagnosticError67; } finally { diagnosticEnd67(); }

});
}));
diagnosticStage53();

    const diagnosticStage54 = diagnostics?.start?.("settings.render.scan_non_markdown_files") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Scan non-Markdown files").setDesc("Include local attachments in broken-embed checks; note contents remain Markdown-only.").addToggle((toggle) => toggle.setValue(this.plugin.settings.scanNonMarkdownFiles).onChange(async (value) => {
return diagnostics.guard("main.control_53", async () => {
const diagnosticEnd68 = diagnostics?.start?.("control.scan_non_markdown_files.onChange") ?? (() => {});
try {
 this.plugin.settings.scanNonMarkdownFiles = value; await this.plugin.saveData(this.plugin.settings);
} catch (diagnosticError68) { diagnostics?.failure?.("control.scan_non_markdown_files.onChange", diagnosticError68); throw diagnosticError68; } finally { diagnosticEnd68(); }

});
}));
diagnosticStage54();

    const diagnosticStage55 = diagnostics?.start?.("settings.render.nearly_empty_maximum_characters") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Nearly empty maximum characters").setDesc("Notes at or below this character count may be nearly empty.").addDropdown((dropdown) => dropdown.addOptions({ [String(this.plugin.settings.emptyStubMaxCharacters)]: `${this.plugin.settings.emptyStubMaxCharacters} · current`, "60": "60 · short notes", "120": "120 · recommended", "240": "240 · longer notes"}).setValue(String(this.plugin.settings.emptyStubMaxCharacters)).onChange(async (value) => {
return diagnostics.guard("main.control_54", async () => {
const diagnosticEnd69 = diagnostics?.start?.("control.nearly_empty_maximum_characters.onChange") ?? (() => {});
try {
 this.plugin.settings.emptyStubMaxCharacters = Number(value); await this.plugin.saveData(this.plugin.settings);
} catch (diagnosticError69) { diagnostics?.failure?.("control.nearly_empty_maximum_characters.onChange", diagnosticError69); throw diagnosticError69; } finally { diagnosticEnd69(); }

});
}));
diagnosticStage55();

    const diagnosticStage56 = diagnostics?.start?.("settings.render.nearly_empty_maximum_meaningful_lines") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Nearly empty maximum meaningful lines").setDesc("Ignore blank lines and frontmatter when identifying nearly empty notes.").addDropdown((dropdown) => dropdown.addOptions({ [String(this.plugin.settings.emptyStubMaxMeaningfulLines)]: `${this.plugin.settings.emptyStubMaxMeaningfulLines} · current`, "1": "1 line", "3": "3 lines · recommended", "5": "5 lines"}).setValue(String(this.plugin.settings.emptyStubMaxMeaningfulLines)).onChange(async (value) => {
return diagnostics.guard("main.control_55", async () => {
const diagnosticEnd70 = diagnostics?.start?.("control.nearly_empty_maximum_meaningful_lines.onChange") ?? (() => {});
try {
 this.plugin.settings.emptyStubMaxMeaningfulLines = Number(value); await this.plugin.saveData(this.plugin.settings);
} catch (diagnosticError70) { diagnostics?.failure?.("control.nearly_empty_maximum_meaningful_lines.onChange", diagnosticError70); throw diagnosticError70; } finally { diagnosticEnd70(); }

});
}));
diagnosticStage56();

    const diagnosticStage57 = diagnostics?.start?.("settings.render.report_folder") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Report folder").setDesc("Vault-relative folder for exported reports.").addText((text) => text.setValue(this.plugin.settings.reportFolder).onChange(async (value) => {
return diagnostics.guard("main.control_56", async () => {
const diagnosticEnd71 = diagnostics?.start?.("control.report_folder.onChange") ?? (() => {});
try {
 this.plugin.settings.reportFolder = value; await this.plugin.saveData(this.plugin.settings);
} catch (diagnosticError71) { diagnostics?.failure?.("control.report_folder.onChange", diagnosticError71); throw diagnosticError71; } finally { diagnosticEnd71(); }

});
}));
diagnosticStage57();

    containerEl.createEl("h3", { text: "Saved ignore rules" });
    if (!this.plugin.settings.ignoredFindings.length) containerEl.createEl("p", { text: "No saved ignore rules." });
    this.plugin.settings.ignoredFindings.forEach(rule => {
      new Setting(containerEl).setName(`${rule.scope}: ${rule.key}`).setDesc(rule.reason).addButton(button => button.setButtonText("Remove").onClick(async () => {
        this.plugin.settings.ignoredFindings = this.plugin.settings.ignoredFindings.filter(item => item !== rule);
        await this.plugin.refreshIgnoreRules();
        this.display();
      }));
    });

    const diagnosticStage58 = diagnostics?.start?.("settings.render.reset_cairn_settings") ?? (() => {});
if (advanced) new Setting(containerEl).setName("Reset Cairn settings").setDesc("Restore default checks and folders; ignored findings are also cleared. Billing identity and balance settings are preserved.").addButton((button) => button.setButtonText("Reset").onClick(async () => {
return diagnostics.guard("main.control_57", async () => {
const diagnosticEnd72 = diagnostics?.start?.("control.reset_cairn_settings.onClick") ?? (() => {});
try {
 const billing = Object.fromEntries(Object.entries(this.plugin.settings).filter(([key]) => /^(?:billing|constance|freeRepair|purchasedRepair|pending|recovered)/.test(key))); this.plugin.settings = { ...mergeSettings(null), ...billing }; await this.plugin.refreshIgnoreRules(); this.display(); new Notice("Cairn settings reset.");
} catch (diagnosticError72) { diagnostics?.failure?.("control.reset_cairn_settings.onClick", diagnosticError72); throw diagnosticError72; } finally { diagnosticEnd72(); }

});
}));
diagnosticStage58();


}; return diagnostics?.run ? diagnostics.run("settings.open", diagnosticAction32) : diagnosticAction32();

});
}

  hide(): void { const end = diagnostics?.start?.("settings.close") ?? (() => {}); try { super.hide(); } finally { end(); } }
}
