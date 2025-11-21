#!/usr/bin/env bash
set -euo pipefail
git fetch origin --tags
git checkout main
git reset --hard stable-2025-10-28
git push -f origin main
echo "✅ Restored main to stable-2025-10-28"