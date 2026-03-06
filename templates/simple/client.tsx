const bounce = keyframes`
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
`;

const styles = {
  base: css`
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
    color: #e0e0e0;
    background: #1a1a2e;
    min-height: 100vh;
    box-sizing: border-box;
  `,
  hero: css`
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 300px;

    & button {
      padding: 16px 32px;
      border: none;
      border-radius: 8px;
      background: #6c63ff;
      color: #e0e0e0;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
    }
  `,
  indicator: css`
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;

    & .dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    & .label {
      font-size: 14px;
      color: #888;
      text-transform: capitalize;
    }
  `,
  error: css`
    background: #2a2a3e;
    color: #ff6b6b;
    padding: 10px 14px;
    border-radius: 8px;
    margin-bottom: 16px;
    font-size: 14px;
  `,
  messages: css`
    min-height: 300px;
    max-height: 500px;
    overflow-y: auto;
    margin-bottom: 16px;
    border: 1px solid #2a2a3e;
    border-radius: 8px;
    padding: 16px;
  `,
  bubble: css`
    margin-bottom: 12px;

    &.user {
      text-align: right;
    }

    & .content {
      display: inline-block;
      max-width: 80%;
      padding: 8px 12px;
      border-radius: 8px;
      text-align: left;
      font-size: 14px;
      background: #2a2a3e;
    }
    &.user .content {
      background: #3a3a4e;
    }
    &.transcript .content {
      background: #3a3a4e;
      opacity: 0.6;
    }
  `,
  thinking: css`
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    margin-bottom: 12px;

    & .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #888;
      animation: ${bounce} 1.4s infinite ease-in-out both;
    }
    & .dot:nth-child(1) {
      animation-delay: 0s;
    }
    & .dot:nth-child(2) {
      animation-delay: 0.16s;
    }
    & .dot:nth-child(3) {
      animation-delay: 0.32s;
    }
  `,
  controls: css`
    display: flex;
    gap: 8px;

    & button {
      padding: 8px 16px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      color: #e0e0e0;
    }
    & .reset {
      border: 1px solid #2a2a3e;
      background: transparent;
      color: #888;
    }
  `,
};

const stateColors: Record<string, string> = {
  connecting: "#f0ad4e",
  ready: "#5cb85c",
  listening: "#5bc0de",
  thinking: "#f0ad4e",
  speaking: "#6c63ff",
  error: "#ff6b6b",
};

export default function NightOwl() {
  const {
    state,
    error,
    messages,
    transcript,
    started,
    running,
    start,
    toggle,
    reset,
  } = useSession();
  const scrollRef = useRef(null);

  useEffect(() => {
    (scrollRef.current as HTMLElement | null)?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages.value, transcript.value, state.value]);

  if (!started.value) {
    return (
      <div class={`${styles.base} ${styles.hero}`}>
        <button type="button" onClick={start}>Start Conversation</button>
      </div>
    );
  }

  return (
    <div class={styles.base}>
      <div class={styles.indicator}>
        <div
          class="dot"
          style={`background:${stateColors[state.value] || "#888"}`}
        />
        <span class="label">{state.value}</span>
      </div>

      {error.value && <div class={styles.error}>{error.value.message}</div>}

      <div class={styles.messages}>
        {messages.value.map((msg, i) => (
          <div
            key={i}
            class={`${styles.bubble} ${msg.role === "user" ? "user" : ""}`}
          >
            <div class="content">
              <div>{msg.text}</div>
            </div>
          </div>
        ))}
        {transcript.value && (
          <div class={`${styles.bubble} user transcript`}>
            <div class="content">
              <div>{transcript.value}</div>
            </div>
          </div>
        )}
        {state.value === "thinking" && (
          <div class={styles.thinking}>
            <div class="dot" />
            <div class="dot" />
            <div class="dot" />
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      <div class={styles.controls}>
        <button
          type="button"
          style={`background:${running.value ? "#ff6b6b" : "#5cb85c"}`}
          onClick={toggle}
        >
          {running.value ? "Stop" : "Resume"}
        </button>
        <button type="button" class="reset" onClick={reset}>
          New Conversation
        </button>
      </div>
    </div>
  );
}
