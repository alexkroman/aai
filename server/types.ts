import {
  DEFAULT_INPUT_SAMPLE_RATE,
  DEFAULT_OUTPUT_SAMPLE_RATE,
} from "@aai/core/protocol";

export type S2SConfig = {
  wssUrl: string;
  inputSampleRate: number;
  outputSampleRate: number;
};

export const DEFAULT_S2S_CONFIG: S2SConfig = {
  wssUrl: "wss://speech-to-speech.us.assemblyai.com/v1/realtime",
  inputSampleRate: DEFAULT_INPUT_SAMPLE_RATE,
  outputSampleRate: DEFAULT_OUTPUT_SAMPLE_RATE,
};
