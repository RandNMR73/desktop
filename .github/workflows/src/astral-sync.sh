#!/usr/bin/env bash
# Daily upstream sync for the Astral fork (see ASTRAL.md): mirror upstream
# `dev` to `upstream-sync`, then merge the newest upstream release tag into
# `astral`. Conflicts become an issue (and a PR when possible), never a push.
# Env: GH_TOKEN, GITHUB_REPOSITORY; optional TAG (default: newest upstream
# release), BRANCH (default: astral), GITHUB_OUTPUT.
set -euo pipefail

branch=${BRANCH:-astral}
out=${GITHUB_OUTPUT:-/dev/null}
repo=${GITHUB_REPOSITORY:?}
echo "merged=false" >> "$out"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git remote add upstream https://github.com/zen-browser/desktop.git 2>/dev/null || true
git fetch --quiet --filter=blob:none --tags upstream dev

# GitHub refuses Actions-token pushes of commits that edit workflow files, so
# the mirror can lag until someone with workflow rights pushes it. Upstream
# `dev` only moves forward, so this is a plain fast-forward push.
if ! git push --quiet origin refs/remotes/upstream/dev:refs/heads/upstream-sync 2> push.err; then
  echo "::warning::upstream-sync not updated: $(tail -1 push.err)"
fi

open_issue() { # title body-file
  local n
  n=$(gh issue list -R "$repo" --state open --search "in:title \"$1\"" --json number -q '.[0].number')
  if test -n "$n"; then
    gh issue comment "$n" -R "$repo" --body-file "$2" >/dev/null
  else
    gh issue create -R "$repo" --title "$1" --body-file "$2" >/dev/null
  fi
}

tag=${TAG:-$(gh api repos/zen-browser/desktop/releases/latest -q .tag_name)}
if ! git rev-parse -q --verify "refs/tags/$tag^{commit}" >/dev/null; then
  echo "::error::upstream tag $tag not found"
  exit 1
fi
echo "tag=$tag" >> "$out"
if git merge-base --is-ancestor "refs/tags/$tag" HEAD; then
  echo "$branch already contains $tag"
  exit 0
fi
prev=$(git describe --tags --abbrev=0 --match '[0-9]*' HEAD 2>/dev/null || true)

git merge --quiet --no-commit --no-ff "refs/tags/$tag" || true
test -f "$(git rev-parse --git-dir)/MERGE_HEAD" || { echo "::error::merge of $tag did not start"; exit 1; }

# Upstream's workflows are disabled in the fork (they need Zen's secrets), so
# astral keeps its own copies and the merge never edits workflow files.
pinned=$({ git diff --name-only HEAD -- .github/workflows; git diff --name-only --diff-filter=U -- .github/workflows; } | sort -u)
for p in $pinned; do
  if git cat-file -e "HEAD:$p" 2>/dev/null; then
    git checkout HEAD -- "$p"
  else
    git rm --quiet --force --cached --ignore-unmatch -- "$p"
    rm -f -- "$p"
  fi
done

conflicts=$(git diff --name-only --diff-filter=U)
if test -z "$conflicts"; then
  git commit --quiet --no-edit -m "Merge upstream release $tag into $branch"
  git push --quiet origin "HEAD:refs/heads/$branch"
  echo "merged=true" >> "$out"
  echo "Merged $tag into $branch"
  if test -n "$pinned"; then
    body=$(mktemp)
    {
      echo "Upstream $tag changed workflow files that \`$branch\` keeps pinned:"
      echo
      printf -- '- `%s`\n' $pinned
      echo
      echo "Check whether \`astral-build.yml\` needs the same change: https://github.com/zen-browser/desktop/compare/${prev:-$tag}...$tag"
    } > "$body"
    open_issue "Upstream $tag changed its build workflows" "$body"
  fi
  exit 0
fi

git merge --abort
body=$(mktemp)
{
  echo "Merging upstream release \`$tag\` into \`$branch\` conflicts in:"
  echo
  printf -- '- `%s`\n' $conflicts
  echo
  echo "Nothing was pushed; \`$branch\` still builds the previous release. To resolve:"
  echo
  echo '```sh'
  echo "git fetch upstream --tags && git switch $branch && git merge $tag"
  echo "# fix the conflicts, keep $branch's copies of upstream workflow files, commit"
  echo "git push origin $branch && gh workflow run astral-build.yml -R $repo"
  echo '```'
} > "$body"
if git push --quiet origin "refs/tags/$tag^{commit}:refs/heads/sync/$tag" 2>/dev/null; then
  pr=$(gh pr list -R "$repo" --head "sync/$tag" --json url -q '.[0].url')
  test -n "$pr" || pr=$(gh pr create -R "$repo" --base "$branch" --head "sync/$tag" \
    --title "Merge upstream $tag into $branch (conflicts)" --body-file "$body")
  echo "PR: $pr" >> "$body"
fi
open_issue "Upstream sync: $tag conflicts with $branch" "$body"
echo "::warning::$tag conflicts with $branch; opened an issue"
