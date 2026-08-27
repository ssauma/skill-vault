#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

if [ "${1:-}" = "--dry-run" ]; then
  printf '%s\n' "npm install --global $repository_root"
  printf '%s\n' "skill-vault init"
  exit 0
fi

if [ "$#" -ne 0 ]; then
  printf '%s\n' "usage: ./scripts/install.sh [--dry-run]" >&2
  exit 2
fi

npm install --global "$repository_root"
command -v skill-vault >/dev/null 2>&1
skill-vault init
