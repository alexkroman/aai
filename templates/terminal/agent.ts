import { defineAgent } from "@aai/sdk";

export default defineAgent({
  name: "Kubernetes Terminal",
  mode: "stt-only",
  sttPrompt: "These are linux shell and kubectl cli commands",
});
