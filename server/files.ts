/// <reference types="node" />
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { constants as fsConstants } from "node:fs";
import { lstat, open, opendir, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

const MAX_EDIT_BYTES = 512 * 1024;
const MAX_BROWSE = 500;
const MAX_DIRECTORY_SCAN = 4000;
const MAX_SEARCH_RESULTS = 100;
const MAX_WALK_FILES = 100_000;
const MAX_NAME_OUTPUT_BYTES = 16 * 1024 * 1024;
const SEARCH_DEADLINE_MS = 1800;
const SKIP_DIRS = new Set([".git", "node_modules", "vendor", "dist", "build", "target", ".next", ".cache"]);
const EXCLUDED_GLOBS = ["!.git/**", "!**/.git/**", "!**/node_modules/**", "!**/vendor/**", "!**/dist/**", "!**/build/**", "!**/target/**", "!**/.next/**", "!**/.cache/**"];
const locks = new Map<string, Promise<void>>();

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function normalizeRelative(value: string, allowEmpty = true): string {
  if (value.includes("\0") || value.includes("\\") || isAbsolute(value)) throw new Error("Invalid workspace path");
  const parts = value.split("/");
  if (parts.some((part) => part === ".." || part === ".")) throw new Error("Invalid workspace path");
  const normalized = parts.filter(Boolean).join("/");
  if (!allowEmpty && !normalized) throw new Error("A file path is required");
  return normalized;
}

async function checkedRoot(rootPath: string): Promise<string> {
  const root = await realpath(rootPath);
  if (root === parse(root).root) throw new Error("The filesystem root cannot be used as a workspace");
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Workspace is not a directory");
  return root;
}


async function checkedPath(rootPath: string, relativePath: string, options: { allowEmpty?: boolean; missingLeaf?: boolean } = {}): Promise<string> {
  const root = await checkedRoot(rootPath);
  const rel = normalizeRelative(relativePath, options.allowEmpty !== false);
  let current = root;
  if (!rel) return root;
  const pieces = rel.split("/");
  for (let index = 0; index < pieces.length; index++) {
    current = join(current, pieces[index]!);
    if (!inside(root, current)) throw new Error("Path is outside the selected workspace");
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (options.missingLeaf && index === pieces.length - 1 && (error as NodeJS.ErrnoException).code === "ENOENT") return current;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error("Symbolic links are not supported");
    if (index < pieces.length - 1 && !info.isDirectory()) throw new Error("A path component is not a directory");
  }
  return current;
}

function relativePosix(root: string, full: string): string {
  return relative(root, full).split(sep).join("/");
}

function digest(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function decodeEditable(data: Buffer, filePath: string): string {
  if (data.length > MAX_EDIT_BYTES) throw new Error("File exceeds the 512 KiB editing limit");
  if (data.includes(0)) throw new Error("Binary files cannot be edited");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    throw new Error(`File is not valid UTF-8: ${filePath}`);
  }
  if (text.includes("\0")) throw new Error("Binary files cannot be edited");
  return text;
}

async function readStable(filePath: string, root?: string, relativePath?: string): Promise<{ data: Buffer; text: string; revision: string; mode: number }> {
  const handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Only regular files can be read");
    if (before.size > MAX_EDIT_BYTES) throw new Error("File exceeds the 512 KiB editing limit");
    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(64 * 1024);
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, MAX_EDIT_BYTES + 1 - total), total);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_EDIT_BYTES) throw new Error("File exceeds the 512 KiB editing limit");
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const after = await handle.stat();
    const pathStat = await lstat(filePath);
    if (!pathStat.isFile() || pathStat.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || pathStat.dev !== before.dev || pathStat.ino !== before.ino || pathStat.size !== after.size || pathStat.mtimeMs !== after.mtimeMs) {
      throw new Error("File changed while it was being read");
    }
    if (root !== undefined && relativePath !== undefined) {
      const checked = await checkedPath(root, relativePath, { allowEmpty: false });
      if (checked !== filePath) throw new Error("File path changed while it was being read");
    }
    const data = Buffer.concat(chunks, total);
    const text = decodeEditable(data, filePath);
    return { data, text, revision: digest(data), mode: before.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

async function withFileLock<T>(filePath: string, run: () => Promise<T>): Promise<T> {
  const prior = locks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveLock) => { release = resolveLock; });
  const queued = prior.then(() => current);
  locks.set(filePath, queued);
  await prior;
  try { return await run(); }
  finally {
    release();
    if (locks.get(filePath) === queued) locks.delete(filePath);
  }
}

