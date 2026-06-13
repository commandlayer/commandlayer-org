#!/usr/bin/env bash
set -euo pipefail

SRC_BASE="${1:-../clas/schemas}"
DEST_BASE="${2:-public/schemas}"
FAMILIES=("trust-verification" "execution")

if [[ ! -d "$SRC_BASE" ]]; then
  echo "Source directory not found: $SRC_BASE" >&2
  exit 1
fi

mkdir -p "$DEST_BASE"

for family in "${FAMILIES[@]}"; do
  src="$SRC_BASE/$family"
  dest="$DEST_BASE/$family"

  if [[ ! -d "$src" ]]; then
    echo "Source family directory not found: $src" >&2
    exit 1
  fi

  rm -rf "$dest"
  mkdir -p "$dest"
  cp -a "$src"/. "$dest"/

  echo "Synced CLAS $family schemas"
  echo "Source: $src"
  echo "Destination: $dest"
  find "$dest" -type f | sort
done
