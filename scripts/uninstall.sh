#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
dry_run=false
purge=false

for argument in "$@"; do
  case "$argument" in
    --dry-run) dry_run=true ;;
    --purge) purge=true ;;
    *)
      printf '%s\n' "usage: ./scripts/uninstall.sh [--dry-run] [--purge]" >&2
      exit 2
      ;;
  esac
done

if [ "$dry_run" = true ]; then
  if [ "$purge" = true ]; then
    printf '%s\n' "skill-vault uninstall --purge"
  else
    printf '%s\n' "skill-vault uninstall"
  fi
  printf '%s\n' "npm uninstall --global skill-vault"
  exit 0
fi

run_recovery() {
  if command -v skill-vault >/dev/null 2>&1; then
    skill-vault uninstall "$@"
  else
    node "$repository_root/bin/skill-vault.js" uninstall "$@"
  fi
}

if [ "$purge" = true ]; then
  run_recovery --purge
else
  run_recovery
fi

npm uninstall --global skill-vault