export async function listWorkspaces(paseo: import("@getpaseo/plugin/server").PluginHandlerContext["paseo"]): Promise<{ workspaces: Array<{ id: string; name: string; path: string }> }> {
  const workspaces: Array<{ id: string; name: string; path: string }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    for (const item of result.entries ?? []) {
      const path = item.workspaceDirectory || item.projectRootPath;
      if (typeof item.id !== "string" || !path) continue;
      try {
        const root = await checkedRoot(path);
        workspaces.push({ id: item.id, name: item.name || basename(root) || root, path: root });
      } catch { /* inaccessible and filesystem-root workspaces are omitted */ }
    }
    const next = result.pageInfo?.nextCursor;
    if (!result.pageInfo?.hasMore || !next || next === cursor) break;
    cursor = next;
  }
  return { workspaces };
}

export async function browse(rootPath: string, requestedPath: string) {
  const root = await checkedRoot(rootPath);
  const path = normalizeRelative(requestedPath);
  const directory = await checkedPath(root, path);
  const stat = await lstat(directory);
  if (!stat.isDirectory()) throw new Error("Path is not a directory");
  const dir = await opendir(directory);
  const entries: Array<{ path: string; name: string; kind: "file" | "directory" }> = [];
  let limited = false;
  let scanned = 0;
  for await (const item of dir) {
    if (entries.length >= MAX_BROWSE || scanned >= MAX_DIRECTORY_SCAN) { limited = true; break; }
    scanned++;
    if (item.name.startsWith(".") && item.name !== ".well-known") continue;
    const full = join(directory, item.name);
    const info = await lstat(full).catch(() => null);
    if (!info || info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) continue;
    entries.push({ path: path ? `${path}/${item.name}` : item.name, name: item.name, kind: info.isDirectory() ? "directory" : "file" });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  return { path, entries, limited };
}

async function walkNames(root: string, scope: string, query: string, caseSensitive: boolean): Promise<{ entries: Array<{ path: string; kind: "file" | "directory" }>; limited: boolean }> {
  const start = await checkedPath(root, scope);
  if (!(await lstat(start)).isDirectory()) throw new Error("Search scope is not a directory");
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const entries: Array<{ path: string; kind: "file" | "directory" }> = [];
  let limited = false;
  let seen = 0;
  const deadline = Date.now() + SEARCH_DEADLINE_MS;
  const visit = async (directory: string): Promise<void> => {
    if (Date.now() >= deadline || seen >= MAX_WALK_FILES || entries.length >= MAX_SEARCH_RESULTS) { limited = true; return; }
    let dir;
    try { dir = await opendir(directory); } catch { return; }
    let scanned = 0;
    for await (const item of dir) {
      if (++scanned > MAX_DIRECTORY_SCAN) { limited = true; return; }
      if (Date.now() >= deadline || seen >= MAX_WALK_FILES || entries.length >= MAX_SEARCH_RESULTS) { limited = true; return; }
      if (++seen > MAX_WALK_FILES) { limited = true; return; }
      const full = join(directory, item.name);
      const info = await lstat(full).catch(() => null);
      if (!info || info.isSymbolicLink()) continue;
      const kind = info.isDirectory() ? "directory" : info.isFile() ? "file" : null;
      if (!kind) continue;
      const path = relativePosix(root, full);
      const name = caseSensitive ? item.name : item.name.toLocaleLowerCase();
      const searchablePath = caseSensitive ? path : path.toLocaleLowerCase();
      if (name.includes(needle) || searchablePath.includes(needle)) entries.push({ path, kind });
      if (kind === "directory" && !SKIP_DIRS.has(item.name)) await visit(full);
    }
  };
  await visit(start);
  return { entries, limited };
}

function runRg(root: string, scope: string, query: string, caseSensitive: boolean): Promise<{ stdout: string; limited: boolean; unavailable: boolean; error?: string }> {
  return new Promise((resolvePromise) => {
    let child;
    try {
      const args = ["--json", "--line-number", "--no-heading", "--color", "never", "--fixed-strings", "--hidden", "--no-ignore", "--no-follow", "--max-filesize", `${MAX_EDIT_BYTES}`, "--max-count", "1", ...(caseSensitive ? [] : ["--ignore-case"]), ...EXCLUDED_GLOBS.flatMap((glob) => ["--glob", glob]), "--", query, scope || "."];
      child = spawn("rg", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin", RUST_BACKTRACE: "0", RIPGREP_CONFIG_PATH: "/dev/null" } });
    } catch (error) { resolvePromise({ stdout: "", limited: false, unavailable: false, error: String(error) }); return; }
    let stdout = "";
    let limited = false;
    let done = false;
    const decoder = new StringDecoder("utf8");
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const finish = (unavailable = false, error?: string) => { if (done) return; done = true; stdout += decoder.end(); clearTimeout(timer); if (hardKill) clearTimeout(hardKill); resolvePromise({ stdout, limited, unavailable, ...(error ? { error } : {}) }); };
    const timer = setTimeout(() => { limited = true; child.kill("SIGTERM"); hardKill = setTimeout(() => child.kill("SIGKILL"), 100); }, SEARCH_DEADLINE_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      const decoded = decoder.write(chunk);
      if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(decoded, "utf8") > 2 * 1024 * 1024) { limited = true; child.kill("SIGTERM"); return; }
      stdout += decoded;
    });
    child.on("error", (error: NodeJS.ErrnoException) => finish(error.code === "ENOENT", error.code === "ENOENT" ? undefined : `ripgrep could not start: ${error.message}`));
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (!limited && (code !== 0 && code !== 1)) finish(false, `ripgrep failed${code === null ? ` (${signal ?? "signal"})` : ` (exit ${code})`}`);
      else finish(false);
    });
  });
}

