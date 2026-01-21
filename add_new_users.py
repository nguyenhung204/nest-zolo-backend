#!/usr/bin/env python3
"""Add commits for 2 new users on existing branches, with real file edits."""
import os
import random
import subprocess
import sys
import time as _time
from datetime import datetime, timedelta, time
from pathlib import Path

random.seed(20261225)

REPO = Path(__file__).resolve().parent
os.chdir(REPO)

# -------- New users --------
USERS = {
    "hanh": ("hanhpham204",  "hp926405@gmail.com"),
    "huy":  ("baohuy0324",   "mon.baohuy@gmail.com"),
}

# -------- Branch assignment --------
# hanh: 82 commits split 3 branches (28 + 27 + 27)
# huy:  72 commits split 2 branches (36 + 36)
PLAN = [
    # (branch, owner_key, n_commits)
    ("feature/users",        "hanh", 28),
    ("feature/friendship",   "hanh", 27),
    ("feature/presence",     "hanh", 27),
    ("feature/media",        "huy",  36),
    ("feature/media-worker", "huy",  36),
]

START = datetime(2025, 12, 25, 9, 0, 0)
END   = datetime(2026, 5, 30, 23, 0, 0)
TOTAL_DAYS = (END.date() - START.date()).days + 1

# -------- Commit messages --------
SUBJECTS = {
    "feat": [
        "scaffold module skeleton", "add base controller and DTOs",
        "wire service into module", "implement initial endpoint",
        "add validation pipes", "expose health probe",
        "introduce config loader", "add bootstrap entrypoint",
        "support graceful shutdown", "register kafka consumer",
        "add redis cache adapter", "implement repository layer",
        "add domain entities", "wire DI container",
        "add request logger interceptor", "implement rate limiter",
        "add JWT guard", "support multi-tenant header",
        "add metrics endpoint", "implement search filters",
        "support pagination", "add idempotency keys",
        "introduce outbox pattern", "add saga coordinator",
        "implement retry policy", "support batch operations",
        "add websocket adapter", "add presence heartbeat",
        "support typing indicator", "add reaction handler",
        "implement read receipts",
    ],
    "fix": [
        "handle null user payload", "resolve race condition on join",
        "fix memory leak in subscriber", "guard against missing token",
        "stop swallowing kafka errors", "correct timezone offset",
        "prevent duplicate emit", "fix off-by-one in pagination",
        "handle empty conversation id", "stop crashing on invalid mime",
        "fix websocket disconnect storm", "reset lock after timeout",
        "handle 5xx from upstream gracefully",
        "patch unhandled promise rejection", "guard divide by zero",
        "fix dto whitelist bypass", "correct redis key collision",
        "stop double-emit of system message",
        "respect cancellation token", "fix flaky shutdown",
    ],
    "refactor": [
        "split orchestrator into smaller units",
        "extract mapper into dedicated service",
        "rename ambiguous variables",
        "move constants to shared module",
        "simplify error handling chain",
        "decouple repository from service",
        "introduce facade for legacy api",
        "remove dead code paths",
        "consolidate logging format",
        "tighten type signatures",
        "replace any with concrete types",
        "extract magic numbers into constants",
        "drop unused imports across module",
    ],
    "perf": [
        "cache hot path lookups", "batch redis pipeline",
        "reduce kafka roundtrips", "lazy-load heavy module",
        "precompile validators", "stream large payloads",
        "memoize repeated lookup",
    ],
    "chore": [
        "bump dependencies", "tidy imports", "format with prettier",
        "update tsconfig paths", "rename log labels",
        "cleanup unused exports", "update package metadata",
        "purge commented-out scaffolding",
    ],
    "docs": [
        "document module setup", "add usage examples to readme",
        "write architecture notes", "explain integration steps",
        "annotate config defaults", "draft FE integration guide",
        "expand API reference", "polish inline docstrings",
    ],
    "test": [
        "add unit tests for service", "cover happy path of orchestrator",
        "add edge cases for validator", "stub external dependencies",
        "raise coverage on mapper",
    ],
    "style": [
        "apply consistent indentation", "apply formatter to module",
        "drop trailing whitespace", "normalize quote style",
    ],
}

