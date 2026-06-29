import { relative, isAbsolute } from "node:path";

/**
 * Path returned to the client by webskim_read must be resolvable by the
 * client's Read tool. Two topologies:
 *   - cache under cwd (default `<cwd>/.ai_pages`): return a cwd-relative path so
 *     nothing leaks the server's home prefix and the client resolves it against
 *     its own cwd (the shared project dir).
 *   - cache outside cwd (explicit WEBSKIM_CACHE_DIR on a volume): keep the
 *     absolute path — the client configured that dir, so it knows the location;
 *     a relativized `../../…` or bare filename would not resolve.
 */
export function toDisplayPath(absPath: string, cwd: string): string {
  const rel = relative(cwd, absPath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    return absPath;
  }
  return rel;
}
