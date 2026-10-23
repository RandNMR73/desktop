#!/usr/bin/env bash
# Publishes the build in <dir> as GitHub Release astral-<VERSION>-<n>.
# Env: VERSION (upstream display version), SHA (commit built), GH_TOKEN,
# GITHUB_REPOSITORY. Skips publishing when SHA is already the latest release.
set -euo pipefail

out=${1:?usage: astral-release.sh <dir>}
: "${VERSION:?}" "${SHA:?}"

git fetch --tags --force origin >/dev/null 2>&1 || true

prev=$(git tag --list 'astral-*' --sort=-creatordate | head -1)
if test -n "$prev" && test "$(git rev-parse "$prev^{commit}")" = "$SHA"; then
  echo "$SHA is already released as $prev; nothing to publish."
  exit 0
fi

n=1
while git rev-parse -q --verify "refs/tags/astral-$VERSION-$n" >/dev/null; do
  n=$((n + 1))
done
tag="astral-$VERSION-$n"

notes=$(mktemp)
{
  echo "Zen $VERSION ([upstream release notes](https://github.com/zen-browser/desktop/releases/tag/$VERSION)) with the Astral patches, built from \`${SHA:0:12}\` for macOS arm64."
  echo
  if test -n "$prev"; then
    echo "### Changes since $prev"
    git log --first-parent --format='- %s (%h)' "$prev..$SHA" | head -60
  else
    echo "### Changes"
    echo "- First Astral build."
  fi
  echo
  echo "### Astral patches"
  sed -n '/<!-- patches -->/,/<!-- \/patches -->/p' ASTRAL.md | sed '1d;$d'
  echo
  echo "Unsigned (ad-hoc) build. Install with Astralforge's \`scripts/zen-fork-update.sh\`, which verifies the SHA-256 below."
  echo
  echo '```'
  cat "$out"/*.sha256
  echo '```'
} > "$notes"
cat "$notes"

gh release create "$tag" \
  --repo "$GITHUB_REPOSITORY" \
  --target "$SHA" \
  --title "Zen $VERSION · Astral $n" \
  --notes-file "$notes" \
  --latest \
  "$out"/*.dmg "$out"/*.sha256 "$out"/platform.ini
echo "Published $tag"
