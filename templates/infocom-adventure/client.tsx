import { css, ErrorBanner, keyframes, useSession } from "@aai/ui";
import type { Message } from "@aai/ui";
import { useEffect, useRef } from "preact/hooks";

/* ── animations ── */

const flicker = keyframes`
  0% { opacity: 0.97; }
  5% { opacity: 0.95; }
  10% { opacity: 0.98; }
  15% { opacity: 0.96; }
  20% { opacity: 0.99; }
  50% { opacity: 0.96; }
  80% { opacity: 0.98; }
  100% { opacity: 0.97; }
`;

const scanline = keyframes`
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100vh); }
`;

const blink = keyframes`
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
`;

const bootUp = keyframes`
  0% { opacity: 0; transform: scaleY(0.01); }
  30% { opacity: 1; transform: scaleY(0.01); }
  60% { transform: scaleY(1); }
  100% { transform: scaleY(1); opacity: 1; }
`;

const pulse = keyframes`
  0%, 100% { box-shadow: 0 0 8px rgba(0, 255, 65, 0.3); }
  50% { box-shadow: 0 0 20px rgba(0, 255, 65, 0.6); }
`;

/* ── global styles ── */

const globalCss = css`
  :global(body) {
    margin: 0;
    padding: 0;
    background: #0a0a0a;
    overflow: hidden;
    font-family: "IBM Plex Mono", "Courier New", monospace;
  }
`;

/* ── main wrapper with CRT effect ── */

const crt = css`
  position: fixed;
  inset: 0;
  background: #000800;
  color: #00ff41;
  font-family: "IBM Plex Mono", "Courier New", monospace;
  font-size: 15px;
  line-height: 1.6;
  animation: ${flicker} 4s infinite;
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      rgba(0, 0, 0, 0.15) 0px,
      rgba(0, 0, 0, 0.15) 1px,
      transparent 1px,
      transparent 3px
    );
    pointer-events: none;
    z-index: 10;
  }

  &::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: rgba(0, 255, 65, 0.08);
    animation: ${scanline} 8s linear infinite;
    pointer-events: none;
    z-index: 11;
  }
`;

/* ── boot screen ── */

const bootScreen = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  animation: ${bootUp} 1.5s ease-out;
  text-align: center;
  padding: 40px;

  & .logo {
    font-size: 11px;
    white-space: pre;
    margin-bottom: 32px;
    text-shadow: 0 0 10px rgba(0, 255, 65, 0.5);
  }

  & .info {
    color: #00aa2a;
    font-size: 13px;
    margin-bottom: 8px;
  }

  & .prompt-line {
    margin-top: 32px;
    font-size: 15px;
    display: flex;
    align-items: center;
    gap: 0;
  }

  & .cursor-blink {
    display: inline-block;
    width: 10px;
    height: 18px;
    background: #00ff41;
    animation: ${blink} 1s step-end infinite;
    margin-left: 2px;
  }

  & button {
    margin-top: 40px;
    padding: 14px 48px;
    background: transparent;
    color: #00ff41;
    border: 1px solid #00ff41;
    font-family: "IBM Plex Mono", "Courier New", monospace;
    font-size: 16px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 3px;
    transition: all 0.2s;
    animation: ${pulse} 2s ease-in-out infinite;

    &:hover {
      background: #00ff41;
      color: #000800;
      text-shadow: none;
    }
  }
`;

/* ── game screen ── */

const gameScreen = css`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const header = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  background: #00ff41;
  color: #000800;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 1px;
  flex-shrink: 0;

  & .left {
    display: flex;
    gap: 24px;
  }
`;

const messagesArea = css`
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  scrollbar-width: thin;
  scrollbar-color: #00ff41 #001a00;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: #001a00;
  }
  &::-webkit-scrollbar-thumb {
    background: #00ff41;
  }
`;

const messageLine = css`
  margin-bottom: 16px;
  text-shadow: 0 0 5px rgba(0, 255, 65, 0.3);

  &.user-msg {
    color: #00ccff;
    text-shadow: 0 0 5px rgba(0, 204, 255, 0.3);

    &::before {
      content: "> ";
      color: #00ccff;
    }
  }

  &.agent-msg {
    color: #00ff41;
    padding-left: 0;
  }
`;

const transcriptLine = css`
  color: #007a1e;
  font-style: italic;
  text-shadow: 0 0 5px rgba(0, 255, 65, 0.15);

  &::before {
    content: "> ";
    color: #007a1e;
  }
