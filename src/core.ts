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
  const frontmatter = /^(?:---|\+\+\+)\r?\n([\s\S]*?)\r?\n(?:---|\+\+\+)\r?\n/.exec(content);
  if (!frontmatter) return [];
  const aliases: string[] = [];
  const lines = frontmatter[1].split(/\r?\n/);
  for (const line of lines) {
    const match = /^\s*(?:aliases?|alias)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const value = match[1].trim();
    if (value.startsWith("[")) {
      aliases.push(...value.slice(1, value.lastIndexOf("]")).split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean));
    } else if (value) {
      aliases.push(value.replace(/^['"]|['"]$/g, ""));
    }
  }
  return aliases;
}

function parseHeadingsAndBlocks(content: string): { headings: Heading[]; blocks: Block[] } {
  const lines = splitLines(content);
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
  return title?.[1] || value;
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
    fragmentKind = "heading";
  } else if (caret >= 0) {
    fragment = value.slice(caret + 1).trim();
    value = value.slice(0, caret).trim();
    fragmentKind = "block";
  }
  return { path: value, fragment, fragmentKind };
}

function parseLinks(content: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  const lines = splitLines(content);
  const addLink = (link: Omit<ParsedLink, "line" | "section">, offset: number) => {
    const line = content.slice(0, offset).split(/\r?\n/).length;
    links.push({ ...link, line, section: currentSection(lines, line - 1) });
  };
  const wiki = /(!?)\[\[([^\]\n]+)\]\]/g;
  for (const match of content.matchAll(wiki)) {
    const raw = match[0];
    const inner = match[2].trim();
    const parts = inner.split("|");
    const target = parts.shift()?.trim() || "";
    const parsed = parseTarget(target);
    addLink({ kind: "wiki", embed: match[1] === "!", raw, target, display: parts.join("|").trim(), ...parsed, start: match.index || 0, end: (match.index || 0) + raw.length }, match.index || 0);
  }
  const markdown = /(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g;
  for (const match of content.matchAll(markdown)) {
    const raw = match[0];
    const target = stripMarkdownDestination(match[3]);
    const parsed = parseTarget(target);
    addLink({ kind: "markdown", embed: match[1] === "!", raw, target, display: match[2], ...parsed, start: match.index || 0, end: (match.index || 0) + raw.length }, match.index || 0);
  }
  return links.sort((a, b) => a.start - b.start);
}

function malformedLinkFinding(sourcePath: string, content: string, line: number, raw: string, explanation: string): Finding {
  return makeFinding("malformed-link", "medium", sourcePath, line, "(document)", raw, explanation, false, surroundingText(content, line));
}

