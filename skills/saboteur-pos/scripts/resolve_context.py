#!/usr/bin/env python3
"""Resolve the current git repo to a Saboteur context and switch to it.

This is one component of the `saboteur-pos` skill, which teaches Claude to drive
the `sab` CLI (tasks, notes, briefing, contexts). Because *every* `sab` action is
scoped to the active context, this resolver runs first: it figures out which
context the current repository belongs to and switches to it, so that any later
`sab task` / `sab note` / `sab briefing` work lands in the right place.

It is safe to call from a skill invocation, from a SessionStart hook, or by hand.
It only ever runs `sab context use` / `sab context show` / `sab context list` —
no writes to tasks or notes — so it cannot corrupt state.

Identity: a repo is keyed by its normalized git remote URL (so two checkouts of
the same repo, or https vs ssh remotes, resolve to one key, and two different
repos that happen to share a folder name never collide). If a repo has no
remote, we fall back to its absolute root path.

Monorepo sub-contexts: a mapping value is normally a bare slug string (the whole
repo -> one context). For a monorepo, the value may instead be an object
{ "default": <slug>, "paths": [ { "glob": "apps/web/**", "context": <slug> } ] }.
The current working directory's path relative to the repo root is matched against
each glob in order (first match wins); a miss falls back to "default" (or unmapped
if there is no default). This lets `cd`-ing into a subtree resolve to the right
sub-context without any schema or CLI change.

Commands:
  resolve   (default)  Look up the current repo (and sub-path) and switch context
                       to its mapping, then show it. If unmapped, report + suggest.
  slug                 Print just the mapped context slug for the current repo +
                       sub-path to stdout (nothing + nonzero exit if unmapped).
                       Designed for capture in a shell var, e.g.
                       SLUG=$(resolve_context.py slug), so callers can pass
                       --context <slug> on every command instead of trusting the
                       shared global active context.
  key                  Print the identity key, repo name, sub-path, and matched
                       rule for the current repo.
  add <slug>           Map the current repo -> <slug> (sets the repo default),
                       then resolve.
  add <slug> --path <glob>
                       Append a path rule (glob -> slug) for the current repo,
                       lifting a bare-string mapping into object form, then resolve.
  list                 Print the whole context map.

The map lives at ../context-map.json relative to this script's REAL location
(symlinks resolved), so edits land in the source repo, not the symlink. Set
SABOTEUR_CONTEXT_MAP to override the path (used by tests).
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

MAP_PATH = Path(
    os.environ.get(
        "SABOTEUR_CONTEXT_MAP",
        Path(__file__).resolve().parent.parent / "context-map.json",
    )
)


# --- small helpers ----------------------------------------------------------

def run(cmd, **kw):
    """Run a command, return (returncode, stdout, stderr) as text."""
    p = subprocess.run(cmd, capture_output=True, text=True, **kw)
    return p.returncode, p.stdout, p.stderr


def die(msg, code=1):
    print(msg, file=sys.stderr)
    sys.exit(code)


def normalize_remote(url):
    """Canonicalize a git remote URL into a stable key.

    https://github.com/org/repo.git  -> github.com/org/repo
    git@github.com:org/repo.git       -> github.com/org/repo
    ssh://git@host:22/org/repo.git     -> host/org/repo
    """
    u = url.strip()
    # scp-like syntax: git@host:org/repo
    m = re.match(r"^[\w.+-]+@([^:/]+):(.+)$", u)
    if m:
        u = f"{m.group(1)}/{m.group(2)}"
    else:
        u = re.sub(r"^[a-zA-Z][\w+.-]*://", "", u)  # strip scheme
        u = re.sub(r"^[^@/]+@", "", u)              # strip user@
    u = u.split("?", 1)[0].split("#", 1)[0]
    u = re.sub(r":\d+/", "/", u)                    # strip :port/
    if u.endswith(".git"):
        u = u[:-4]
    return u.rstrip("/").lower()


def repo_identity():
    """Return (key, repo_name, kind). kind is 'remote' | 'path' | None."""
    rc, root, _ = run(["git", "rev-parse", "--show-toplevel"])
    if rc != 0:
        # Not inside a git work tree.
        cwd = str(Path.cwd().resolve())
        return cwd, Path(cwd).name, None
    root = root.strip()
    name = Path(root).name
    rc, remote, _ = run(["git", "remote", "get-url", "origin"])
    if rc == 0 and remote.strip():
        return normalize_remote(remote), name, "remote"
    return str(Path(root).resolve()), name, "path"


def repo_subpath():
    """Return cwd relative to the git toplevel, POSIX-normalized.

    "." at the repo root (or when not inside a git work tree). Both ends are
    symlink-resolved so worktrees and symlinked checkouts match the globs.
    """
    rc, root, _ = run(["git", "rev-parse", "--show-toplevel"])
    if rc != 0:
        return "."
    try:
        rel = Path.cwd().resolve().relative_to(Path(root.strip()).resolve()).as_posix()
    except ValueError:
        return "."
    return rel or "."


def glob_to_re(glob):
    """Translate a path glob into an anchored regex.

    `**` spans path separators (`.*`), `**/` also matches zero directories, `*`
    stays within one segment (`[^/]*`), and `?` matches one non-separator char.
    Intentionally small: no brace or character-class expansion.
    """
    out, i, n = [], 0, len(glob)
    while i < n:
        if glob.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif glob.startswith("**", i):
            out.append(".*")
            i += 2
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def path_matches(glob, rel):
    """True if `rel` falls under `glob`. A dir glob like `apps/web/**` also
    matches the directory itself (`apps/web`), not just its contents."""
    rel = "." if rel in ("", ".") else rel.replace("\\", "/").rstrip("/")
    if glob_to_re(glob).match(rel):
        return True
    base = glob.rstrip("/*")
    return bool(base) and bool(glob_to_re(base).match(rel))


def lookup_slug(data, key, rel):
    """Resolve (key, sub-path) to (slug, rule_label) using the map.

    rule_label describes which rule matched, for `key`'s debug output:
    a glob string, "default", or None. (None, None) means unmapped.
    """
    entry = data.get("mappings", {}).get(key)
    if entry is None:
        return None, None
    if isinstance(entry, str):
        return entry, None
    for rule in entry.get("paths", []):
        glob = rule.get("glob", "")
        if path_matches(glob, rel):
            return rule.get("context"), f"{glob} -> {rule.get('context')}"
    default = entry.get("default")
    return default, ("default" if default else None)


def load_map():
    if not MAP_PATH.exists():
        return {"version": 1, "mappings": {}}
    try:
        data = json.loads(MAP_PATH.read_text())
    except json.JSONDecodeError as e:
        die(f"context-map.json is not valid JSON: {e}")
    data.setdefault("mappings", {})
    return data


def save_map(data):
    MAP_PATH.write_text(json.dumps(data, indent=2) + "\n")


def known_slugs():
    """Parse `sab context list` -> list of context slugs (active marker stripped)."""
    rc, out, _ = run(["sab", "context", "list"])
    if rc != 0:
        return []
    slugs = []
    for line in out.splitlines():
        line = line.rstrip()
        if not line or line.startswith("CONTEXT") or set(line) <= set("- "):
            continue
        tok = line.split()
        if tok:
            slugs.append(tok[0])
    return slugs


def ensure_sab():
    rc, _, _ = run(["sab", "--version"])
    if rc != 0:
        die("`sab` not found on PATH. Is saboteur-pos linked? (npm link in the repo)")


# --- commands ---------------------------------------------------------------

def cmd_key():
    key, name, kind = repo_identity()
    label = {"remote": "git remote", "path": "repo path", None: "cwd (not a git repo)"}[kind]
    rel = repo_subpath()
    slug, rule = lookup_slug(load_map(), key, rel)
    print(f"repo:  {name}")
    print(f"key:   {key}")
    print(f"via:   {label}")
    print(f"path:  {rel}")
    print(f"rule:  {rule or '(none)'}")
    print(f"slug:  {slug or '(unmapped)'}")


def _fmt_entry(v):
    """One-line summary of a mapping value (string or object)."""
    if isinstance(v, str):
        return v
    parts = [f"default={v.get('default')}"] if v.get("default") else []
    parts += [f"{r.get('glob')}->{r.get('context')}" for r in v.get("paths", [])]
    return "{ " + ", ".join(parts) + " }"


def cmd_list():
    data = load_map()
    mappings = data.get("mappings", {})
    if not mappings:
        print("(context map is empty — add one with: resolve_context.py add <slug>)")
        return
    width = max(len(k) for k in mappings)
    for k, v in sorted(mappings.items()):
        print(f"{k.ljust(width)}  ->  {_fmt_entry(v)}")


def cmd_add(slug, path_glob=None):
    ensure_sab()
    key, name, kind = repo_identity()
    if kind is None:
        die("Not inside a git repository — can't map the current directory.")
    valid = known_slugs()
    if valid and slug not in valid:
        print(f"⚠  '{slug}' is not an existing context. Known: {', '.join(valid)}", file=sys.stderr)
        print("   Mapping saved anyway; create the context with `sab context new` if needed.", file=sys.stderr)
    data = load_map()
    existing = data["mappings"].get(key)

    if path_glob:
        # Lift a bare-string (or absent) mapping into object form, then append
        # the path rule. The on-disk format gains an object, so bump to v2.
        if isinstance(existing, dict):
            entry = existing
        elif isinstance(existing, str):
            entry = {"default": existing, "paths": []}
        else:
            entry = {"paths": []}
        entry.setdefault("paths", []).append({"glob": path_glob, "context": slug})
        data["mappings"][key] = entry
        data["version"] = 2
        save_map(data)
        print(f"Mapped {name} ({key}) path '{path_glob}' -> {slug}")
    else:
        # Setting the repo default: replace a string, or set .default on an
        # existing object without disturbing its path rules.
        if isinstance(existing, dict):
            existing["default"] = slug
        else:
            data["mappings"][key] = slug
        save_map(data)
        print(f"Mapped {name} ({key}) -> {slug}")
    print()
    cmd_resolve()


def cmd_slug():
    """Print the current repo's mapped context slug to stdout, or exit nonzero.

    Pure lookup: reads the map file + git only, never touches sab, never writes.
    Quiet by design so the slug can be captured into a shell variable and passed
    as --context on subsequent commands.
    """
    key, name, _ = repo_identity()
    slug, _ = lookup_slug(load_map(), key, repo_subpath())
    if not slug:
        die(f"repo '{name}' is not mapped to a context")
    print(slug)


def cmd_resolve():
    ensure_sab()
    key, name, kind = repo_identity()
    data = load_map()
    slug, _ = lookup_slug(data, key, repo_subpath())

    if slug:
        rc, out, err = run(["sab", "context", "use", slug])
        if rc != 0:
            die(f"Failed to switch to context '{slug}': {err.strip() or out.strip()}")
        print(f"{name} -> context '{slug}'")
        rc, out, err = run(["sab", "context", "show"])
        sys.stdout.write(out)
        return

    # Unmapped: never change context silently. Report + suggest.
    print(f"Repo '{name}' is not mapped to a context.")
    if kind is None:
        print("(current directory is not a git repository)")
    else:
        print(f"key: {key}")
    rc, out, _ = run(["sab", "context", "show"])
    print(f"Active context unchanged: {out.strip()}")
    slugs = known_slugs()
    if slugs:
        print(f"Available contexts: {', '.join(slugs)}")
    print(f"To map it:  resolve_context.py add <slug>")


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "resolve"
    if cmd == "resolve":
        cmd_resolve()
    elif cmd == "slug":
        cmd_slug()
    elif cmd == "key":
        cmd_key()
    elif cmd == "list":
        cmd_list()
    elif cmd == "add":
        rest = args[1:]
        path_glob = None
        if "--path" in rest:
            p = rest.index("--path")
            if p + 1 >= len(rest):
                die("usage: resolve_context.py add <slug> --path <glob>")
            path_glob = rest[p + 1]
            rest = rest[:p] + rest[p + 2 :]
        if not rest:
            die("usage: resolve_context.py add <slug> [--path <glob>]")
        cmd_add(rest[0], path_glob)
    else:
        die(
            f"unknown command: {cmd}\n"
            "usage: resolve_context.py [resolve|slug|key|add <slug> [--path <glob>]|list]"
        )


if __name__ == "__main__":
    main()
