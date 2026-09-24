#!/usr/bin/env bash
# Builds and runs SkyStack's engine-free tests (game rules + synth) with strict warnings.
# Usage: Tests/run.sh            unit tests
#        Tests/run.sh render     also writes the game's audio to Tests/out/*.wav
#        Tests/run.sh simulate   also runs the difficulty simulation
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
FLAGS="-std=c++20 -O2 -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wno-sign-conversion -Werror"
g++ $FLAGS -o out/rules_tests RulesTests.cpp ../Source/SkyStack/SkySynthCore.cpp
./out/rules_tests
if [[ "${1:-}" == "render" ]]; then
	g++ $FLAGS -o out/render_audio RenderAudio.cpp ../Source/SkyStack/SkySynthCore.cpp
	./out/render_audio out
fi
if [[ "${1:-}" == "simulate" ]]; then
	g++ $FLAGS -o out/simulate Simulate.cpp
	./out/simulate
fi