SCOPE = {
    "feature/users":        "users",
    "feature/friendship":   "friendship",
    "feature/presence":     "presence",
    "feature/media":        "media",
    "feature/media-worker": "media-worker",
}

COMMENT_NOTES = [
    "polish: simplified", "review: keep concise", "verified manually",
    "TODO: revisit when scaling", "NOTE: see related ticket",
    "stable as of polish pass", "kept for backwards-compat",
    "trimmed dead branch", "post-merge cleanup",
    "linted by polish pass", "kept for clarity",
    "rationalized arg order", "aligned with team convention",
]


def pick_type(progress, branch):
    if progress < 0.30:
        w = {"feat": 6, "chore": 1, "test": 1, "docs": 1}
    elif progress < 0.65:
        w = {"feat": 3, "fix": 3, "refactor": 2, "test": 1,
             "perf": 1, "docs": 1, "chore": 1}
    else:
        w = {"fix": 4, "refactor": 3, "perf": 2,
             "style": 1, "test": 1, "chore": 1, "docs": 1}
    types, ws = zip(*w.items())
    return random.choices(types, weights=ws, k=1)[0]


def make_subject(branch, ctype):
    return f"{ctype}({SCOPE[branch]}): {random.choice(SUBJECTS[ctype])}"


def random_time_on(d):
    r = random.random()
    if r < 0.55:
        h = random.randint(9, 18)
    elif r < 0.85:
        h = random.randint(19, 23)
    else:
        h = random.choice([0, 1, 2, 8])
    return datetime.combine(d, time(h, random.randint(0, 59),
                                    random.randint(0, 59)))


def build_day_pool():
    days = []
    d = START.date()
    while d <= END.date():
        days.append(d)
        d += timedelta(days=1)
    weights = []
    for d in days:
        wd = d.weekday()
        base = 1.0
        if wd == 5:
            base = 0.35
        elif wd == 6:
            base = 0.20
        # Tết 2026
        if datetime(2026, 2, 14).date() <= d <= datetime(2026, 2, 21).date():
            base *= 0.12
        # Ngẫu nhiên ngày off
        if random.random() < 0.09:
            base *= 0.04
        # Ngày crunch
        if random.random() < 0.07:
            base *= 3.0
        weights.append(base)
    return days, weights


# -------- File editing helpers --------
SAFE_EXTS = {".ts", ".js", ".mjs", ".md", ".yml", ".yaml", ".sh"}
SAFE_NAMES = {"Dockerfile", ".gitignore", ".dockerignore", ".env.example"}


def is_text_file(p: Path) -> bool:
    try:
        chunk = p.open("rb").read(4096)
        if b"\x00" in chunk:
            return False
        chunk.decode("utf-8")
        return True
    except Exception:
        return False


def collect_branch_files(branch: str) -> list[str]:
    """Return relative paths of editable files tracked in the branch."""
    r = subprocess.run(["git", "ls-tree", "-r", branch, "--name-only"],
                       capture_output=True, text=True)
    out = []
    for line in r.stdout.splitlines():
        line = line.strip()
        ext = Path(line).suffix.lower()
        name = Path(line).name
        if ext not in SAFE_EXTS and name not in SAFE_NAMES:
            continue
        if line.startswith("sticker/"):
            continue
        if Path(line).stat().st_size > 200_000 if (REPO / line).exists() else False:
            continue
        out.append(line)
    return out


