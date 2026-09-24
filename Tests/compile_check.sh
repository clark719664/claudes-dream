#!/usr/bin/env bash
# Syntax-checks every Unreal-facing source file against the mock engine headers in Tests/MockUE.
# This catches typos, scoping errors, bad argument types and lambda return types without Unreal.
set -euo pipefail
cd "$(dirname "$0")"
MOCK=MockUE/include
rm -rf "$MOCK" && mkdir -p "$MOCK"
# Every engine header the game includes forwards to the single mock header.
grep -h '#include "' ../Source/SkyStack/*.h ../Source/SkyStack/*.cpp | sed -E 's/.*"(.*)".*/\1/' | sort -u | while read -r Header; do
	case "$Header" in
		SkyStack*.h|SkySynth*.h) continue ;;
	esac
	mkdir -p "$MOCK/$(dirname "$Header")"
	if [[ "$Header" == *.generated.h ]]; then
		: > "$MOCK/$Header"
	else
		echo '#include "UEMock.h"' > "$MOCK/$Header"
	fi
done
for Generated in SkyStackBlock SkyStackDirector SkyStackGameMode SkyStackHUD SkyStackSave SkySynth; do
	: > "$MOCK/$Generated.generated.h"
done
# UHT's GENERATED_BODY() declares `Super`; recreate that on a scratch copy of the sources.
SRC=out/src
rm -rf "$SRC" && mkdir -p "$SRC" && cp ../Source/SkyStack/*.h ../Source/SkyStack/*.cpp "$SRC"/
python3 - "$SRC" <<'PY'
import glob, re, sys
for path in glob.glob(sys.argv[1] + '/*.h'):
    text = open(path).read()
    text = re.sub(r'(class \w+ (\w+) : public (\w+)\s*\{\s*GENERATED_BODY\(\))',
                  lambda m: m.group(1) + ' public: using Super = ' + m.group(3) + '; private:', text)
    open(path, 'w').write(text)
PY
Status=0
for Source in "$SRC"/*.cpp; do
	if g++ -std=c++20 -fsyntax-only -Wall -Wno-unused-parameter -Wno-unused-variable -I MockUE -I "$MOCK" -I "$SRC" "$Source" 2> "out/$(basename "$Source").log"; then
		echo "ok    $(basename "$Source")"
	else
		echo "FAIL  $(basename "$Source")"; Status=1
		head -40 "out/$(basename "$Source").log"
	fi
done
exit $Status
