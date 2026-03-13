import { ErrorBanner, mount, useSession } from "@jsr/aai__ui";
import type { Message } from "@jsr/aai__ui";
import { useEffect, useRef } from "preact/hooks";

const CSS = `
@keyframes ic-flicker {
  0% { opacity: 0.97; }
  5% { opacity: 0.95; }
  10% { opacity: 0.98; }
  15% { opacity: 0.96; }
  20% { opacity: 0.99; }
  50% { opacity: 0.96; }
  80% { opacity: 0.98; }
  100% { opacity: 0.97; }
}
@keyframes ic-scanline {
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100vh); }
}
@keyframes ic-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
@keyframes ic-boot {
  0% { opacity: 0; transform: scaleY(0.01); }
  30% { opacity: 1; transform: scaleY(0.01); }
  60% { transform: scaleY(1); }
  100% { transform: scaleY(1); opacity: 1; }
}
@keyframes ic-pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(0, 255, 65, 0.3); }
  50% { box-shadow: 0 0 20px rgba(0, 255, 65, 0.6); }
}
.ic-crt::before {
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
.ic-crt::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: rgba(0, 255, 65, 0.08);
  animation: ic-scanline 8s linear infinite;
  pointer-events: none;
  z-index: 11;
}
.ic-messages::-webkit-scrollbar { width: 6px; }
.ic-messages::-webkit-scrollbar-track { background: #001a00; }
.ic-messages::-webkit-scrollbar-thumb { background: #00ff41; }
.ic-user-msg::before { content: "> "; color: #00ccff; }
.ic-transcript::before { content: "> "; color: #007a1e; }
`;

const ASCII_LOGO = `
 ____  ___  ____  _  __
/__  |/ _ \\|  _ \\| |/ /
  / /| | | | |_) | ' /
 / / | |_| |  _ <| . \\
/_/   \\___/|_| \\_\\_|\\_\\
`;

function InfocomAdventure() {
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

  const msgCount =
    messages.value.filter((m: Message) => m.role === "user").length;

  const dotColor = dotClass === "listening"
    ? "#00ff41"
    : dotClass === "speaking"
    ? "#ffaa00"
    : dotClass === "thinking"
    ? "#00ccff"
    : "#003300";
  const dotShadow = dotClass ? `0 0 6px ${dotColor}` : "none";

  const crtStyle = {
    position: "fixed" as const,
    inset: 0,
    background: "#000800",
    color: "#00ff41",
    fontFamily: "monospace",
    fontSize: "15px",
    lineHeight: 1.6,
    overflow: "hidden",
    animation: "ic-flicker 4s infinite",
  };

  const vignette = {
    position: "fixed" as const,
    inset: 0,
    pointerEvents: "none" as const,
    zIndex: 12,
    background:
      "radial-gradient(ellipse at center, transparent 60%, rgba(0, 0, 0, 0.4) 100%)",
  };

  const btnBase = {
    padding: "4px 16px",
    background: "transparent",
    color: "#00aa2a",
    border: "1px solid #003300",
    fontFamily: "monospace",
    fontSize: "11px",
    cursor: "pointer",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  };

  if (!started.value) {
    return (
      <>
        <style>{CSS}</style>
        <div className="ic-crt" style={crtStyle}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              textAlign: "center",
              padding: "40px",
              animation: "ic-boot 1.5s ease-out",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                whiteSpace: "pre",
                marginBottom: "32px",
                textShadow: "0 0 10px rgba(0, 255, 65, 0.5)",
              }}
            >
              {ASCII_LOGO}
            </div>
            <div
              style={{
                color: "#00aa2a",
                fontSize: "13px",
                marginBottom: "8px",
              }}
            >
              INFOCOM INTERACTIVE FICTION
            </div>
            <div
              style={{
                color: "#00aa2a",
                fontSize: "13px",
                marginBottom: "8px",
              }}
            >
              Copyright (c) 1980 Infocom, Inc.
            </div>
            <div
              style={{
                color: "#00aa2a",
                fontSize: "13px",
                marginBottom: "8px",
              }}
            >
              All rights reserved.
            </div>
            <div
              style={{ color: "#00ff41", fontSize: "13px", marginTop: "16px" }}
            >
              VOICE-ENABLED EDITION
            </div>
            <div
              style={{ color: "#00aa2a", fontSize: "13px", marginTop: "24px" }}
            >
              Release 88 / Serial No. 840726
            </div>
            <button
              type="button"
              style={{
                marginTop: "40px",
                padding: "14px 48px",
                background: "transparent",
                color: "#00ff41",
                border: "1px solid #00ff41",
                fontFamily: "monospace",
                fontSize: "1rem",
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: "3px",
                animation: "ic-pulse 2s ease-in-out infinite",
              }}
              onClick={start}
            >
              Begin Adventure
            </button>
          </div>
          <div style={vignette} />
        </div>
      </>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="ic-crt" style={crtStyle}>
        <div
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 20px",
              background: "#00ff41",
              color: "#000800",
              fontSize: "13px",
              fontWeight: "bold",
              letterSpacing: "0.05em",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", gap: "24px" }}>
              <span>ZORK I</span>
              <span>Moves: {msgCount}</span>
            </div>
            <span>Voice Adventure</span>
          </div>

          <ErrorBanner error={error} />

          <div
            className="ic-messages"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px",
              scrollbarWidth: "thin",
              scrollbarColor: "#00ff41 #001a00",
            }}
          >
            {messages.value.map((msg: Message, i: number) => (
              <div
                key={i}
                className={msg.role === "user" ? "ic-user-msg" : ""}
                style={{
                  marginBottom: "16px",
                  textShadow: msg.role === "user"
                    ? "0 0 5px rgba(0, 204, 255, 0.3)"
                    : "0 0 5px rgba(0, 255, 65, 0.3)",
                  color: msg.role === "user" ? "#00ccff" : "#00ff41",
                }}
              >
                {msg.text}
              </div>
            ))}
            {transcript.value && (
              <div
                className="ic-transcript"
                style={{
                  fontStyle: "italic",
                  color: "#007a1e",
                  textShadow: "0 0 5px rgba(0, 255, 65, 0.15)",
                }}
              >
                {transcript.value}
              </div>
            )}
            <div ref={bottom} />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 20px",
              borderTop: "1px solid #003300",
              background: "#001100",
              flexShrink: 0,
              gap: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontSize: "12px",
                color: "#00aa2a",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: dotColor,
                  boxShadow: dotShadow,
                }}
              />
              <span>{stateLabel}</span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" style={btnBase} onClick={toggle}>
                {running.value ? "[P]ause" : "[R]esume"}
              </button>
              <button type="button" style={btnBase} onClick={reset}>
                [Q]uit
              </button>
            </div>
          </div>
        </div>
        <div style={vignette} />
      </div>
    </>
  );
}

mount(InfocomAdventure);
