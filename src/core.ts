import { diagnostics } from "./diagnostics.ts";
import type {
  CairnSettings,
  Finding,
  FindingType,
  ScanError,
  ScanProgress,
  ScanResult,
  Severity,
  VaultFileRecord
} from "./types";

export interface VaultReader {
  getFiles(): VaultFileRecord[];
  read(file: VaultFileRecord): Promise<string>;
  resolveWikiPath?(target: string, sourcePath: string): string | undefined;
}

interface Heading {
  text: string;
  id: string;
  line: number;
}

interface Block {
  id: string;
  line: number;
}

interface NoteIndex {
  file: VaultFileRecord;
  content: string;
  headings: Heading[];
  blocks: Block[];
  aliases: string[];
  outgoing: ParsedLink[];
}

interface ParsedLink {
  kind: "wiki" | "markdown";
  embed: boolean;
  raw: string;
  target: string;
  display: string;
  path: string;
  fragment: string;
  fragmentKind: "heading" | "block" | "none";
  line: number;
  start: number;
  end: number;
  section: string;
}

const EXTERNAL_TARGET = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
const SAFE_TARGET = /^[^\u0000-\u001f<>|]+$/;

export function normalizePath(path: string): string {
  const parts: string[] = [];
  path.replace(/\\/g, "/").replace(/^\/+/, "").split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") { parts.pop(); return; }
    parts.push(part);
  });
  return parts.join("/").replace(/\/$/, "").toLowerCase();
}

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function slugifyHeading(value: string): string {
  return normalizeText(value).replace(/[?.,:;!()[\]{}'"`]/g, "").replace(/\s+/g, "-");
}

export function fileSignature(file: VaultFileRecord): string {
  return `${file.mtime}:${file.size}`;
}

function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function currentSection(lines: string[], lineIndex: number): string {
  for (let i = lineIndex; i >= 0; i--) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (match) return match[2].replace(/\s+#+\s*$/, "").trim();
  }
  return "(document)";
}

function parseAliases(content: string): string[] {
  const frontmatter = /^(?:---|\+\+\+)\r?\n([\s\S]*?)\r?\n(?:---|\+\+\+)(?:\r?\n|$)/.exec(content);
  if (!frontmatter) return [];
  const aliases: string[] = [];
  const lines = frontmatter[1].split(/\r?\n/);
  let inAliasList = false;
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const item = inAliasList && /^\s*-\s+(.+?)\s*$/.exec(line);
    if (item) {
      const raw = item[1];
      const quoted = /^(?:"((?:\\.|[^"\\])*)"|'((?:''|[^'])*)')(?:\s+#.*)?$/.exec(raw);
      const alias = quoted ? (quoted[1] ?? quoted[2].replace(/''/g, "'")) : raw.replace(/\s+#.*$/, "");
      if (alias) aliases.push(alias);
      continue;
    }
    inAliasList = false;
    const match = /^\s*(?:aliases?|alias)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const value = match[1].trim();
    inAliasList = !value || value.startsWith("#");
    if (inAliasList) continue;
    if (value.startsWith("[")) {
      aliases.push(...value.slice(1, value.lastIndexOf("]")).split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean));
    } else if (value) {
      aliases.push(value.replace(/^['"]|['"]$/g, ""));
    }
  }
  return aliases;
}

function parseHeadingsAndBlocks(content: string): { headings: Heading[]; blocks: Block[] } {
  const lines = splitLines(maskCode(content));
  const headings: Heading[] = [];
  const blocks: Block[] = [];
  lines.forEach((line, index) => {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const withoutId = heading[2].replace(/\s*\{#([^}]+)\}\s*$/, "").replace(/\s+#+\s*$/, "").trim();
      const custom = /\{#([^}]+)\}/.exec(heading[2]);
      headings.push({ text: withoutId, id: custom?.[1].trim().toLowerCase() || slugifyHeading(withoutId), line: index + 1 });
    }
    const blockMatches = [...line.matchAll(/\^([A-Za-z0-9][A-Za-z0-9_-]*)\s*$/g)];
    blockMatches.forEach((match) => blocks.push({ id: match[1].toLowerCase(), line: index + 1 }));
  });
  return { headings, blocks };
}

function stripMarkdownDestination(raw: string): string {
  let value = raw.trim();
  if (value.startsWith("<") && value.includes(">")) value = value.slice(1, value.indexOf(">"));
  // Markdown titles are outside the destination. This conservative split avoids
  // treating spaces in a path as a title unless the destination is quoted.
  const title = /^([^\s]+)\s+(?:["'].*["']|\(.*\))$/.exec(value);
  return (title?.[1] || value).replace(/\\([()])/g, "$1");
}

function parseTarget(target: string): Pick<ParsedLink, "path" | "fragment" | "fragmentKind"> {
  let value = target.trim();
  let fragment = "";
  let fragmentKind: ParsedLink["fragmentKind"] = "none";
  const hash = value.indexOf("#");
  const caret = value.indexOf("^");
  if (hash >= 0 && (caret < 0 || hash < caret)) {
    fragment = value.slice(hash + 1).trim();
    value = value.slice(0, hash).trim();
    fragmentKind = fragment.startsWith("^") ? "block" : "heading";
    if (fragmentKind === "block") fragment = fragment.slice(1);
  } else if (caret >= 0) {
    fragment = value.slice(caret + 1).trim();
    value = value.slice(0, caret).trim();
    fragmentKind = "block";
  }
  return { path: value, fragment, fragmentKind };
}

// Keep offsets and newlines intact so repairs still address the original text.
function maskCode(content: string): string {
  let fence = "";
  let length = 0;
  let inComment = false;
  return content.split(/(\r?\n)/).map(line => {
    if (/^\r?\n$/.test(line)) return line;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence && marker[1].length >= length && !marker[2].trim()) fence = "";
      return line.replace(/./g, " ");
    }
    if (!inComment && marker) { fence = marker[1][0]; length = marker[1].length; return line.replace(/./g, " "); }
    let visible = "";
    let offset = 0;
    while (offset < line.length) {
      if (inComment) {
        const close = line.indexOf("-->", offset);
        const end = close < 0 ? line.length : close + 3;
        visible += " ".repeat(end - offset);
        offset = end;
        inComment = close < 0;
        continue;
      }
      const tokens = /<!--|(`+)(.*?)\1(?!`)/g;
      tokens.lastIndex = offset;
      const token = tokens.exec(line);
      if (!token) return visible + line.slice(offset);
      visible += line.slice(offset, token.index) + " ".repeat(token[0].length);
      offset = tokens.lastIndex;
      inComment = token[0] === "<!--";
    }
    return visible;
  }).join("");
}

function markdownLinkEnd(text: string, start: number): number {
  let depth = 1;
  let delimiter = "";
  for (let i = start; i < text.length && text[i] !== "\n"; i++) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length && text[i + 1] !== "\n") { i++; continue; }
    if (delimiter) {
      if (ch === delimiter) delimiter = "";
    } else if (ch === "<" && !text.slice(start, i).trim()) {
      delimiter = ">";
    } else if ((ch === '"' || ch === "'") && /\s/.test(text[i - 1])) {
      delimiter = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")" && --depth === 0) {
      return i + 1;
    }
  }
  return -1;
}

function parseLinks(content: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  const lines = splitLines(content);
  const addLink = (link: Omit<ParsedLink, "line" | "section">, offset: number) => {
    const line = content.slice(0, offset).split(/\r?\n/).length;
    links.push({ ...link, line, section: currentSection(lines, line - 1) });
  };
  const masked = maskCode(content);
  const wiki = /(!?)\[\[([^\]\n]+)\]\]/g;
  for (const match of masked.matchAll(wiki)) {
    const raw = content.slice(match.index, (match.index || 0) + match[0].length);
    const inner = raw.slice(match[1].length + 2, -2).trim();
    const parts = inner.split("|");
    const target = parts.shift()?.trim() || "";
    const parsed = parseTarget(target);
    addLink({ kind: "wiki", embed: match[1] === "!", raw, target, display: parts.join("|").trim(), ...parsed, start: match.index || 0, end: (match.index || 0) + raw.length }, match.index || 0);
  }
  const markdown = /(!?)\[([^\]\n]*)\]\(/g;
  let match: RegExpExecArray | null;
  while ((match = markdown.exec(masked))) {
    const end = markdownLinkEnd(masked, markdown.lastIndex);
    if (end < 0) continue;
    markdown.lastIndex = end;
    const raw = content.slice(match.index, end);
    const labelStart = match[1].length + 1;
    const labelEnd = labelStart + match[2].length;
    const display = raw.slice(labelStart, labelEnd);
    const target = stripMarkdownDestination(raw.slice(labelEnd + 2, -1));
    const parsed = parseTarget(target);
    addLink({ kind: "markdown", embed: match[1] === "!", raw, target, display, ...parsed, start: match.index || 0, end: (match.index || 0) + raw.length }, match.index || 0);
  }
  return links.sort((a, b) => a.start - b.start);
}

function malformedLinkFinding(sourcePath: string, content: string, line: number, raw: string, explanation: string): Finding {
  return makeFinding("malformed-link", "medium", sourcePath, line, "(document)", raw, explanation, false, surroundingText(content, line));
}

function surroundingText(content: string, line: number): string {
  const lines = splitLines(content);
  return lines.slice(Math.max(0, line - 2), Math.min(lines.length, line + 1)).map((value, index) => `${Math.max(1, line - 1) + index}: ${value}`).join("\n");
}

function makeFinding(type: FindingType, severity: Severity, sourcePath: string, line: number, section: string, target: string, explanation: string, resolved: boolean, context = ""): Finding {
  const id = `${type}|${normalizePath(sourcePath)}|${line}|${normalizeText(target)}|${normalizeText(context)}`;
  return { id, type, severity, sourcePath, line, section, context, target, explanation, resolved };
}

function pathWithoutExtension(path: string): string {
  return path.replace(/\.[^/.]+$/, "");
}

function matchesPattern(path: string, pattern: string): boolean {
  const normalized = normalizePath(path);
  const p = normalizePath(pattern.trim());
  if (!p) return false;
  const regex = new RegExp(`^${p.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
  return regex.test(normalized);
}

function isIgnoredPath(path: string, settings: CairnSettings): boolean {
  const normalized = normalizePath(path);
  const folders = settings.ignoredFolders.split(/\r?\n|,/).map((value) => normalizePath(value)).filter(Boolean);
  if (folders.some((folder) => normalized === folder || normalized.startsWith(`${folder}/`))) return true;
  return settings.ignoredPatterns.split(/\r?\n|,/).some((pattern) => matchesPattern(normalized, pattern));
}

function isHidden(path: string): boolean {
  return normalizePath(path).split("/").some((part) => part.startsWith("."));
}

function resolveNote(path: string, source: VaultFileRecord, byPath: Map<string, NoteIndex>, byBasename: Map<string, NoteIndex[]>, byAlias: Map<string, NoteIndex[]>): NoteIndex | undefined {
  const raw = path.trim();
  if (!raw) return byPath.get(normalizePath(source.path));
  if (!raw.includes("/")) {
    const local = normalizePath(`${sourceFolder(source.path)}/${raw}`);
    const sibling = byPath.get(local) || byPath.get(`${local}.md`);
    if (sibling) return sibling;
  }
  const relative = /^\.\.?\//.test(raw);
  const key = normalizePath(relative ? `${sourceFolder(source.path)}/${raw}` : raw);
  const direct = byPath.get(key) || byPath.get(`${key}.md`);
  if (direct || raw.includes("/")) return direct;
  return byBasename.get(normalizeText(raw.replace(/\.md$/i, "")))?.[0] || byAlias.get(normalizeText(raw))?.[0];
}

function resolveAnyFile(path: string, source: VaultFileRecord, files: Map<string, VaultFileRecord>): VaultFileRecord | undefined {
  const raw = path.trim().replace(/^\//, "");
  if (!raw) return undefined;
  const relative = normalizePath(`${source.path.split("/").slice(0, -1).join("/")}/${raw}`);
  if (path.startsWith("/")) return files.get(normalizePath(raw));
  if (/^\.\.?\//.test(raw)) return files.get(relative);
  const direct = files.get(relative) || files.get(normalizePath(raw));
  if (direct || raw.includes("/")) return direct;
  const matches = [...files.values()].filter(file => normalizePath(file.path.split("/").pop() || "") === normalizePath(raw));
  return matches.length === 1 ? matches[0] : undefined;
}

function cleanMeaningfulText(content: string): { text: string; lines: number } {
  const withoutFrontmatter = content.replace(/^(?:---|\+\+\+)\r?\n[\s\S]*?\r?\n(?:---|\+\+\+)\r?\n/, "");
  const meaningful = withoutFrontmatter.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^<!--.*-->$/.test(line) && !/^#{1,6}\s*$/.test(line));
  return { text: meaningful.join(" ").replace(/[`*_>#\[\]{}]/g, "").trim(), lines: meaningful.length };
}

function attachRepair(finding: Finding, link: ParsedLink, before: string, after: string): void {
  finding.repair = { label: "Apply exact link repair", before, after, start: link.start, end: link.end };
}

export function scanSettingsKey(settings: CairnSettings): string {
  return JSON.stringify({ checks: Object.entries(settings.checks).sort(), ignoredFolders: settings.ignoredFolders, ignoredPatterns: settings.ignoredPatterns, scanHiddenFiles: settings.scanHiddenFiles, scanNonMarkdownFiles: settings.scanNonMarkdownFiles, emptyStubMaxCharacters: settings.emptyStubMaxCharacters, emptyStubMaxMeaningfulLines: settings.emptyStubMaxMeaningfulLines });
}

export function sourceFolder(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

export function ignoreRuleMatches(finding: Finding, item: CairnSettings["ignoredFindings"][number]): boolean {
  if (item.scope === "finding") return item.key === finding.id;
  if (item.scope === "source") return item.key === finding.sourcePath;
  return item.key === "/" ? !finding.sourcePath.includes("/") : finding.sourcePath === item.key || finding.sourcePath.startsWith(`${item.key}/`);
}

export function scanVault(reader: VaultReader, settings: CairnSettings, scopePaths?: string[], incremental = false, signal?: AbortSignal, onProgress?: (progress: ScanProgress) => void, previousFindings: Finding[] = [], baseline?: ScanResult | null): Promise<ScanResult> {
  const started = Date.now();
  settings = { ...settings, checks: { ...settings.checks }, ignoredFindings: [...settings.ignoredFindings] };
  return (async () => {
    // Keep all eligible files in the target index so a Markdown note can
    // resolve an existing attachment even when attachment contents are not
    // selected for scanning. The scan list is a separate concern.
    const allFiles = reader.getFiles().filter((file) => !isIgnoredPath(file.path, settings) && (settings.scanHiddenFiles || !isHidden(file.path)));
    const scanFiles = allFiles.filter((file) => settings.scanNonMarkdownFiles || file.extension.toLowerCase() === "md");
    const selected = scopePaths !== undefined ? scanFiles.filter((file) => scopePaths.includes(file.path)) : scanFiles;
    const selectedPaths = new Set(selected.map((file) => file.path));
    const errors: ScanError[] = [];
    const signatures: Record<string, string> = {};
    allFiles.forEach((file) => signatures[file.path] = fileSignature(file));
    const noteFiles = allFiles.filter((file) => file.extension.toLowerCase() === "md");
    const reports = new Set<string>();
    const byPath = new Map<string, NoteIndex>();
    const byBasename = new Map<string, NoteIndex[]>();
    const byAlias = new Map<string, NoteIndex[]>();
    const settingsKey = scanSettingsKey(settings);
    const changedOnly = incremental && scopePaths === undefined && baseline?.scope?.kind === "vault" && baseline.settingsKey === settingsKey && !!baseline.dependencySignatures && !baseline.errors.length;
    const scope = { kind: scopePaths === undefined ? "vault" as const : "selection" as const, paths: selected.map(file => file.path).sort() };
    const comparisonKey = JSON.stringify([scope.kind, scope.kind === "selection" ? scope.paths : [], settingsKey, settings.ignoredFindings]);
    let scanned = 0;
    onProgress?.({ phase: "indexing", currentPath: "", scanned: 0, total: selected.length, findings: 0 });
    // Every target needs current headings, blocks and aliases, including
    // unchanged notes used by links in the selected scan scope.
    for (const file of noteFiles) {
      if (signal?.aborted) return { findings: [], errors, filesScanned: scanned, durationMs: Date.now() - started, cancelled: true, signatures };
      try {
        const content = await reader.read(file);
        const isReport = /^# Cairn Vault Linter report\r?\n\r?\n- Scanned: [^\n]*\n- Scope: /.test(content);
        if (isReport) reports.add(file.path);
        const parsed = parseHeadingsAndBlocks(content);
        const index: NoteIndex = { file: { ...file, content }, content, ...parsed, aliases: parseAliases(content), outgoing: isReport ? [] : parseLinks(content) };
        byPath.set(normalizePath(file.path), index);
        const basenameKey = normalizeText(file.basename || pathWithoutExtension(file.path.split("/").pop() || ""));
        byBasename.set(basenameKey, [...(byBasename.get(basenameKey) || []), index]);
        index.aliases.forEach((alias) => byAlias.set(normalizeText(alias), [...(byAlias.get(normalizeText(alias)) || []), index]));
        onProgress?.({ phase: "reading", currentPath: file.path, scanned, total: selected.length, findings: 0 });
      } catch (error) {
diagnostics.failure("core.caught_1", error);
        errors.push({ path: file.path, message: error instanceof Error ? error.message : String(error) });
      }
      await Promise.resolve();
    }
    const readableFiles = new Map<string, VaultFileRecord>(allFiles.map((file) => [normalizePath(file.path), file]));

    const incoming = new Map<string, number>();
    const linkTargets = new Map<ParsedLink, VaultFileRecord>();
    byPath.forEach((note) => note.outgoing.forEach((link) => {
      if (EXTERNAL_TARGET.test(link.path)) return;
      let target: VaultFileRecord | undefined;
      if (link.kind === "wiki") {
        const nativePath = link.path && reader.resolveWikiPath?.(link.path, note.file.path);
        target = (nativePath ? readableFiles.get(normalizePath(nativePath)) : undefined)
          || resolveNote(link.path, note.file, byPath, byBasename, byAlias)?.file
          || resolveAnyFile(link.path, note.file, readableFiles);
      } else {
        let path = link.path;
        try { path = decodeURIComponent(path); } catch { /* Use the literal path. */ }
        target = !path && link.fragmentKind !== "none" ? note.file : resolveAnyFile(path, note.file, readableFiles);
      }
      if (target) {
        linkTargets.set(link, target);
        incoming.set(target.path, (incoming.get(target.path) || 0) + 1);
      }
    }));
    const blockOccurrences = new Map<string, Array<{ note: NoteIndex; block: Block }>>();
    const headingOccurrences = new Map<string, Array<{ note: NoteIndex; heading: Heading }>>();
    byPath.forEach((note) => {
      if (reports.has(note.file.path)) return;
      note.blocks.forEach((block) => blockOccurrences.set(block.id, [...(blockOccurrences.get(block.id) || []), { note, block }]));
      note.headings.forEach((heading) => {
        const key = `${normalizePath(note.file.path)}|${heading.id}`;
        headingOccurrences.set(key, [...(headingOccurrences.get(key) || []), { note, heading }]);
      });
    });
    const dependencySignatures: Record<string, string> = {};
    byPath.forEach(note => {
      const targets = note.outgoing.map(link => {
        if (EXTERNAL_TARGET.test(link.path)) return "external";
        const target = linkTargets.get(link);
        return target ? [target.path, signatures[target.path]] : null;
      });
      dependencySignatures[note.file.path] = JSON.stringify([targets, incoming.get(note.file.path) || 0, note.blocks.map(block => [block.id, blockOccurrences.get(block.id)?.length || 0])]);
    });
    if (changedOnly && baseline) {
      selectedPaths.clear();
      selected.forEach(file => {
        if (baseline.signatures[file.path] !== signatures[file.path] || baseline.dependencySignatures?.[file.path] !== dependencySignatures[file.path]) selectedPaths.add(file.path);
      });
    }
    const findings: Finding[] = changedOnly ? previousFindings.filter(finding => !selectedPaths.has(finding.sourcePath) && signatures[finding.sourcePath] !== undefined) : [];
    for (const path of reports) selectedPaths.delete(path);
    for (const [id, occurrences] of blockOccurrences) {
      if (occurrences.length < 2 || !settings.checks["duplicate-block-id"]) continue;
      occurrences.forEach(({ note, block }) => {
        if (!selectedPaths.has(note.file.path)) return;
        findings.push(makeFinding("duplicate-block-id", "high", note.file.path, block.line, currentSection(splitLines(note.content), block.line - 1), `^${id}`, `Block ID ^${id} is repeated ${occurrences.length} times in the vault and may resolve ambiguously.`, false));
      });
    }
    byPath.forEach((note) => {
      if (!selectedPaths.has(note.file.path)) return;
      scanned++;
      if (settings.checks["duplicate-heading-id"]) {
        const seen = new Map<string, Heading[]>();
        note.headings.forEach((heading) => seen.set(heading.id, [...(seen.get(heading.id) || []), heading]));
        seen.forEach((headings, id) => {
          if (headings.length < 2) return;
          headings.forEach((heading) => findings.push(makeFinding("duplicate-heading-id", "medium", note.file.path, heading.line, heading.text, `#${id}`, `Heading anchor #${id} is produced more than once in this note.`, false)));
        });
      }
      if (settings.checks["malformed-link"]) {
        splitLines(maskCode(note.content)).forEach((line, index) => {
          if (line.includes("[[") && !line.includes("]]")) findings.push(malformedLinkFinding(note.file.path, note.content, index + 1, line.trim(), "This wikilink is not closed before the end of the line."));
          if (line.includes("](") && !line.includes(")")) findings.push(malformedLinkFinding(note.file.path, note.content, index + 1, line.trim(), "This Markdown link is not closed before the end of the line."));
        });
      }
      const seenLinks = new Map<string, ParsedLink[]>();
      const duplicateIds = new Set<string>();
      note.outgoing.forEach((link) => {
        const malformed = !link.target || !SAFE_TARGET.test(link.target) || (link.kind === "wiki" && /[\[\]]/.test(link.target));
        const context = surroundingText(note.content, link.line);
        if (malformed && settings.checks["malformed-link"]) findings.push(malformedLinkFinding(note.file.path, note.content, link.line, link.raw, "This link target contains unsupported or malformed characters and cannot be resolved safely."));
        if (EXTERNAL_TARGET.test(link.path)) return;
        let decodedFragment = link.fragment;
        if (link.kind === "markdown") {
          try { decodedFragment = decodeURIComponent(link.fragment); } catch { /* Use the literal fragment. */ }
        }
        const resolution = linkTargets.get(link);
        const targetNote = resolution ? byPath.get(normalizePath(resolution.path)) : undefined;
        if (!resolution) {
          if (link.embed && settings.checks["broken-embed"]) findings.push(makeFinding("broken-embed", "high", note.file.path, link.line, link.section, link.target, "This embedded note or local attachment does not exist in the vault.", false, context));
          else if (link.kind === "wiki" && /\s/.test(link.path) && settings.checks["missing-alias"]) findings.push(makeFinding("missing-alias", "medium", note.file.path, link.line, link.section, link.target, "No note exposes this text as an alias, and no matching note path was found.", false, context));
          else if (settings.checks[link.kind === "wiki" ? "broken-wikilink" : "broken-markdown-link"]) findings.push(makeFinding(link.kind === "wiki" ? "broken-wikilink" : "broken-markdown-link", "high", note.file.path, link.line, link.section, link.target, link.kind === "wiki" ? "The wikilink target does not resolve to a note." : "The Markdown link target does not resolve to a vault file.", false, context));
        } else if (link.fragmentKind !== "none" && targetNote) {
          const fragment = normalizeText(decodedFragment);
          if (link.fragmentKind === "block") {
            const exists = targetNote?.blocks.some((block) => block.id === fragment);
            if (!exists && settings.checks["missing-block-id"]) findings.push(makeFinding("missing-block-id", "high", note.file.path, link.line, link.section, link.target, `Block ID ^${link.fragment} does not exist in the target note.`, false, context));
          } else {
            const exists = targetNote?.headings.some((heading) => heading.id === fragment || normalizeText(heading.text) === fragment);
            if (!exists && settings.checks["missing-heading"]) findings.push(makeFinding("missing-heading", "medium", note.file.path, link.line, link.section, link.target, `Heading #${link.fragment} does not exist in the target note.`, false, context));
          }
        }
        const resolvedPath = resolution?.path ?? link.path;
        const canonical = `${link.embed}|${resolvedPath}|${link.fragmentKind}|${normalizeText(link.fragment)}`;
        seenLinks.set(canonical, [...(seenLinks.get(canonical) || []), link]);
        const duplicateGroup = seenLinks.get(canonical);
        if (duplicateGroup && duplicateGroup.length > 1 && settings.checks["duplicate-link"]) {
          const first = duplicateGroup[0];
          const duplicate = makeFinding("duplicate-link", "low", note.file.path, link.line, link.section, link.target, `This link repeats the same target already linked at line ${first.line}.`, true, context);
          if (duplicateIds.has(duplicate.id)) duplicate.id += `|offset:${link.start}`;
          duplicateIds.add(duplicate.id);
          // Repeated links can have different purposes. Only unwrap an exact,
          // adjacent repeat, retaining its visible text and every embed.
          const previous = duplicateGroup[duplicateGroup.length - 2];
          if (!link.embed && previous.raw === link.raw && /^[ \t]+$/.test(note.content.slice(previous.end, link.start))) {
            attachRepair(duplicate, link, link.raw, link.display || link.path || link.fragment);
          }
          findings.push(duplicate);
        }
      });
      if (settings.checks["empty-stub"]) {
        const clean = cleanMeaningfulText(note.content);
        const isStub = clean.text.length <= settings.emptyStubMaxCharacters && clean.lines <= settings.emptyStubMaxMeaningfulLines && (incoming.get(note.file.path) || 0) === 0 && note.outgoing.length === 0;
        if (isStub) findings.push(makeFinding("empty-stub", "low", note.file.path, 1, "(document)", note.file.path, "This Markdown note is empty or nearly empty and has no detected incoming or outgoing links.", false, clean.text || "(no meaningful text)"));
      }
      onProgress?.({ phase: "checking", currentPath: note.file.path, scanned, total: selectedPaths.size, findings: findings.length });
    });
    const unique = new Map<string, Finding>();
    findings.forEach((finding) => unique.set(finding.id, finding));
    const resultFindings = [...unique.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.line - b.line || a.type.localeCompare(b.type));
    onProgress?.({ phase: "complete", currentPath: "", scanned, total: selectedPaths.size, findings: resultFindings.length });
    return { findings: resultFindings, errors, filesScanned: scanned, durationMs: Date.now() - started, cancelled: false, signatures, scope, comparisonKey, settingsKey, dependencySignatures, notesIndexed: byPath.size, incremental: !!changedOnly };
  })();
}

export function applyIgnoredFindings(findings: Finding[], ignored: CairnSettings["ignoredFindings"]): Finding[] {
  return findings.map((finding) => {
    const match = ignored.find(item => ignoreRuleMatches(finding, item));
    const { ignored: oldIgnored, ignoredReason: oldReason, ...clean } = finding;
    return match ? { ...clean, ignored: true, ignoredReason: match.reason } : clean;
  });
}

export function findingCounts(findings: Finding[]): { total: number; high: number; ignored: number } {
  return { total: findings.length, high: findings.filter((finding) => finding.severity === "high" && !finding.ignored).length, ignored: findings.filter((finding) => finding.ignored).length };
}