function runRgFiles(root: string, scope: string): Promise<{ stdout: string; limited: boolean; unavailable: boolean; error?: string }> {
  return new Promise((resolvePromise) => {
    let child;
    try {
      const args = ["--files", "--null", "--hidden", "--no-ignore", "--no-follow", ...EXCLUDED_GLOBS.flatMap((glob) => ["--glob", glob]), "--", scope || "."];
      child = spawn("rg", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin", RIPGREP_CONFIG_PATH: "/dev/null" } });
    } catch (error) { resolvePromise({ stdout: "", limited: false, unavailable: false, error: String(error) }); return; }
    let stdout = "";
    let limited = false;
    let done = false;
    const decoder = new StringDecoder("utf8");
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const finish = (unavailable = false, error?: string) => { if (done) return; done = true; stdout += decoder.end(); clearTimeout(timer); if (hardKill) clearTimeout(hardKill); resolvePromise({ stdout, limited, unavailable, ...(error ? { error } : {}) }); };
    const timer = setTimeout(() => { limited = true; child.kill("SIGTERM"); hardKill = setTimeout(() => child.kill("SIGKILL"), 100); }, SEARCH_DEADLINE_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      const decoded = decoder.write(chunk);
      if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(decoded, "utf8") > MAX_NAME_OUTPUT_BYTES) { limited = true; child.kill("SIGTERM"); return; }
      stdout += decoded;
    });
    child.on("error", (error: NodeJS.ErrnoException) => finish(error.code === "ENOENT", error.code === "ENOENT" ? undefined : `rg --files could not start: ${error.message}`));
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (!limited && (code !== 0 && code !== 1)) finish(false, `rg --files failed${code === null ? ` (${signal ?? "signal"})` : ` (exit ${code})`}`);
      else finish(false);
    });
  });
}

