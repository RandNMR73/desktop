import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("clean upstream integration is proposed on a candidate branch, never pushed to astral", () => {
  const root = mkdtempSync(join(tmpdir(), "astral-sync-"));
  try {
    const origin = join(root, "origin.git"), upstream = join(root, "upstream.git"), work = join(root, "work"), bin = join(root, "bin");
    const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git(["init", "--bare", origin]); git(["init", "--bare", upstream]);
    mkdirSync(work); git(["init", "-b", "astral"], work);
    git(["config", "user.name", "Fixture"], work); git(["config", "user.email", "fixture@example.invalid"], work);
    writeFileSync(join(work, "fork.txt"), "keep this customization\n");
    git(["add", "fork.txt"], work); git(["commit", "-m", "base"], work);
    const base = git(["rev-parse", "HEAD"], work);
    git(["remote", "add", "origin", origin], work); git(["push", "origin", "astral"], work);
    writeFileSync(join(work, "upstream.txt"), "security fix\n");
    git(["add", "upstream.txt"], work); git(["commit", "-m", "upstream"], work); git(["tag", "1.0"], work);
    git(["push", upstream, "HEAD:dev", "refs/tags/1.0"], work);
    git(["reset", "--hard", base], work);
    mkdirSync(bin);
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    writeFileSync(join(bin, "git"), '#!/bin/sh\nif [ "$1 $2 $3" = "remote add upstream" ]; then exec "$REAL_GIT" remote add upstream "$UPSTREAM_FIXTURE"; fi\nexec "$REAL_GIT" "$@"\n', { mode: 0o755 });
    writeFileSync(join(bin, "gh"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GH_LOG"\ncase "$1 $2" in\n "pr list") printf "%s" "$EXISTING_PR" ;;\n "pr create") echo https://example.invalid/pr/1 ;;\nesac\n', { mode: 0o755 });
    const output = join(root, "output"), log = join(root, "gh.log");
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, REAL_GIT: realGit, UPSTREAM_FIXTURE: upstream,
      GITHUB_REPOSITORY: "fixture/desktop", GITHUB_OUTPUT: output, GH_LOG: log, TAG: "1.0", EXISTING_PR: "" };
    const script = resolve(".github/workflows/src/astral-sync.sh");
    execFileSync("bash", [script], { cwd: work, env, stdio: "pipe" });
    assert.equal(git(["--git-dir", origin, "rev-parse", "astral"]), base);
    const head = git(["rev-parse", "HEAD"], work);
    assert.notEqual(head, base);
    assert.equal(git(["--git-dir", origin, "rev-parse", `codex/upstream-1.0-${head.slice(0, 12)}`]), head);
    assert.equal(readFileSync(join(work, "fork.txt"), "utf8"), "keep this customization\n");
    assert.equal(readFileSync(join(work, "upstream.txt"), "utf8"), "security fix\n");
    assert.match(readFileSync(output, "utf8"), new RegExp(`candidate=${head}`));
    assert.match(readFileSync(log, "utf8"), /pr create .*--base astral/);
    // The next scheduled check preserves the existing review instead of
    // opening another PR or rewriting a reviewer’s in-progress branch.
    git(["reset", "--hard", base], work);
    writeFileSync(log, "");
    execFileSync("bash", [script], { cwd: work, env: { ...env, EXISTING_PR: "42" }, stdio: "pipe" });
    assert.equal(git(["rev-parse", "HEAD"], work), base);
    assert.doesNotMatch(readFileSync(log, "utf8"), /pr create/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