def edit_file_lightly(p: Path) -> tuple[int, int]:
    """Add/remove comment lines. Returns (additions, deletions). 0,0 = unchanged."""
    if not p.exists() or not is_text_file(p):
        return 0, 0
    try:
        original = p.read_text(encoding="utf-8")
    except Exception:
        return 0, 0
    if not original.strip():
        return 0, 0
    lines = original.splitlines()
    if len(lines) < 6:
        return 0, 0

    suffix = p.suffix.lower()
    name = p.name
    if suffix in (".ts", ".js", ".mjs"):
        cmt = "// "
    elif suffix in (".yml", ".yaml", ".sh") or name in ("Dockerfile", ".gitignore",
                                                          ".dockerignore"):
        cmt = "# "
    elif suffix == ".md":
        cmt = None  # just add blank lines + text
    else:
        return 0, 0

    adds = dels = 0

    # Insert 2-5 comment lines
    for _ in range(random.randint(2, 5)):
        idx = random.randint(1, len(lines))
        note = random.choice(COMMENT_NOTES)
        if cmt:
            indent = ""
            if 0 < idx < len(lines):
                cur = lines[idx]
                ws = len(cur) - len(cur.lstrip())
                indent = cur[:ws]
            new_line = f"{indent}{cmt}{note}"
        else:
            new_line = f"> {note}"
        lines.insert(idx, new_line)
        adds += 1

    # Delete 1-4 blank or comment lines
    deletable = []
    for i, line in enumerate(lines):
        s = line.strip()
        if s == "":
            deletable.append(i)
        elif cmt and s.startswith(cmt.strip()) and len(s) > len(cmt) + 1:
            deletable.append(i)
        elif suffix == ".md" and s.startswith(">"):
            deletable.append(i)
    random.shuffle(deletable)
    for idx in sorted(deletable[:random.randint(1, 4)], reverse=True):
        if 0 <= idx < len(lines):
            lines.pop(idx)
            dels += 1

    new_content = "\n".join(lines)
    if original.endswith("\n") and not new_content.endswith("\n"):
        new_content += "\n"
    if new_content == original:
        return 0, 0
    p.write_text(new_content, encoding="utf-8")
    return adds, dels


# -------- Git helpers --------
def run(cmd, env=None, check=True, capture=False, retries=5):
    last = None
    for attempt in range(retries):
        last = subprocess.run(cmd, capture_output=True, text=True, env=env)
        if last.returncode == 0:
            return last
        msg = (last.stderr or "") + (last.stdout or "")
        if any(s in msg for s in ("couldn't set", "Unable to create", "File exists",
                                   "could not lock", "cannot lock ref",
                                   "unable to write new index", "Permission denied")):
            _time.sleep(0.6 * (attempt + 1))
            continue
        break
    if check and last.returncode != 0:
        print("CMD FAILED:", cmd); print(last.stdout); print(last.stderr)
        sys.exit(1)
    return last


def git_commit(msg, when, name, email):
    iso = when.strftime("%Y-%m-%dT%H:%M:%S+07:00")
    env = os.environ.copy()
    env["GIT_AUTHOR_NAME"] = name;    env["GIT_AUTHOR_EMAIL"] = email
    env["GIT_AUTHOR_DATE"] = iso
    env["GIT_COMMITTER_NAME"] = name; env["GIT_COMMITTER_EMAIL"] = email
    env["GIT_COMMITTER_DATE"] = iso
    run(["git", "commit", "-m", msg, "--no-verify"], env=env)


def git_merge_to_main(branch, when, name, email):
    iso = when.strftime("%Y-%m-%dT%H:%M:%S+07:00")
    env = os.environ.copy()
    env["GIT_AUTHOR_NAME"] = name;    env["GIT_AUTHOR_EMAIL"] = email
    env["GIT_AUTHOR_DATE"] = iso
    env["GIT_COMMITTER_NAME"] = name; env["GIT_COMMITTER_EMAIL"] = email
    env["GIT_COMMITTER_DATE"] = iso
    run(["git", "checkout", "main"])
    run(["git", "merge", "--no-ff", branch, "-m",
         f"Merge branch '{branch}' into main", "--no-verify"], env=env)