async function searchNames(root: string, scope: string, query: string, caseSensitive: boolean) {
  const start = await checkedPath(root, scope);
  if (!(await lstat(start)).isDirectory()) throw new Error("Search scope is not a directory");
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const entries: Array<{ path: string; kind: "file" | "directory" }> = [];
  const included = new Set<string>();
  let limited = false;
  let scanned = 0;
  const add = async (relativePath: string, kind: "file" | "directory") => {
    if (included.has(relativePath)) return;
    if (entries.length >= MAX_SEARCH_RESULTS) { limited = true; return; }
    try {
      const full = await checkedPath(root, relativePath, { allowEmpty: false });
      const info = await lstat(full);
      if (info.isSymbolicLink() || (kind === "file" ? !info.isFile() : !info.isDirectory())) return;
      entries.push({ path: relativePath, kind });
      included.add(relativePath);
    } catch { /* stale paths and links are omitted */ }
  };
  const files = await runRgFiles(root, scope);
  if (!files.unavailable) {
    if (files.error) throw new Error(files.error);
    limited ||= files.limited;
    for (const raw of files.stdout.split("\0")) {
      if (!raw) continue;
      if (++scanned > MAX_WALK_FILES) { limited = true; break; }
      const normalized = raw.split(sep).join("/").replace(/^(?:\.\/)+/, "");
      if (!normalized) continue;
      const pieces = normalized.split("/");
      const normalizedForQuery = caseSensitive ? normalized : normalized.toLocaleLowerCase();
      if (normalizedForQuery.includes(needle)) await add(normalized, "file");
      for (let index = 0; index < pieces.length; index++) {
        const component = caseSensitive ? pieces[index]! : pieces[index]!.toLocaleLowerCase();
        if (!component.includes(needle)) continue;
        const rel = pieces.slice(0, index + 1).join("/");
        await add(rel, index === pieces.length - 1 ? "file" : "directory");
      }
      if (entries.length >= MAX_SEARCH_RESULTS) { limited = true; break; }
    }
  } else {
    const fallback = await walkNames(root, scope, query, caseSensitive);
    return { ...fallback, engine: "bounded-walk-fallback" };
  }
  // rg --files omits empty directories. A bounded directory-only walk adds those and confirms names.
  let walked = 0;
  const deadline = Date.now() + SEARCH_DEADLINE_MS;
  const visit = async (directory: string): Promise<void> => {
    if (Date.now() >= deadline || walked >= MAX_WALK_FILES || entries.length >= MAX_SEARCH_RESULTS) { limited = true; return; }
    let dir;
    try { dir = await opendir(directory); } catch { return; }
    for await (const item of dir) {
      if (++walked > MAX_WALK_FILES || Date.now() >= deadline || entries.length >= MAX_SEARCH_RESULTS) { limited = true; return; }
      if (!item.isDirectory() || item.isSymbolicLink() || SKIP_DIRS.has(item.name)) continue;
      const full = join(directory, item.name);
      const path = relativePosix(root, full);
      const name = caseSensitive ? item.name : item.name.toLocaleLowerCase();
      if (name.includes(needle)) await add(path, "directory");
      await visit(full);
    }
  };
  await visit(start);
  return { entries, limited, engine: "rg-files+bounded-directory-walk" };
}

async function contentFallback(root: string, scope: string, query: string, caseSensitive: boolean) {
  const start = await checkedPath(root, scope);
  if (!(await lstat(start)).isDirectory()) throw new Error("Search scope is not a directory");
  const entries: Array<{ path: string; kind: "file"; line: number; preview: string }> = [];
  let limited = false;
  let seen = 0;
  const deadline = Date.now() + SEARCH_DEADLINE_MS;
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const visit = async (directory: string): Promise<void> => {
    let dir;
    try { dir = await opendir(directory); } catch { return; }
    let scanned = 0;
    for await (const item of dir) {
      if (++scanned > MAX_DIRECTORY_SCAN) { limited = true; return; }
      if (Date.now() >= deadline || seen >= MAX_WALK_FILES || entries.length >= MAX_SEARCH_RESULTS) { limited = true; return; }
      if (++seen > MAX_WALK_FILES) { limited = true; return; }
      const full = join(directory, item.name);
      const info = await lstat(full).catch(() => null);
      if (!info || info.isSymbolicLink()) continue;
      if (info.isDirectory()) { if (!SKIP_DIRS.has(item.name)) await visit(full); continue; }
      if (!info.isFile()) continue;
      if (info.size > MAX_EDIT_BYTES || !/\.(md|markdown|txt|ya?ml|json|js|jsx|ts|tsx|css|html|xml|toml|sh|py|rs|go|java|c|h|cpp|sql|log)$/i.test(item.name)) continue;
      const content = await readStable(full, root, relativePosix(root, full)).catch(() => null);
      if (!content) continue;
      const text = content.text;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const hay = caseSensitive ? lines[i]! : lines[i]!.toLocaleLowerCase();
        if (hay.includes(needle)) { entries.push({ path: relativePosix(root, full), kind: "file", line: i + 1, preview: lines[i]!.slice(0, 240) }); break; }
      }
    }
  };
  await visit(start);
  return { entries, limited };
}

