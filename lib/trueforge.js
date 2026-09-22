const TRUEFORGE_URL = process.env.TRUEFORGE_URL || "http://localhost:8790";

async function tfFetch(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${TRUEFORGE_URL}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const message = json?.error?.message || json?.message || `TrueForge HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = json;
    throw error;
  }
  return json;
}

async function runAgentTurn(agentName, prompt, { timeoutMs = 120000 } = {}) {
  const session = await tfFetch("/api/v1/sessions", {
    method: "POST",
    body: { agent: { name: agentName } }
  });
  const sessionId = session.data.id;
  const turn = await tfFetch(`/api/v1/sessions/${sessionId}/turns`, {
    method: "POST",
    body: {
      stream: false,
      input: [{ type: "user.message", content: prompt }]
    }
  });
  const turnId = turn.data.id;
  const deadline = Date.now() + timeoutMs;
  let latest = turn;

  while (Date.now() < deadline) {
    latest = await tfFetch(`/api/v1/sessions/${sessionId}/turns/${turnId}`);
    const status = latest.data?.state?.status;
    if (status === "done" || status === "error" || status === "cancelled") break;
    await sleep(2500);
  }

  const status = latest.data?.state?.status;
  const content = latest.data?.state?.output?.content || "";
  let parsed = null;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    const match = String(content).match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }

  return {
    agent_name: agentName,
    trueforge_session_id: sessionId,
    trueforge_turn_id: turnId,
    status,
    raw: content,
    json: parsed
  };
}

async function ensureSchedule(schedule) {
  const existing = await tfFetch("/api/v1/schedules");
  const match = (existing.data || []).find((item) => item.name === schedule.name);
  if (match) {
    await tfFetch(`/api/v1/schedules/${match.id}`, {
      method: "PUT",
      body: {
        name: schedule.name,
        manifest: schedule.manifest
      }
    });
    return { ...(await tfFetch(`/api/v1/schedules/${match.id}`)).data, created: false };
  }

  const created = await tfFetch("/api/v1/schedules", {
    method: "POST",
    body: schedule
  });
  return { ...created.data, created: true };
}

async function triggerSchedule(scheduleId) {
  return tfFetch(`/api/v1/schedules/runs`, {
    method: "POST",
    body: { schedule_id: scheduleId }
  });
}

async function listSchedules() {
  const result = await tfFetch("/api/v1/schedules");
  return result.data || [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  TRUEFORGE_URL,
  runAgentTurn,
  ensureSchedule,
  triggerSchedule,
  listSchedules,
  tfFetch
};
