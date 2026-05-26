#!/usr/bin/env bash
set -euo pipefail

SRC_ROOT="${1:-../clas/schemas/trust-verification}"
DEST_ROOT="${2:-public/schemas/trust-verification}"

if [[ ! -d "$SRC_ROOT" ]]; then
  echo "Source directory not found: $SRC_ROOT" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST_ROOT")"
rm -rf "$DEST_ROOT"
mkdir -p "$DEST_ROOT"

cp -a "$SRC_ROOT"/. "$DEST_ROOT"/

echo "Synced CLAS trust-verification schemas"
echo "Source: $SRC_ROOT"
echo "Destination: $DEST_ROOT"
find "$DEST_ROOT" -type f | sort
