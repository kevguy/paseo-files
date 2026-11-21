import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { browse, locate, readText, saveText, search } from "../server/files";

const fixtures = join(process.cwd(), ".validation", "files-backend");
let sequence = 0;
async function workspace() {
  const path = join(fixtures, `case-${process.pid}-${sequence++}`);
  await mkdir(path, { recursive: true });
  return path;
}

test("browsing and locating stay inside real, non-symlink workspace paths", async () => {
  const root = await workspace();
  await mkdir(join(root, "folder"));
  await writeFile(join(root, "folder", "note.md"), "ok");
  const outside = join(fixtures, `outside-${process.pid}-${sequence}`);
  await mkdir(outside, { recursive: true });
  try {
    await symlink(outside, join(root, "escape"));
    assert.equal((await browse(root, "")).entries.some((item) => item.name === "escape"), false);
    await assert.rejects(browse(root, "escape"), /Symbolic links/);
    await assert.rejects(readText(root, "../outside"), /Invalid workspace path/);
    await assert.rejects(locate(root, join(outside, "secret")), /outside/);
    assert.deepEqual(await locate(root, join(root, "folder", "note.md")), { path: "folder/note.md" });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("reads reject binary and oversized data; deleted and conflicting saves are rejected", async () => {
  const root = await workspace();
  try {
    await writeFile(join(root, "binary.dat"), Buffer.from([0x61, 0, 0x62]));
    await writeFile(join(root, "large.md"), Buffer.alloc(512 * 1024 + 1, 0x61));
    await writeFile(join(root, "note.md"), "first");
    await assert.rejects(readText(root, "binary.dat"), /Binary/);
    await assert.rejects(readText(root, "large.md"), /512 KiB/);
    const opened = await readText(root, "note.md");
    await writeFile(join(root, "note.md"), "external change");
    await assert.rejects(saveText(root, "note.md", "my change", opened.revision), /changed/);
    await rm(join(root, "note.md"));
    await assert.rejects(saveText(root, "note.md", "my change", opened.revision));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("explicit save preserves BOM and CRLF when text retains them", async () => {
  const root = await workspace();
  const original = Buffer.from("\uFEFFalpha\r\nbeta\r\n", "utf8");
  try {
    await writeFile(join(root, "notes.md"), original);
    await chmod(join(root, "notes.md"), 0o640);
    const opened = await readText(root, "notes.md");
    assert.equal(opened.text, "\uFEFFalpha\r\nbeta\r\n");
    const saved = await saveText(root, "notes.md", `${opened.text}gamma\r\n`, opened.revision);
    assert.deepEqual(await readFile(join(root, "notes.md")), Buffer.from("\uFEFFalpha\r\nbeta\r\ngamma\r\n", "utf8"));
    assert.notEqual(saved.revision, opened.revision);
    assert.equal((await stat(join(root, "notes.md"))).mode & 0o777, 0o640);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("search finds matching files and directories and treats content queries literally", async () => {
  const root = await workspace();
  try {
    await mkdir(join(root, "folder [*]"), { recursive: true });
    await writeFile(join(root, "folder [*]", "literal [*].md"), "before\nneedle [*] value\nafter\n");
    await writeFile(join(root, "folder [*]", "other.md"), "needle xx value\n");
    const names = await search(root, "", "[*]", "names", true);
    assert.ok(names.entries.some((entry) => entry.kind === "directory" && entry.path === "folder [*]"));
    assert.ok(names.entries.some((entry) => entry.kind === "file" && entry.path.endsWith("literal [*].md")));
    const contents = await search(root, "", "needle [*]", "content", true);
    assert.deepEqual(contents.entries.map((entry) => ({ path: entry.path, line: "line" in entry ? entry.line : undefined })), [{ path: "folder [*]/literal [*].md", line: 2 }]);
    assert.match(("preview" in (contents.entries[0] ?? {}) ? contents.entries[0]?.preview : "") ?? "", /needle \[\*\]/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("name search handles newline and Unicode filenames plus path queries", async () => {
  const root = await workspace();
  try {
    await mkdir(join(root, "section"), { recursive: true });
    await writeFile(join(root, "section", "line\n☃.md"), "content");
    await writeFile(join(root, "section", "target.md"), "content");
    const newlineName = await search(root, "", "line\n☃", "names", true);
    assert.ok(newlineName.entries.some((entry) => entry.path === "section/line\n☃.md"));
    const byPath = await search(root, "", "section/target", "names", true);
    assert.ok(byPath.entries.some((entry) => entry.path === "section/target.md" && entry.kind === "file"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid UTF-8 files cannot be opened for editing", async () => {
  const root = await workspace();
  try {
    await writeFile(join(root, "invalid.md"), Buffer.from([0xc3, 0x28]));
    await assert.rejects(readText(root, "invalid.md"), /valid UTF-8/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent saves with one revision allow exactly one writer", async () => {
  const root = await workspace();
  try {
    await writeFile(join(root, "note.md"), "original");
    const opened = await readText(root, "note.md");
    const attempts = await Promise.allSettled([
      saveText(root, "note.md", "first", opened.revision),
      saveText(root, "note.md", "second", opened.revision),
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
    const content = await readText(root, "note.md");
    assert.ok(content.text === "first" || content.text === "second");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rg errors are surfaced instead of reported as empty results", async () => {
  const root = await workspace();
  const fakeBin = join(fixtures, `fake-rg-${process.pid}-${sequence}`);
  const priorPath = process.env.PATH;
  try {
    await mkdir(fakeBin, { recursive: true });
    await writeFile(join(fakeBin, "rg"), "#!/bin/sh\nexit 2\n");
    await chmod(join(fakeBin, "rg"), 0o755);
    process.env.PATH = fakeBin;
    await assert.rejects(search(root, "", "anything", "content", true), /ripgrep failed.*exit 2/);
    await assert.rejects(search(root, "", "anything", "names", true), /rg --files failed.*exit 2/);
  } finally {
    process.env.PATH = priorPath;
    await rm(root, { recursive: true, force: true });
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test("search results report limits for capped result sets", async () => {
  const root = await workspace();
  try {
    for (let i = 0; i < 510; i++) await writeFile(join(root, `match-${i}.md`), "x");
    const result = await browse(root, "");
    assert.equal(result.entries.length, 500);
    assert.equal(result.limited, true);
    const matches = await search(root, "", "match-", "names", true);
    assert.equal(matches.entries.length, 100);
    assert.equal(matches.limited, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
