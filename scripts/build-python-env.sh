#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$ROOT_DIR/build/python-env"
REQ_FILE="$ROOT_DIR/requirements.txt"

PYSTANDALONE_RELEASE="${PYSTANDALONE_RELEASE:-20260310}"
PYSTANDALONE_ARCHIVE="${PYSTANDALONE_ARCHIVE:-cpython-3.13.12+20260310-aarch64-apple-darwin-install_only_stripped.tar.gz}"
PYSTANDALONE_URL="${PYSTANDALONE_URL:-https://github.com/astral-sh/python-build-standalone/releases/download/${PYSTANDALONE_RELEASE}/${PYSTANDALONE_ARCHIVE}}"
ARCHIVE_PATH="$ROOT_DIR/build/python-standalone.tar.gz"

FORCE="${FORCE:-0}"

echo "[python-env] env dir: $ENV_DIR"
echo "[python-env] python url: $PYSTANDALONE_URL"

if [[ ! -f "$REQ_FILE" ]]; then
  echo "[python-env] requirements.txt not found at $REQ_FILE" >&2
  exit 1
fi

PYTHON="$ENV_DIR/python/bin/python3"
if [[ "$FORCE" != "1" && -x "$PYTHON" ]]; then
  echo "[python-env] python env already exists, skipping download (set FORCE=1 to rebuild)"
  "$PYTHON" -m pip install --quiet --no-input -r "$REQ_FILE"
  echo "[python-env] done"
  exit 0
fi

rm -rf "$ENV_DIR"
mkdir -p "$(dirname "$ENV_DIR")"

rm -f "$ARCHIVE_PATH"
curl -L -o "$ARCHIVE_PATH" "$PYSTANDALONE_URL"
mkdir -p "$ENV_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$ENV_DIR"

if [[ ! -x "$PYTHON" ]]; then
  echo "[python-env] expected python at $PYTHON" >&2
  exit 1
fi

"$PYTHON" -m pip install --upgrade pip
"$PYTHON" -m pip install --no-input -r "$REQ_FILE"

echo "[python-env] done"
