import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isProsePath } from "./ci-scope.mjs";

export function proseWithoutCode(text) {
  let fence;
  return text.split(/\r?\n/).map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      return "";
    }
    return fence ? "" : line.replace(/(`+)[\s\S]*?\1/g, "");
  }).join("\n");
}

export function documentErrors(path, text, cwd) {
  const errors = [];
  if (/^(?:<{7}|={7}|>{7})(?:\s|$)/m.test(text)) errors.push(`${path}: unresolved conflict marker`);
  const prose = proseWithoutCode(text);
  const targets = [
    ...prose.matchAll(/\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g),
    ...prose.matchAll(/^ {0,3}\[[^\]]+\]:\s*(<[^>]+>|[^\s]+)/gm),
  ].map((match) => match[1].replace(/^<|>$/g, ""));
  for (const target of targets) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
    const pathname = target.split(/[?#]/, 1)[0];
    if (!pathname) continue;
    let decoded;
    try { decoded = decodeURIComponent(pathname); }
    catch { errors.push(`${path}: invalid link ${target}`); continue; }
    const destination = isAbsolute(decoded) ? resolve(cwd, `.${decoded}`) : resolve(cwd, dirname(path), decoded);
    if (!existsSync(destination)) errors.push(`${path}: missing local link target ${target}`);
  }
  return errors;
}

export function checkDocuments(paths, cwd = process.cwd()) {
  const errors = [];
  for (const path of paths) {
    if (!isProsePath(path)) throw new Error(`Not an allowlisted document: ${path}`);
    const absolute = resolve(cwd, path);
    if (existsSync(absolute)) errors.push(...documentErrors(path, readFileSync(absolute, "utf8"), cwd));
  }
  const pointer = resolve(cwd, "CLAUDE.md");
  if (!existsSync(pointer) || readFileSync(pointer, "utf8").trim() !== "@AGENTS.md" || !existsSync(resolve(cwd, "AGENTS.md"))) {
    errors.push("CLAUDE.md must point to the existing AGENTS.md with @AGENTS.md");
  }
  return errors;
}

function main() {
  const requested = process.env.CHANGED_DOCUMENTS ? JSON.parse(process.env.CHANGED_DOCUMENTS) : null;
  const paths = requested ?? execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(isProsePath);
  if (!Array.isArray(paths)) throw new Error("Document list must be an array");
  const errors = checkDocuments(paths);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Checked ${paths.length} document paths and the Claude instruction pointer.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
