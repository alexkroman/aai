import { useSession } from "@jsr/aai__ui";
import type { Message } from "@jsr/aai__ui";
import { useEffect, useRef } from "preact/hooks";

const CSS = `
@keyframes dc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes dc-slide-in {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.dc-messages::-webkit-scrollbar { width: 6px; }
.dc-messages::-webkit-scrollbar-track { background: transparent; }
.dc-messages::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
.dc-sidebar::-webkit-scrollbar { width: 6px; }
.dc-sidebar::-webkit-scrollbar-track { background: transparent; }
.dc-sidebar::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
@media (max-width: 900px) {
  .dc-main { grid-template-columns: 1fr !important; grid-template-rows: auto 1fr !important; }
}
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
  "en_route": "#3b82f6",
  "on_scene": "#22c55e",
  resolved: "#6b7280",
  escalated: "#ef4444",
};

interface Incident {
  id: string;
  mentioned: number;
  severity?: string;
  status?: string;
  location?: string;
}

function extractIncidents(
  messages: { role: string; text: string }[],
): Map<string, Incident> {
  const incidents = new Map<string, Incident>();
  for (const msg of messages) {
    const incMatches = msg.text.matchAll(/INC-\d{4}/g);
    for (const m of incMatches) {
      const id = m[0];
      if (!incidents.has(id)) {
        incidents.set(id, { id, mentioned: 0 });
      }
      incidents.get(id)!.mentioned++;
    }

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
      const locMatch = line.match(/(?:at|to|location:?)\s+([^,.\n]{5,50})/i);
      if (locMatch) inc.location = locMatch[1]!.trim();

      incidents.set(id, inc);
    }
  }
  return incidents;
}

function extractAlertLevel(
  messages: { role: string; text: string }[],
): string {
  let level = "green";
  for (const msg of messages) {
    const match = msg.text.match(/alert level[:\s]+(\w+)/i);
    if (match) level = match[1]!.toLowerCase();
    if (
      msg.text.includes("alert level is red") ||
      msg.text.includes("ALERT: RED")
    ) level = "red";
    if (msg.text.includes("alert level is orange")) level = "orange";
    if (msg.text.includes("alert level is yellow")) level = "yellow";
  }
  return level;
}

function stateColor(state: string): string {
  return state === "listening"
    ? "#22c55e"
    : state === "thinking"
    ? "#eab308"
    : state === "speaking"
    ? "#3b82f6"
    : state === "ready"
    ? "#22c55e"
    : state === "error"
    ? "#ef4444"
    : "#6b7280";
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
  const resolvedCount = incidentList.filter((i) => i.status === "resolved")
    .length;

  const alertBg = alertColors[alertLevel] || "#6b7280";
  const alertTextColor = alertLevel === "yellow" ? "#000" : "#fff";

  return (
    <>
      <style>{CSS}</style>
      <div className="font-mono bg-[#0a0a0f] text-slate-200 min-h-screen p-0 m-0 flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] border-b border-slate-800 px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="text-lg font-bold text-slate-100 tracking-wide uppercase flex items-center gap-2.5">
            <span className="text-blue-500">&#9670;</span>
            Dispatch Command Center
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{
                background: stateColor(state),
                animation: state === "listening"
                  ? "dc-pulse 1.5s ease-in-out infinite"
                  : state === "thinking"
                  ? "dc-pulse 0.8s ease-in-out infinite"
                  : "none",
              }}
              title={state}
            />
            <span className="text-[11px] text-slate-500 font-normal normal-case">
              {state === "listening"
                ? "LISTENING"
                : state === "thinking"
                ? "PROCESSING"
                : state === "speaking"
                ? "TRANSMITTING"
                : state.toUpperCase()}
            </span>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-[10px] text-slate-500 tracking-wide">
              SYSTEM ALERT:
            </span>
            <span
              className="px-3 py-1 rounded text-[11px] font-bold uppercase tracking-wide"
              style={{
                background: alertBg,
                color: alertTextColor,
                animation: alertLevel === "red"
                  ? "dc-pulse 1s ease-in-out infinite"
                  : "none",
              }}
            >
              {alertLevel.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Main content */}
        <div className="dc-main grid grid-cols-[1fr_320px] grid-rows-[1fr] flex-1 overflow-hidden">
          {/* Left: conversation feed */}
          <div className="flex flex-col overflow-hidden border-r border-slate-800">
            <div className="dc-messages flex-1 overflow-y-auto p-4 flex flex-col gap-2">
              {msgs.length === 0 && (
                <div className="text-center text-slate-600 py-10 px-5 text-[13px]">
                  Dispatch Command Center standing by. Click START to begin
                  operations.
                </div>
              )}
              {msgs.map((m: Message, i: number) => (
                <div
                  key={i}
                  className={`px-3.5 py-2.5 rounded-lg text-[13px] leading-relaxed max-w-[85%] ${
                    m.role === "assistant"
                      ? "self-start bg-slate-800"
                      : "self-end bg-[#172554]"
                  }`}
                  style={{
                    animation: "dc-slide-in 0.2s ease-out",
                    borderLeft: m.role === "assistant"
                      ? "3px solid #3b82f6"
                      : "none",
                    borderRight: m.role !== "assistant"
                      ? "3px solid #22d3ee"
                      : "none",
                  }}
                >
                  <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wide">
                    {m.role === "assistant" ? "DISPATCH" : "OPERATOR"}
                  </div>
                  {m.text}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {tx && (
              <div className="px-4 py-2 bg-gray-900 border-t border-slate-800 text-xs text-slate-500 italic min-h-[32px] flex items-center">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block mr-2 bg-green-500"
                  style={{
                    animation: "dc-pulse 1.5s ease-in-out infinite",
                  }}
                />
                {tx}
              </div>
            )}
            {error && (
              <div className="px-4 py-2 bg-red-950 text-red-300 text-xs border-t border-red-800">
                ERROR: {error.message} ({error.code})
              </div>
            )}

            <div className="px-4 py-3 bg-gray-900 border-t border-slate-800 flex items-center gap-2.5">
              {!session.started.value
                ? (
                  <button
                    type="button"
                    className="px-4 py-2 border-none rounded-md font-mono text-xs font-semibold cursor-pointer uppercase tracking-wide bg-blue-600 text-white hover:bg-blue-700 transition-all"
                    onClick={() => session.start()}
                  >
                    Start Dispatch
                  </button>
                )
                : (
                  <>
                    <button
                      type="button"
                      className={`px-4 py-2 border-none rounded-md font-mono text-xs font-semibold cursor-pointer uppercase tracking-wide transition-all ${
                        session.running.value
                          ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                          : "bg-blue-600 text-white hover:bg-blue-700"
                      }`}
                      onClick={() => session.toggle()}
                    >
                      {session.running.value ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2 border-none rounded-md font-mono text-xs font-semibold cursor-pointer uppercase tracking-wide bg-red-600 text-white hover:bg-red-700 transition-all"
                      onClick={() => session.reset()}
                    >
                      Reset
                    </button>
                  </>
                )}
              <div className="flex-1" />
              <span className="text-[10px] text-slate-600">
                {incidentList.length} incident
                {incidentList.length !== 1 ? "s" : ""} logged
              </span>
            </div>
          </div>

          {/* Right: sidebar dashboard */}
          <div className="dc-sidebar bg-gray-900 overflow-y-auto p-4 flex flex-col gap-4">
            {/* Quick stats */}
            <div className="bg-[#1a1a2e] border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-bold uppercase tracking-[1.5px] text-slate-500 mb-2.5">
                Operations Summary
              </div>
              <div className="flex justify-between items-center py-1 text-xs">
                <span className="text-slate-400">Active Incidents</span>
                <span
                  className={`font-bold ${
                    activeIncidents.length > 3
                      ? "text-red-500"
                      : "text-slate-200"
                  }`}
                >
                  {activeIncidents.length}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 text-xs">
                <span className="text-slate-400">Resolved</span>
                <span className="font-bold text-green-500">
                  {resolvedCount}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 text-xs">
                <span className="text-slate-400">Total Logged</span>
                <span className="font-bold">{incidentList.length}</span>
              </div>
            </div>

            {/* Active incidents */}
            <div className="bg-[#1a1a2e] border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-bold uppercase tracking-[1.5px] text-slate-500 mb-2.5">
                Active Incidents
              </div>
              {activeIncidents.length === 0
                ? (
                  <div className="text-xs text-slate-600 text-center py-2">
                    No active incidents
                  </div>
                )
                : activeIncidents.map((inc) => (
                  <div
                    key={inc.id}
                    className="bg-slate-900 rounded-md p-2.5 mb-2"
                    style={{
                      animation: "dc-slide-in 0.3s ease-out",
                      border: `1px solid ${
                        severityColors[inc.severity ?? ""] || "#334155"
                      }40`,
                      borderLeft: `3px solid ${
                        severityColors[inc.severity ?? ""] || "#334155"
                      }`,
                    }}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-bold text-slate-100">
                        {inc.id}
                      </span>
                      {inc.severity && (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase"
                          style={{
                            background: `${
                              severityColors[inc.severity ?? ""]
                            }30`,
                            color: severityColors[inc.severity ?? ""],
                          }}
                        >
                          {inc.severity}
                        </span>
                      )}
                    </div>
                    {inc.location && (
                      <div className="text-[11px] text-slate-400 mb-0.5">
                        {inc.location}
                      </div>
                    )}
                    {inc.status && (
                      <div
                        className="text-[10px] uppercase tracking-wide"
                        style={{
                          color: statusColors[inc.status] || "#6b7280",
                        }}
                      >
                        {inc.status.replace("_", " ")}
                      </div>
                    )}
                  </div>
                ))}
            </div>

            {/* Legend */}
            <div className="bg-[#1a1a2e] border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-bold uppercase tracking-[1.5px] text-slate-500 mb-2.5">
                Severity Legend
              </div>
              {Object.entries(severityColors).map(([sev, color]) => (
                <div
                  key={sev}
                  className="flex items-center gap-2 py-0.5"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ background: color }}
                  />
                  <span className="text-[11px] capitalize text-slate-400">
                    {sev}
                  </span>
                </div>
              ))}
            </div>

            {/* Scenario shortcuts */}
            <div className="bg-[#1a1a2e] border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-bold uppercase tracking-[1.5px] text-slate-500 mb-2.5">
                Training Scenarios
              </div>
              <div className="text-[11px] text-slate-500 leading-relaxed">
                Say "run mass casualty scenario" or "simulate active shooter" to
                test dispatch operations with complex multi-incident drills.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
