#!/bin/bash
# Migration: Download Silero VAD v4 model
# The v5 model (from master) is incompatible with onnxruntime-node 1.24+
# and produces near-zero probabilities for all inputs. v4 works correctly.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="$SCRIPT_DIR/data/models"
MODEL_PATH="$MODEL_DIR/silero_vad.onnx"
MODEL_URL="https://github.com/snakers4/silero-vad/raw/refs/tags/v4.0/files/silero_vad.onnx"

# Expected size of the v4 model (~1.8MB). The v5 model is ~2.3MB.
V4_MIN_SIZE=1500000
V4_MAX_SIZE=2000000

mkdir -p "$MODEL_DIR"

# Check if we already have the v4 model (by file size heuristic)
if [ -f "$MODEL_PATH" ]; then
  FILE_SIZE=$(stat -c %s "$MODEL_PATH")
  if [ "$FILE_SIZE" -ge "$V4_MIN_SIZE" ] && [ "$FILE_SIZE" -le "$V4_MAX_SIZE" ]; then
    echo "[migration] Silero VAD v4 model already present ($FILE_SIZE bytes), skipping download"
    exit 0
  else
    echo "[migration] Existing model is $FILE_SIZE bytes (likely v5), replacing with v4..."
    mv "$MODEL_PATH" "$MODEL_PATH.bak"
  fi
fi

echo "[migration] Downloading Silero VAD v4 model..."
if curl -sL -o "$MODEL_PATH" "$MODEL_URL"; then
  FILE_SIZE=$(stat -c %s "$MODEL_PATH")
  echo "[migration] Downloaded Silero VAD v4 model ($FILE_SIZE bytes)"
  rm -f "$MODEL_PATH.bak"
else
  echo "[migration] ERROR: Failed to download model"
  # Restore backup if download failed
  if [ -f "$MODEL_PATH.bak" ]; then
    mv "$MODEL_PATH.bak" "$MODEL_PATH"
  fi
  exit 1
fi
