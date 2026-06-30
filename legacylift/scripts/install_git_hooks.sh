#!/usr/bin/env sh
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
git config core.hooksPath .githooks
chmod +x .githooks/post-merge .githooks/post-checkout 2>/dev/null || true
echo "Installed git hooks from .githooks (post-merge and post-checkout will sync conduct_demo_script.md)."
python3 legacylift/scripts/sync_conduct_demo_script.py 2>/dev/null || python legacylift/scripts/sync_conduct_demo_script.py
