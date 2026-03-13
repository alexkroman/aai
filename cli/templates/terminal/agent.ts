import { defineAgent } from "@jsr/aai__sdk";

export default defineAgent({
  name: "Kubernetes Terminal",
  mode: "stt-only",
  sttPrompt: "These are linux shell and kubectl cli commands",
});