export async function search(rootPath: string, scopeValue: string, query: string, mode: "names" | "content", caseSensitive: boolean): Promise<import("../shared/files").SearchResult> {
  const root = await checkedRoot(rootPath);
  const scope = normalizeRelative(scopeValue);
  await checkedPath(root, scope);
  if (mode === "names") return searchNames(root, scope, query, caseSensitive);
  const result = await runRg(root, scope, query, caseSensitive);
  if (result.error) throw new Error(result.error);
  if (result.unavailable) return { ...(await contentFallback(root, scope, query, caseSensitive)), engine: "bounded-walk-fallback" };
  const entries: Array<{ path: string; kind: "file"; line: number; preview: string }> = [];
  for (const line of result.stdout.split("\n")) {
    if (!line || entries.length >= MAX_SEARCH_RESULTS) { if (entries.length >= MAX_SEARCH_RESULTS) result.limited = true; continue; }
    let record: any;
    try { record = JSON.parse(line); } catch { result.limited = true; continue; }
    if (record.type !== "match") continue;
    const raw = Buffer.from(record.data.path.bytes ?? record.data.path.text, record.data.path.bytes ? "base64" : "utf8").toString("utf8");
    const rel = raw.split(sep).join("/").replace(/^(?:\.\/)+/, "");
    let safe: string;
    try { safe = await checkedPath(root, rel, { allowEmpty: false }); } catch { continue; }
    const data = record.data;
    const lineBytes = data.lines?.bytes ? Buffer.from(data.lines.bytes, "base64") : Buffer.from(data.lines?.text ?? "", "utf8");
    let preview = "";
    try { preview = new TextDecoder("utf-8", { fatal: true }).decode(lineBytes).replace(/[\r\n]+$/, "").slice(0, 240); } catch { continue; }
    entries.push({ path: relativePosix(root, safe), kind: "file", line: data.line_number, preview });
  }
  return { entries, limited: result.limited, engine: "rg" };
}

export async function readText(rootPath: string, requestedPath: string) {
  const root = await checkedRoot(rootPath);
  const path = normalizeRelative(requestedPath, false);
  const full = await checkedPath(root, path, { allowEmpty: false });
  const value = await readStable(full, root, path);
  return { path, text: value.text, revision: value.revision };
}

export async function saveText(rootPath: string, requestedPath: string, text: string, expectedRevision: string) {
  const root = await checkedRoot(rootPath);
  const path = normalizeRelative(requestedPath, false);
  const full = await checkedPath(root, path, { allowEmpty: false });
  if (Buffer.byteLength(text, "utf8") > MAX_EDIT_BYTES) throw new Error("File exceeds the 512 KiB editing limit");
  if (text.includes("\0") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) throw new Error("Text must be valid UTF-8 without NUL bytes");
  return withFileLock(full, async () => {
    const current = await readStable(await checkedPath(root, path, { allowEmpty: false }), root, path);
    if (current.revision !== expectedRevision) throw new Error("File changed since it was opened; reload before saving");
    const currentStat = await lstat(full);
    const temp = join(dirname(full), `.${basename(full)}.paseo-${randomBytes(12).toString("hex")}.pending`);
    let handle;
    try {
      handle = await open(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, currentStat.mode & 0o777);
      await handle.chmod(currentStat.mode & 0o777);
      await handle.writeFile(text, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      const finalPath = await checkedPath(root, path, { allowEmpty: false });
      const verify = await readStable(finalPath, root, path);
      if (verify.revision !== expectedRevision) throw new Error("File changed before save completed; reload before saving");
      await rename(temp, full);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    const saved = await readStable(full, root, path);
    const intendedRevision = digest(Buffer.from(text, "utf8"));
    if (saved.revision !== intendedRevision) throw new Error("File changed immediately after save; reload before continuing");
    return { path, text: saved.text, revision: saved.revision };
  });
}

export async function locate(rootPath: string, absolutePath: string): Promise<{ path: string }> {
  const root = await checkedRoot(rootPath);
  if (!isAbsolute(absolutePath) || absolutePath.includes("\0")) throw new Error("An absolute path is required");
  const full = resolve(absolutePath);
  if (!inside(root, full)) throw new Error("Path is outside the selected workspace");
  const path = relativePosix(root, full);
  await checkedPath(root, path);
  return { path };
}