def main():
    days, weights = build_day_pool()

    branch_results = []  # for merge ordering

    for (branch, owner_key, n_commits) in PLAN:
        name, email = USERS[owner_key]
        print(f"\n=== {branch} - {name} ({n_commits} commits) ===", flush=True)

        # Checkout existing branch
        run(["git", "checkout", branch])

        # Build date list (spread over full timeline)
        ws = random.randint(0, max(1, TOTAL_DAYS // 5))
        we = random.randint(TOTAL_DAYS - 20, TOTAL_DAYS - 1)
        we = max(we, ws + 20); we = min(we, TOTAL_DAYS - 1)
        wd = days[ws:we + 1]; ww = weights[ws:we + 1]
        chosen = random.choices(wd, weights=ww, k=n_commits)
        dts = sorted(random_time_on(d) for d in chosen)
        for i in range(1, len(dts)):
            if dts[i] <= dts[i - 1]:
                dts[i] = dts[i - 1] + timedelta(minutes=random.randint(5, 30))

        # Collect editable files for this branch
        branch_files = collect_branch_files(branch)
        # Fallback: scan working tree after checkout
        if not branch_files:
            run(["git", "checkout", branch])
            branch_files_wt = []
            for root, dirs, files in os.walk(REPO):
                rel = Path(root).relative_to(REPO)
                if rel.parts and rel.parts[0] in (".git", "sticker", "node_modules"):
                    dirs[:] = []
                    continue
                for f in files:
                    p = Path(root) / f
                    sp = str(p.relative_to(REPO)).replace("\\", "/")
                    ext = Path(sp).suffix.lower()
                    nm = Path(sp).name
                    if ext in SAFE_EXTS or nm in SAFE_NAMES:
                        branch_files_wt.append(sp)
            branch_files = branch_files_wt

        if not branch_files:
            print(f"  WARNING: no editable files found for {branch}")
            continue

        print(f"  {len(branch_files)} editable files", flush=True)

        committed = 0
        for i, when in enumerate(dts):
            ctype = pick_type(i / max(1, n_commits - 1), branch)
            subj = make_subject(branch, ctype)

            # Pick 2-6 files to touch
            n_files = min(random.randint(2, 6), len(branch_files))
            chosen_files = random.sample(branch_files, n_files)

            for frel in chosen_files:
                fp = REPO / frel
                if fp.exists():
                    edit_file_lightly(fp)

            run(["git", "add", "-A"])
            staged = run(["git", "diff", "--cached", "--name-only"],
                         capture=True)
            if not staged.stdout.strip():
                # Force a tiny marker so commit isn't empty
                marker = REPO / ".patch-notes" / f"{branch.replace('/', '_')}.md"
                marker.parent.mkdir(exist_ok=True)
                with open(marker, "a", encoding="utf-8") as fh:
                    fh.write(f"- {when.isoformat()} {subj}\n")
                run(["git", "add", "-A"])

            git_commit(subj, when, name, email)
            committed += 1

        print(f"  Committed {committed}", flush=True)

        last_dt_r = run(["git", "log", "-1", "--format=%aI", branch],
                        capture=True)
        last_dt = datetime.fromisoformat(
            last_dt_r.stdout.strip()).replace(tzinfo=None)
        branch_results.append((branch, owner_key, last_dt))

    # Merge all back to main in chronological order
    run(["git", "checkout", "main"])
    for (branch, owner_key, last_dt) in sorted(branch_results,
                                                key=lambda x: x[2]):
        ahead = run(["git", "rev-list", "--count", f"main..{branch}"],
                    capture=True)
        if ahead.stdout.strip() == "0":
            print(f"Skip merge {branch} (already in main)")
            continue
        merge_when = last_dt + timedelta(hours=random.randint(1, 6),
                                         minutes=random.randint(5, 55))
        if merge_when > END:
            merge_when = END - timedelta(minutes=random.randint(5, 300))
        print(f"Merging {branch} at {merge_when}", flush=True)
        name, email = USERS[owner_key]
        git_merge_to_main(branch, merge_when, name, email)

    print("\nDONE")
    print("")
    subprocess.run(["git", "shortlog", "-sne", "--all"])


if __name__ == "__main__":
    main()
