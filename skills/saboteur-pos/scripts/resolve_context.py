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

Commands:
  resolve   (default)  Look up the current repo and switch context to its
                       mapping, then show it. If unmapped, report and suggest.
  slug                 Print just the mapped context slug for the current repo to
                       stdout (nothing + nonzero exit if unmapped). Designed for
                       capture in a shell var, e.g. SLUG=$(resolve_context.py slug),
                       so callers can pass --context <slug> on every command
                       instead of trusting the shared global active context.
  key                  Print the identity key + repo name for the current repo.
  add <slug>           Map the current repo -> <slug>, then resolve.
  list                 Print the whole context map.

The map lives at ../context-map.json relative to this script's REAL location
(symlinks resolved), so edits land in the source repo, not the symlink.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

MAP_PATH = Path(__file__).resolve().parent.parent / "context-map.json"


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
    print(f"repo:  {name}")
    print(f"key:   {key}")
    print(f"via:   {label}")


def cmd_list():
    data = load_map()
    mappings = data.get("mappings", {})
    if not mappings:
        print("(context map is empty — add one with: resolve_context.py add <slug>)")
        return
    width = max(len(k) for k in mappings)
    for k, v in sorted(mappings.items()):
        print(f"{k.ljust(width)}  ->  {v}")


def cmd_add(slug):
    ensure_sab()
    key, name, kind = repo_identity()
    if kind is None:
        die("Not inside a git repository — can't map the current directory.")
    valid = known_slugs()
    if valid and slug not in valid:
        print(f"⚠  '{slug}' is not an existing context. Known: {', '.join(valid)}", file=sys.stderr)
        print("   Mapping saved anyway; create the context with `sab context new` if needed.", file=sys.stderr)
    data = load_map()
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
    slug = load_map().get("mappings", {}).get(key)
    if not slug:
        die(f"repo '{name}' is not mapped to a context")
    print(slug)


def cmd_resolve():
    ensure_sab()
    key, name, kind = repo_identity()
    data = load_map()
    slug = data.get("mappings", {}).get(key)

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
        if len(args) < 2:
            die("usage: resolve_context.py add <slug>")
        cmd_add(args[1])
    else:
        die(f"unknown command: {cmd}\nusage: resolve_context.py [resolve|slug|key|add <slug>|list]")


if __name__ == "__main__":
    main()
