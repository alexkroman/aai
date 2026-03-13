import { defineAgent } from "@aai/sdk";

export default defineAgent({
  name: "My Agent",
  instructions: "You are a helpful voice assistant.",
  greeting: "Hey there! How can I help you?",
});
