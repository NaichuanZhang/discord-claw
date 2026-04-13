/**
 * Silero VAD (Voice Activity Detection) wrapper.
 * Uses the ONNX runtime to run the Silero VAD model directly.
 *
 * The model processes 30ms audio frames at 16kHz (480 samples)
 * and returns a speech probability [0.0 - 1.0].
 */

import * as ort from "onnxruntime-node";
import path from "node:path";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 16000;
/** 30ms frame = 480 samples at 16kHz */
export const FRAME_SIZE = Math.floor(SAMPLE_RATE * 0.03); // 480
const SPEECH_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Model paths
// ---------------------------------------------------------------------------

function getModelPath(): string {
  // Check data/models first (downloaded), then fallback
  const dataPath = path.resolve("data/models/silero_vad.onnx");
  if (fs.existsSync(dataPath)) return dataPath;

  throw new Error(
    "Silero VAD model not found. Download it:\n" +
    "curl -sL -o data/models/silero_vad.onnx https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"
  );
}

// ---------------------------------------------------------------------------
// VAD class
// ---------------------------------------------------------------------------

export class SileroVAD {
  private session: ort.InferenceSession | null = null;
  private _h: ort.Tensor;
  private _c: ort.Tensor;
  private _sr: ort.Tensor;

  constructor() {
    // Initialize LSTM hidden states (2, 1, 64)
    const stateSize = 2 * 1 * 64;
    this._h = new ort.Tensor("float32", new Float32Array(stateSize), [2, 1, 64]);
    this._c = new ort.Tensor("float32", new Float32Array(stateSize), [2, 1, 64]);
    this._sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), [1]);
  }

  /**
   * Initialize the VAD model. Must be called before process().
   */
  async init(): Promise<void> {
    const modelPath = getModelPath();
    console.log(`[vad] Loading Silero VAD model from ${modelPath}`);
    this.session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
    });
    console.log("[vad] Silero VAD model loaded");
  }

  /**
   * Process a single audio frame and return the speech probability.
   * @param frame Float32Array of FRAME_SIZE (480) samples at 16kHz
   * @returns Speech probability [0.0 - 1.0]
   */
  async process(frame: Float32Array): Promise<number> {
    if (!this.session) {
      throw new Error("VAD not initialized. Call init() first.");
    }

    // Ensure frame is the right size
    let inputFrame = frame;
    if (frame.length !== FRAME_SIZE) {
      // Pad or truncate
      inputFrame = new Float32Array(FRAME_SIZE);
      inputFrame.set(frame.subarray(0, FRAME_SIZE));
    }

    const inputTensor = new ort.Tensor("float32", inputFrame, [1, FRAME_SIZE]);

    const feeds: Record<string, ort.Tensor> = {
      input: inputTensor,
      h: this._h,
      c: this._c,
      sr: this._sr,
    };

    const results = await this.session.run(feeds);

    // Update hidden states for next call
    this._h = results["hn"] as ort.Tensor;
    this._c = results["cn"] as ort.Tensor;

    // Get speech probability
    const output = results["output"] as ort.Tensor;
    const prob = (output.data as Float32Array)[0];

    return prob;
  }

  /**
   * Check if a frame contains speech.
   */
  async isSpeech(frame: Float32Array): Promise<boolean> {
    const prob = await this.process(frame);
    return prob > SPEECH_THRESHOLD;
  }

  /**
   * Reset the hidden states (call between utterances or users).
   */
  reset(): void {
    const stateSize = 2 * 1 * 64;
    this._h = new ort.Tensor("float32", new Float32Array(stateSize), [2, 1, 64]);
    this._c = new ort.Tensor("float32", new Float32Array(stateSize), [2, 1, 64]);
  }

  /**
   * Clean up resources.
   */
  async destroy(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
  }
}
