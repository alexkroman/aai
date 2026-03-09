import { css, keyframes, useSession } from "@aai/ui";
import { useEffect, useRef } from "preact/hooks";

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`;

const slideIn = keyframes`
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

const alertColors: Record<string, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
};

const severityColors: Record<string, string> = {
  critical: "#ef4444",
  urgent: "#f97316",
  moderate: "#eab308",
  minor: "#22c55e",
};

const statusColors: Record<string, string> = {
  incoming: "#818cf8",
  triaged: "#a78bfa",
  dispatched: "#f59e0b",
  en_route: "#3b82f6",
  on_scene: "#22c55e",
  resolved: "#6b7280",
  escalated: "#ef4444",
};

const containerStyle = css`
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  background: #0a0a0f;
  color: #e2e8f0;
  min-height: 100vh;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
`;

const headerStyle = css`
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-bottom: 1px solid #1e293b;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`;

const titleStyle = css`
  font-size: 18px;
  font-weight: 700;
  color: #f1f5f9;
  letter-spacing: 1px;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const alertBadgeStyle = (level: string) =>
  css`
    background: ${alertColors[level] || "#6b7280"};
    color: ${level === "yellow" ? "#000" : "#fff"};
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    animation: ${level === "red" ? `${pulse} 1s ease-in-out infinite` : "none"};
  `;

const mainStyle = css`
  display: grid;
  grid-template-columns: 1fr 320px;
  grid-template-rows: 1fr;
  flex: 1;
  overflow: hidden;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
`;

const feedStyle = css`
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid #1e293b;
`;

const messagesStyle = css`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: #334155;
    border-radius: 3px;
  }
`;

const messageStyle = (role: string) =>
  css`
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.5;
    max-width: 85%;
    animation: ${slideIn} 0.2s ease-out;
    ${role === "assistant"
      ? `background: #1e293b; align-self: flex-start; border-left: 3px solid #3b82f6;`
      : `background: #172554; align-self: flex-end; border-right: 3px solid #22d3ee;`};
  `;

const transcriptStyle = css`
  padding: 8px 16px;
  background: #111827;
  border-top: 1px solid #1e293b;
  font-size: 12px;
  color: #64748b;
  font-style: italic;
  min-height: 32px;
  display: flex;
  align-items: center;
`;

const sidebarStyle = css`
  background: #111827;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: #334155;
    border-radius: 3px;
  }
`;

const panelStyle = css`
  background: #1a1a2e;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 12px;
`;

const panelTitleStyle = css`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: #64748b;
  margin-bottom: 10px;
`;

const metricRowStyle = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 12px;
`;

const incidentCardStyle = (severity: string) =>
  css`
    background: #0f172a;
    border: 1px solid ${severityColors[severity] || "#334155"}40;
    border-left: 3px solid ${severityColors[severity] || "#334155"};
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 8px;
    animation: ${slideIn} 0.3s ease-out;
  `;