`;

const statusBar = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  border-top: 1px solid #003300;
  background: #001100;
  flex-shrink: 0;
  gap: 12px;

  & .state-info {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: #00aa2a;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  & .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #003300;
  }
  & .dot.listening {
    background: #00ff41;
    box-shadow: 0 0 6px #00ff41;
  }
  & .dot.speaking {
    background: #ffaa00;
    box-shadow: 0 0 6px #ffaa00;
  }
  & .dot.thinking {
    background: #00ccff;
    box-shadow: 0 0 6px #00ccff;
  }

  & .controls {
    display: flex;
    gap: 8px;
  }

  & button {
    padding: 4px 16px;
    background: transparent;
    color: #00aa2a;
    border: 1px solid #003300;
    font-family: "IBM Plex Mono", "Courier New", monospace;
    font-size: 11px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 1px;

    &:hover {
      border-color: #00ff41;
      color: #00ff41;
    }
  }
`;

/* ── vignette overlay ── */

const vignette = css`
  position: fixed;
  inset: 0;
  background: radial-gradient(
    ellipse at center,
    transparent 60%,
    rgba(0, 0, 0, 0.4) 100%
  );
  pointer-events: none;
  z-index: 12;
`;

/* ── component ── */

const ASCII_LOGO = `
 ____  ___  ____  _  __
/__  |/ _ \\|  _ \\| |/ /
  / /| | | | |_) | ' /
 / / | |_| |  _ <| . \\
/_/   \\___/|_| \\_\\_|\\_\\
`;

export default function InfocomAdventure() {
  const {
    state,
    messages,
    transcript,
    error,
    started,
    running,
    start,
    toggle,
    reset,
  } = useSession();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.value.length, transcript.value]);

  const stateVal = state.value;
  const dotClass = stateVal === "listening"
    ? "listening"
    : stateVal === "speaking"
    ? "speaking"
    : stateVal === "thinking"
    ? "thinking"
    : "";

  const stateLabel = stateVal === "listening"
    ? "Listening"
    : stateVal === "speaking"
    ? "Narrating"
    : stateVal === "thinking"
    ? "Thinking"
    : stateVal === "connecting"
    ? "Connecting"
    : stateVal === "ready"
    ? "Ready"
    : "Idle";

  // Count moves and score from agent messages (rough heuristic)
  const msgCount =
    messages.value.filter((m: Message) => m.role === "user").length;

  if (!started.value) {
    return (
      <div class={`${crt} ${globalCss}`}>
        <div class={bootScreen}>
          <div class="logo">{ASCII_LOGO}</div>
          <div class="info">INFOCOM INTERACTIVE FICTION</div>
          <div class="info">Copyright (c) 1980 Infocom, Inc.</div>
          <div class="info">All rights reserved.</div>
          <div class="info" style="margin-top: 16px; color: #00ff41;">
            VOICE-ENABLED EDITION
          </div>
          <div class="info" style="margin-top: 24px;">
            Release 88 / Serial No. 840726
          </div>
          <button type="button" onClick={start}>Begin Adventure</button>
        </div>
        <div class={vignette} />
      </div>
    );
  }

  return (
    <div class={`${crt} ${globalCss}`}>
      <div class={gameScreen}>
        <div class={header}>
          <div class="left">
            <span>ZORK I</span>
            <span>Moves: {msgCount}</span>
          </div>
          <span>Voice Adventure</span>
        </div>

        <ErrorBanner error={error} />

        <div class={messagesArea}>
          {messages.value.map((msg: Message, i: number) => (
            <div
              key={i}
              class={`${messageLine} ${
                msg.role === "user" ? "user-msg" : "agent-msg"
              }`}
            >
              {msg.text}
            </div>
          ))}
          {transcript.value && (
            <div class={transcriptLine}>{transcript.value}</div>
          )}
          <div ref={bottom} />
        </div>

        <div class={statusBar}>
          <div class="state-info">
            <div class={`dot ${dotClass}`} />
            <span>{stateLabel}</span>
          </div>
          <div class="controls">
            <button type="button" onClick={toggle}>
              {running.value ? "[P]ause" : "[R]esume"}
            </button>
            <button type="button" onClick={reset}>
              [Q]uit
            </button>
          </div>
        </div>
      </div>
      <div class={vignette} />
    </div>
  );
}