function surroundingText(content: string, line: number): string {
  const lines = splitLines(content);
  return lines.slice(Math.max(0, line - 2), Math.min(lines.length, line + 1)).map((value, index) => `${Math.max(1, line - 1 + index)}: ${value}`).join("\n");
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
  const raw = path.trim().replace(/^\//, "");
  if (!raw) return byPath.get(normalizePath(source.path));
  const direct = byPath.get(normalizePath(raw)) || byPath.get(normalizePath(`${raw}.md`));
  if (direct) return direct;
  const relative = raw.startsWith("./") ? normalizePath(`${source.path.split("/").slice(0, -1).join("/")}/${raw.slice(2)}`) : "";
  if (relative) {
    const relativeNote = byPath.get(relative) || byPath.get(`${relative}.md`);
    if (relativeNote) return relativeNote;
  }
  return byBasename.get(normalizeText(pathWithoutExtension(raw)))?.[0] || byAlias.get(normalizeText(raw))?.[0];
}

function resolveAnyFile(path: string, source: VaultFileRecord, files: Map<string, VaultFileRecord>): VaultFileRecord | undefined {
  const raw = path.trim().replace(/^\//, "");
  if (!raw) return undefined;
  const direct = files.get(normalizePath(raw));
  if (direct) return direct;
  const relative = raw.startsWith("./") ? normalizePath(`${source.path.split("/").slice(0, -1).join("/")}/${raw.slice(2)}`) : "";
  return relative ? files.get(relative) : undefined;
}

function cleanMeaningfulText(content: string): { text: string; lines: number } {
  const withoutFrontmatter = content.replace(/^(?:---|\+\+\+)\r?\n[\s\S]*?\r?\n(?:---|\+\+\+)\r?\n/, "");
  const meaningful = withoutFrontmatter.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^<!--.*-->$/.test(line) && !/^#{1,6}\s*$/.test(line));
  return { text: meaningful.join(" ").replace(/[`*_>#\[\]{}]/g, "").trim(), lines: meaningful.length };
}

function attachRepair(finding: Finding, link: ParsedLink, before: string, after: string): void {
  finding.repair = { label: "Apply exact link repair", before, after, start: link.start, end: link.end };
}

export function scanVault(reader: VaultReader, settings: CairnSettings, scopePaths?: string[], incremental = false, signal?: AbortSignal, onProgress?: (progress: ScanProgress) => void, previousFindings: Finding[] = []): Promise<ScanResult> {
  const started = Date.now();
  return (async () => {
    // Keep all eligible files in the target index so a Markdown note can
    // resolve an existing attachment even when attachment contents are not
    // selected for scanning. The scan list is a separate concern.
    const allFiles = reader.getFiles().filter((file) => !isIgnoredPath(file.path, settings) && (settings.scanHiddenFiles || !isHidden(file.path)));
    const scanFiles = allFiles.filter((file) => settings.scanNonMarkdownFiles || file.extension.toLowerCase() === "md");
    const selected = scopePaths?.length ? scanFiles.filter((file) => scopePaths.includes(file.path)) : scanFiles;
    const selectedPaths = new Set(selected.map((file) => file.path));
    const explicitScope = scopePaths?.length ? new Set(scopePaths) : null;
    const errors: ScanError[] = [];
    const signatures: Record<string, string> = {};
    allFiles.forEach((file) => signatures[file.path] = fileSignature(file));
    const noteFiles = allFiles.filter((file) => file.extension.toLowerCase() === "md");
    const byPath = new Map<string, NoteIndex>();
    const byBasename = new Map<string, NoteIndex[]>();
    const byAlias = new Map<string, NoteIndex[]>();
    const changedOnly = incremental && Object.keys(settings.lastFileSignatures).length > 0;
    let scanned = 0;
    onProgress?.({ phase: "indexing", currentPath: "", scanned: 0, total: selected.length, findings: 0 });
    // Build metadata indexes from changed content and the previous scan's
    // scope. Unchanged notes are read only when a full scan is requested.
    const pathsRead = new Set<string>();
    for (const file of noteFiles) {
      if (signal?.aborted) return { findings: [], errors, filesScanned: scanned, durationMs: Date.now() - started, cancelled: true, signatures };
      const shouldRead = !changedOnly || explicitScope?.has(file.path) === true || settings.lastFileSignatures[file.path] !== fileSignature(file);
      if (!shouldRead) continue;
      pathsRead.add(file.path);
      try {
        const content = await reader.read(file);
        const parsed = parseHeadingsAndBlocks(content);
        const index: NoteIndex = { file: { ...file, content }, content, ...parsed, aliases: parseAliases(content), outgoing: parseLinks(content) };
        byPath.set(normalizePath(file.path), index);
        const basenameKey = normalizeText(pathWithoutExtension(file.basename || file.path.split("/").pop() || ""));
        byBasename.set(basenameKey, [...(byBasename.get(basenameKey) || []), index]);
        index.aliases.forEach((alias) => byAlias.set(normalizeText(alias), [...(byAlias.get(normalizeText(alias)) || []), index]));
        scanned++;
        onProgress?.({ phase: "reading", currentPath: file.path, scanned, total: selected.length, findings: 0 });
      } catch (error) {
        errors.push({ path: file.path, message: error instanceof Error ? error.message : String(error) });
      }
      await Promise.resolve();
    }
    // In incremental mode, unchanged notes are deliberately not read. Their
    // old findings are retained below, while changed notes are re-evaluated.
    const readableFiles = new Map<string, VaultFileRecord>(allFiles.map((file) => [normalizePath(file.path), file]));
    const findings: Finding[] = changedOnly ? previousFindings.filter((finding) => !pathsRead.has(finding.sourcePath)) : [];
    const incoming = new Map<string, number>();
    byPath.forEach((note) => note.outgoing.forEach((link) => {
      const target = resolveNote(link.path, note.file, byPath, byBasename, byAlias);
      if (target) incoming.set(target.file.path, (incoming.get(target.file.path) || 0) + 1);
    }));
    const blockOccurrences = new Map<string, Array<{ note: NoteIndex; block: Block }>>();
    const headingOccurrences = new Map<string, Array<{ note: NoteIndex; heading: Heading }>>();
    byPath.forEach((note) => {
      note.blocks.forEach((block) => blockOccurrences.set(block.id, [...(blockOccurrences.get(block.id) || []), { note, block }]));
      note.headings.forEach((heading) => {
        const key = `${normalizePath(note.file.path)}|${heading.id}`;
        headingOccurrences.set(key, [...(headingOccurrences.get(key) || []), { note, heading }]);
      });
    });
    for (const [id, occurrences] of blockOccurrences) {
      if (occurrences.length < 2 || !settings.checks["duplicate-block-id"]) continue;
      occurrences.forEach(({ note, block }) => {
        if (!selectedPaths.has(note.file.path)) return;
        findings.push(makeFinding("duplicate-block-id", "high", note.file.path, block.line, currentSection(splitLines(note.content), block.line - 1), `^${id}`, `Block ID ^${id} is repeated ${occurrences.length} times in the vault and may resolve ambiguously.`, false));
      });
    }
    byPath.forEach((note) => {
      if (!selectedPaths.has(note.file.path)) return;
      if (settings.checks["duplicate-heading-id"]) {
        const seen = new Map<string, Heading[]>();
        note.headings.forEach((heading) => seen.set(heading.id, [...(seen.get(heading.id) || []), heading]));
        seen.forEach((headings, id) => {
          if (headings.length < 2) return;
          headings.forEach((heading) => findings.push(makeFinding("duplicate-heading-id", "medium", note.file.path, heading.line, heading.text, `#${id}`, `Heading anchor #${id} is produced more than once in this note.`, false)));
        });
      }
      if (settings.checks["malformed-link"]) {
        splitLines(note.content).forEach((line, index) => {
          if (line.includes("[[") && !line.includes("]]")) findings.push(malformedLinkFinding(note.file.path, note.content, index + 1, line.trim(), "This wikilink is not closed before the end of the line."));
          if (line.includes("](") && !line.includes(")")) findings.push(malformedLinkFinding(note.file.path, note.content, index + 1, line.trim(), "This Markdown link is not closed before the end of the line."));
        });
      }
      const seenLinks = new Map<string, ParsedLink[]>();
      note.outgoing.forEach((link) => {
        const malformed = !link.target || !SAFE_TARGET.test(link.target) || (link.kind === "wiki" && /[\[\]]/.test(link.target));
        const context = surroundingText(note.content, link.line);
        if (malformed && settings.checks["malformed-link"]) findings.push(malformedLinkFinding(note.file.path, note.content, link.line, link.raw, "This link target contains unsupported or malformed characters and cannot be resolved safely."));
        if (EXTERNAL_TARGET.test(link.path)) return;
        const resolution = link.kind === "wiki" ? (resolveNote(link.path, note.file, byPath, byBasename, byAlias) || (link.embed ? resolveAnyFile(link.path, note.file, readableFiles) : undefined)) : (!link.path && link.fragmentKind === "heading") ? byPath.get(normalizePath(note.file.path)) : resolveAnyFile(link.path, note.file, readableFiles);
        const targetNote = link.kind === "wiki" && resolution && "headings" in resolution ? resolution : undefined;
        if (!resolution) {
          if (link.embed && settings.checks["broken-embed"]) findings.push(makeFinding("broken-embed", "high", note.file.path, link.line, link.section, link.target, "This embedded note or local attachment does not exist in the vault.", false, context));
          else if (link.kind === "wiki" && /\s/.test(link.path) && settings.checks["missing-alias"]) findings.push(makeFinding("missing-alias", "medium", note.file.path, link.line, link.section, link.target, "No note exposes this text as an alias, and no matching note path was found.", false, context));
          else if (settings.checks[link.kind === "wiki" ? "broken-wikilink" : "broken-markdown-link"]) findings.push(makeFinding(link.kind === "wiki" ? "broken-wikilink" : "broken-markdown-link", "high", note.file.path, link.line, link.section, link.target, link.kind === "wiki" ? "The wikilink target does not resolve to a note." : "The Markdown link target does not resolve to a vault file.", false, context));
        } else if (link.fragmentKind !== "none") {
          const fragment = normalizeText(link.fragment);
          if (link.fragmentKind === "block") {
            const exists = targetNote?.blocks.some((block) => block.id === fragment);
            if (!exists && settings.checks["missing-block-id"]) findings.push(makeFinding("missing-block-id", "high", note.file.path, link.line, link.section, link.target, `Block ID ^${link.fragment} does not exist in the target note.`, false, context));
          } else {
            const exists = targetNote?.headings.some((heading) => heading.id === fragment || normalizeText(heading.text) === fragment);
            if (!exists && settings.checks["missing-heading"]) findings.push(makeFinding("missing-heading", "medium", note.file.path, link.line, link.section, link.target, `Heading #${link.fragment} does not exist in the target note.`, false, context));
          }
        }
        const resolvedPath = resolution ? ("file" in resolution ? resolution.file.path : resolution.path) : link.path;
        const canonical = `${resolvedPath}|${link.fragmentKind}|${normalizeText(link.fragment)}`;
        seenLinks.set(canonical, [...(seenLinks.get(canonical) || []), link]);
        const duplicateGroup = seenLinks.get(canonical);
        if (duplicateGroup && duplicateGroup.length > 1 && settings.checks["duplicate-link"]) {
          const first = duplicateGroup[0];
          const duplicate = makeFinding("duplicate-link", "low", note.file.path, link.line, link.section, link.target, `This link repeats the same target already linked at line ${first.line}.`, true, context);
          attachRepair(duplicate, link, link.raw, "");
          findings.push(duplicate);
        }
      });
      if (settings.checks["empty-stub"]) {
        const clean = cleanMeaningfulText(note.content);
        const isStub = clean.text.length <= settings.emptyStubMaxCharacters && clean.lines <= settings.emptyStubMaxMeaningfulLines && (incoming.get(note.file.path) || 0) === 0 && note.outgoing.length === 0;
        if (isStub) findings.push(makeFinding("empty-stub", "low", note.file.path, 1, "(document)", note.file.path, "This Markdown note is empty or nearly empty and has no detected incoming or outgoing links.", false, clean.text || "(no meaningful text)"));
      }
      onProgress?.({ phase: "checking", currentPath: note.file.path, scanned, total: selected.length, findings: findings.length });
    });
    const unique = new Map<string, Finding>();
    findings.forEach((finding) => unique.set(finding.id, finding));
    const resultFindings = [...unique.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.line - b.line || a.type.localeCompare(b.type));
    onProgress?.({ phase: "complete", currentPath: "", scanned, total: selected.length, findings: resultFindings.length });
    return { findings: resultFindings, errors, filesScanned: scanned, durationMs: Date.now() - started, cancelled: false, signatures };
  })();
}

export function applyIgnoredFindings(findings: Finding[], ignored: CairnSettings["ignoredFindings"]): Finding[] {
  return findings.map((finding) => {
    const match = ignored.find((item) => item.scope === "finding" ? item.key === finding.id : item.scope === "source" ? item.key === finding.sourcePath : finding.sourcePath === item.key || finding.sourcePath.startsWith(`${item.key}/`));
    return match ? { ...finding, ignored: true, ignoredReason: match.reason } : finding;
  });
}

export function findingCounts(findings: Finding[]): { total: number; high: number; ignored: number } {
  return { total: findings.length, high: findings.filter((finding) => finding.severity === "high" && !finding.ignored).length, ignored: findings.filter((finding) => finding.ignored).length };
}