const _resourceDotStyle = (status: string) =>
  css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    margin-right: 6px;
    background: ${status === "available"
      ? "#22c55e"
      : status === "on_scene"
      ? "#3b82f6"
      : status === "dispatched" || status === "en_route"
      ? "#f59e0b"
      : "#6b7280"};
    ${status === "dispatched"
      ? `animation: ${pulse} 1.5s ease-in-out infinite;`
      : ""};
  `;

const controlBarStyle = css`
  padding: 12px 16px;
  background: #111827;
  border-top: 1px solid #1e293b;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const buttonStyle = (variant: "primary" | "secondary" | "danger") =>
  css`
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    transition: all 0.15s ease;

    ${variant === "primary"
      ? `
    background: #2563eb;
    color: white;
    &:hover { background: #1d4ed8; }
  `
      : variant === "danger"
      ? `
    background: #dc2626;
    color: white;
    &:hover { background: #b91c1c; }
  `
      : `
    background: #334155;
    color: #e2e8f0;
    &:hover { background: #475569; }
  `};
  `;

const stateIndicatorStyle = (state: string) =>
  css`
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: ${state === "listening"
      ? "#22c55e"
      : state === "thinking"
      ? "#eab308"
      : state === "speaking"
      ? "#3b82f6"
      : state === "ready"
      ? "#22c55e"
      : state === "error"
      ? "#ef4444"
      : "#6b7280"};
    ${state === "listening"
      ? `animation: ${pulse} 1.5s ease-in-out infinite;`
      : ""} ${state === "thinking"
      ? `animation: ${pulse} 0.8s ease-in-out infinite;`
      : ""};
  `;

// Parse incident data from messages for the sidebar
function extractIncidents(
  messages: { role: string; text: string }[],
  // deno-lint-ignore no-explicit-any
): Map<string, Record<string, any>> {
  const incidents = new Map();
  for (const msg of messages) {
    // Look for incident IDs in messages
    const incMatches = msg.text.matchAll(/INC-\d{4}/g);
    for (const m of incMatches) {
      const id = m[0];
      if (!incidents.has(id)) {
        incidents.set(id, { id, mentioned: 0 });
      }
      incidents.get(id).mentioned++;
    }

    // Try to extract severity and status keywords near incident IDs
    const lines = msg.text.split("\n");
    for (const line of lines) {
      const idMatch = line.match(/INC-\d{4}/);
      if (!idMatch) continue;
      const id = idMatch[0];
      const inc = incidents.get(id) || { id, mentioned: 0 };

      for (const sev of ["critical", "urgent", "moderate", "minor"]) {
        if (line.toLowerCase().includes(sev)) inc.severity = sev;
      }
      for (
        const st of [
          "incoming",
          "triaged",
          "dispatched",
          "en_route",
          "on_scene",
          "resolved",
          "escalated",
        ]
      ) {
        if (
          line.toLowerCase().includes(st.replace("_", " ")) ||
          line.toLowerCase().includes(st)
        ) inc.status = st;
      }
      // Extract location snippets
      const locMatch = line.match(/(?:at|to|location:?)\s+([^,.\n]{5,50})/i);
      if (locMatch) inc.location = locMatch[1].trim();

      incidents.set(id, inc);
    }
  }
  return incidents;
}

function extractAlertLevel(messages: { role: string; text: string }[]): string {
  let level = "green";
  for (const msg of messages) {
    const match = msg.text.match(/alert level[:\s]+(\w+)/i);
    if (match) level = match[1].toLowerCase();
    if (
      msg.text.includes("alert level is red") || msg.text.includes("ALERT: RED")
    ) level = "red";
    if (msg.text.includes("alert level is orange")) level = "orange";
    if (msg.text.includes("alert level is yellow")) level = "yellow";
  }
  return level;
}

export default function App() {
  const session = useSession();
  const msgs = session.messages.value;
  const tx = session.transcript.value;
  const state = session.state.value;
  const error = session.error.value;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const incidents = extractIncidents(msgs);
  const alertLevel = extractAlertLevel(msgs);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  const incidentList = Array.from(incidents.values()).reverse();
  const activeIncidents = incidentList.filter((i) => i.status !== "resolved");
  const resolvedCount =
    incidentList.filter((i) => i.status === "resolved").length;

  return (
    <div class={containerStyle}>
      {/* Header */}
      <div class={headerStyle}>
        <div class={titleStyle}>
          <span style="color: #3b82f6;">&#9670;</span>
          Dispatch Command Center
          <span class={stateIndicatorStyle(state)} title={state} />
          <span style="font-size: 11px; color: #64748b; font-weight: 400; text-transform: none;">
            {state === "listening"
              ? "LISTENING"
              : state === "thinking"
              ? "PROCESSING"
              : state === "speaking"
              ? "TRANSMITTING"
              : state.toUpperCase()}
          </span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <span style="font-size: 10px; color: #64748b; letter-spacing: 1px;">
            SYSTEM ALERT:
          </span>
          <span class={alertBadgeStyle(alertLevel)}>
            {alertLevel.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div class={mainStyle}>
        {/* Left: conversation feed */}
        <div class={feedStyle}>
          <div class={messagesStyle}>
            {msgs.length === 0 && (
              <div style="text-align: center; color: #475569; padding: 40px 20px; font-size: 13px;">
                Dispatch Command Center standing by. Click START to begin
                operations.
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} class={messageStyle(m.role)}>
                <div
                  style={`font-size: 10px; color: #64748b; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;`}
                >
                  {m.role === "assistant" ? "DISPATCH" : "OPERATOR"}
                </div>
                {m.text}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {tx && (
            <div class={transcriptStyle}>
              <span class={stateIndicatorStyle("listening")} />
              {tx}
            </div>
          )}

          {error && (
            <div style="padding: 8px 16px; background: #7f1d1d; color: #fca5a5; font-size: 12px; border-top: 1px solid #991b1b;">
              ERROR: {error.message} ({error.code})
            </div>
          )}

          <div class={controlBarStyle}>
            {!session.started.value
              ? (
                <button
                  type="button"
                  class={buttonStyle("primary")}
                  onClick={() => session.start()}
                >
                  Start Dispatch
                </button>
              )
              : (
                <>
                  <button
                    type="button"
                    class={buttonStyle(
                      session.running.value ? "secondary" : "primary",
                    )}
                    onClick={() => session.toggle()}
                  >
                    {session.running.value ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    class={buttonStyle("danger")}
                    onClick={() => session.reset()}
                  >
                    Reset
                  </button>
                </>
              )}
            <div style="flex: 1;" />
            <span style="font-size: 10px; color: #475569;">
              {incidentList.length}{" "}
              incident{incidentList.length !== 1 ? "s" : ""} logged
            </span>
          </div>
        </div>

        {/* Right: sidebar dashboard */}
        <div class={sidebarStyle}>
          {/* Quick stats */}
          <div class={panelStyle}>
            <div class={panelTitleStyle}>Operations Summary</div>
            <div class={metricRowStyle}>
              <span style="color: #94a3b8;">Active Incidents</span>
              <span
                style={`font-weight: 700; color: ${
                  activeIncidents.length > 3 ? "#ef4444" : "#e2e8f0"
                };`}
              >
                {activeIncidents.length}
              </span>
            </div>
            <div class={metricRowStyle}>
              <span style="color: #94a3b8;">Resolved</span>
              <span style="font-weight: 700; color: #22c55e;">
                {resolvedCount}
              </span>
            </div>
            <div class={metricRowStyle}>
              <span style="color: #94a3b8;">Total Logged</span>
              <span style="font-weight: 700;">{incidentList.length}</span>
            </div>
          </div>

          {/* Active incidents */}
          <div class={panelStyle}>
            <div class={panelTitleStyle}>Active Incidents</div>
            {activeIncidents.length === 0
              ? (
                <div style="font-size: 12px; color: #475569; text-align: center; padding: 8px;">
                  No active incidents
                </div>
              )
              : (
                activeIncidents.map((inc) => (
                  <div
                    key={inc.id}
                    class={incidentCardStyle(inc.severity || "minor")}
                  >
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                      <span style="font-size: 12px; font-weight: 700; color: #f1f5f9;">
                        {inc.id}
                      </span>
                      {inc.severity && (
                        <span
                          style={`font-size: 9px; padding: 2px 6px; border-radius: 3px; font-weight: 700; text-transform: uppercase; background: ${
                            severityColors[inc.severity]
                          }30; color: ${severityColors[inc.severity]};`}
                        >
                          {inc.severity}
                        </span>
                      )}
                    </div>
                    {inc.location && (
                      <div style="font-size: 11px; color: #94a3b8; margin-bottom: 2px;">
                        {inc.location}
                      </div>
                    )}
                    {inc.status && (
                      <div
                        style={`font-size: 10px; color: ${
                          statusColors[inc.status] || "#6b7280"
                        }; text-transform: uppercase; letter-spacing: 0.5px;`}
                      >
                        {inc.status.replace("_", " ")}
                      </div>
                    )}
                  </div>
                ))
              )}
          </div>

          {/* Legend */}
          <div class={panelStyle}>
            <div class={panelTitleStyle}>Severity Legend</div>
            {Object.entries(severityColors).map(([sev, color]) => (
              <div
                key={sev}
                style="display: flex; align-items: center; gap: 8px; padding: 2px 0;"
              >
                <span
                  style={`width: 10px; height: 10px; border-radius: 2px; background: ${color};`}
                />
                <span style="font-size: 11px; text-transform: capitalize; color: #94a3b8;">
                  {sev}
                </span>
              </div>
            ))}
          </div>

          {/* Scenario shortcuts */}
          <div class={panelStyle}>
            <div class={panelTitleStyle}>Training Scenarios</div>
            <div style="font-size: 11px; color: #64748b; line-height: 1.6;">
              Say "run mass casualty scenario" or "simulate active shooter" to
              test dispatch operations with complex multi-incident drills.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
