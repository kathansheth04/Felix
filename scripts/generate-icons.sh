#!/bin/bash
# Generate app icons from build/icon-source.png
# First: cp ~/Downloads/felix-logo.png build/icon-source.png
# Then run: npm run generate-icons (or ./scripts/generate-icons.sh)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/build"
SRC="$BUILD_DIR/icon-source.png"

if [[ ! -f "$SRC" ]]; then
  echo "Source image not found: $SRC"
  echo "Copy your logo first: cp ~/Downloads/felix-logo.png build/icon-source.png"
  exit 1
fi

cd "$PROJECT_ROOT"
npx --yes icon-gen -i "$SRC" -o build --ico --icns --ico-name icon --icns-name icon -r

# icon-gen outputs icon.icns, icon.ico; Linux uses icon.png (512 from icns)
# Copy 512x512 for Linux if we have it, else create from source
if [[ ! -f build/icon.png ]]; then
  sips -z 512 512 "$SRC" --out build/icon.png 2>/dev/null || cp "$SRC" build/icon.png
fi

echo "Done. Icons in build/: icon.icns (mac), icon.ico (win), icon.png (linux)"
