const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const AUDIT_PATH = path.join(DATA_DIR, "audit-log.json");

const medicationRisk = {
  apixaban: {
    severity: "high",
    score: 36,
    summary: "Apixaban is a blood thinner; repeated missed doses can raise stroke or clot risk.",
    evidence: [
      { label: "Medication class", value: "Anticoagulant" },
      { label: "Public API target", value: "RxNav/OpenFDA connector slot" }
    ]
  },
  metformin: {
    severity: "medium",
    score: 18,
    summary: "Metformin miss is usually not an immediate emergency, but repeated misses affect glucose control.",
    evidence: [
      { label: "Medication class", value: "Diabetes therapy" },
      { label: "Public API target", value: "RxNav/OpenFDA connector slot" }
    ]
  },
  "vitamin-d": {
    severity: "low",
    score: 4,
    summary: "Vitamin D miss is low acute risk.",
    evidence: [
      { label: "Medication class", value: "Supplement" },
      { label: "Public API target", value: "RxNav/OpenFDA connector slot" }
    ]
  }
};

const patientProfiles = {
  eleanor: {
    id: "eleanor",
    name: "Eleanor Shah",
    misses7d: 2,
    refill: "Due yesterday",
    refillDays: -1,
    caregiver: "Anika Shah"
  },
  marcus: {
    id: "marcus",
    name: "Marcus Lee",
    misses7d: 1,
    refill: "12 days remaining",
    refillDays: 12,
    caregiver: "Dev Lee"
  },
  rosa: {
    id: "rosa",
    name: "Rosa Alvarez",
    misses7d: 3,
    refill: "Ready for pickup",
    refillDays: 0,
    caregiver: "Nina Alvarez"
  }
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

ensureDataFiles();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "POST" && url.pathname === "/api/sessions") {
      const body = await readJson(request);
      const result = await orchestrateMissedDose(body);
      return sendJson(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/escalations") {
      const body = await readJson(request);
      const result = writeAuditRecord(body);
      return sendJson(response, 200, result);
    }

    if (request.method === "GET" && url.pathname === "/api/audit") {
      return sendJson(response, 200, { records: readAuditRecords() });
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    return sendJson(response, 500, {
      error: "server_error",
      message: error.message
    });
  }
});

server.listen(PORT, () => {
  console.log(`MedGuard demo listening at http://localhost:${PORT}`);
});

async function orchestrateMissedDose(input) {
  const patient = patientProfiles[input.patientId] || patientProfiles.eleanor;
  const medication = medicationRisk[input.medicationId] ? input.medicationId : "apixaban";
  const context = {
    sessionId: `mg-${Date.now().toString().slice(-6)}`,
    patient,
    medication,
    wellnessText: String(input.wellnessText || "")
  };

  const startedAt = new Date().toISOString();
  const investigators = await Promise.all([
    withLatency(() => scheduleInvestigator(context), 260),
    withLatency(() => clinicalRiskInvestigator(context), 420),
    withLatency(() => pharmacyInvestigator(context), 330),
    withLatency(() => wellnessInvestigator(context), 520)
  ]);
  const correlation = correlationAgent(investigators);

  return {
    session: {
      id: context.sessionId,
      started_at: startedAt,
      patient: patient.name,
      medication: labelMedication(medication),
      orchestrator: "complete",
      approval_required: true
    },
    investigators,
    correlation,
    gate: {
      status: "waiting_for_human",
      allowed_actions: ["call", "alert", "dismiss"]
    }
  };
}

function scheduleInvestigator({ patient, medication }) {
  const patterned = patient.misses7d >= 2;
  return agentResult({
    agent: "schedule-investigator",
    severity: patterned ? "high" : "low",
    confidence: patterned ? 0.93 : 0.76,
    score: patterned ? 26 : 8,
    summary: patterned
      ? `Pattern detected: ${patient.misses7d} missed ${labelMedication(medication)} doses in 7 days.`
      : "Likely one-off miss, no repeated pattern yet.",
    evidence: [
      { label: "Miss count", value: `${patient.misses7d} misses / 7 days` },
      { label: "Pattern rule", value: "2+ misses in 7 days" }
    ],
    recommended_action: patterned ? "Escalate to approval gate." : "Monitor."
  });
}

function clinicalRiskInvestigator({ medication }) {
  const risk = medicationRisk[medication];
  return agentResult({
    agent: "clinical-risk-investigator",
    severity: risk.severity,
    confidence: 0.81,
    score: risk.score,
    summary: risk.summary,
    evidence: risk.evidence,
    recommended_action: risk.severity === "high" ? "Require human review." : "Add context to correlation."
  });
}

function pharmacyInvestigator({ patient }) {
  const blocked = patient.refillDays <= 0;
  return agentResult({
    agent: "pharmacy-investigator",
    severity: blocked ? "medium" : "low",
    confidence: 0.88,
    score: blocked ? 14 : 2,
    summary: blocked ? "Refill status may explain the missed dose." : "Refill supply does not appear blocked.",
    evidence: [
      { label: "Refill status", value: patient.refill },
      { label: "Data source", value: "Mock pharmacy JSON" }
    ],
    recommended_action: blocked ? "Include refill note in caregiver alert." : "No pharmacy action."
  });
}

function wellnessInvestigator({ wellnessText }) {
  const text = wellnessText.toLowerCase();
  const keywords = ["confused", "dizzy", "help", "scared", "lost", "unwell"];
  const hits = keywords.filter((keyword) => text.includes(keyword));
  const severe = hits.length > 0;
  return agentResult({
    agent: "wellness-investigator",
    severity: severe ? "high" : "low",
    confidence: severe ? 0.84 : 0.71,
    score: severe ? 28 : 4,
    summary: severe
      ? `Distress/confusion signal detected: ${hits.join(", ")}.`
      : "No confusion or distress terms detected in check-in.",
    evidence: [
      { label: "Input type", value: "Text stand-in for voice transcript" },
      { label: "Matched signals", value: hits.length ? hits.join(", ") : "none" }
    ],
    recommended_action: severe ? "Escalate for human call decision." : "No wellness escalation."
  });
}

function correlationAgent(results) {
  const risk_score = Math.min(100, results.reduce((sum, result) => sum + result.score, 0));
  const highCount = results.filter((result) => result.severity === "high").length;
  let title = "Low immediate risk";
  let narrative = "The evidence does not suggest urgent escalation, but dismissal still requires a human decision.";

  if (risk_score >= 70 || highCount >= 2) {
    title = "High-risk missed dose";
    narrative = "Multiple signals agree: this is not just a reminder failure. Human approval is required before any real escalation action.";
  } else if (risk_score >= 35) {
    title = "Review recommended";
    narrative = "The agents found enough evidence to ask a human to choose the next step.";
  }

  return {
    agent: "correlation-agent",
    status: "complete",
    risk_score,
    severity: risk_score >= 70 ? "high" : risk_score >= 35 ? "medium" : "low",
    title,
    narrative,
    evidence_count: results.reduce((sum, result) => sum + result.evidence.length, 0)
  };
}

function writeAuditRecord(input) {
  const records = readAuditRecords();
  const record = {
    id: `audit-${Date.now()}`,
    created_at: new Date().toISOString(),
    session_id: String(input.sessionId || "unknown"),
    action: String(input.action || "unknown"),
    actor: "human-approver",
    agent: "escalation-agent",
    result: escalationResult(input.action)
  };
  records.unshift(record);
  fs.writeFileSync(AUDIT_PATH, `${JSON.stringify(records, null, 2)}\n`);
  return { record, records };
}

function escalationResult(action) {
  if (action === "call") return "Queued caregiver call.";
  if (action === "alert") return "Queued caregiver alert.";
  if (action === "dismiss") return "Dismissed with audit trail.";
  return "Recorded unknown action.";
}

function agentResult(result) {
  return {
    status: "complete",
    ...result,
    completed_at: new Date().toISOString()
  };
}

function withLatency(callback, ms) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(callback()), ms);
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(new Error("Invalid JSON request body."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function serveStatic(urlPath, response) {
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const safePath = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  response.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}

function readAuditRecords() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(AUDIT_PATH, "utf8"));
}

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (!fs.existsSync(AUDIT_PATH)) fs.writeFileSync(AUDIT_PATH, "[]\n");
}

function labelMedication(value) {
  return {
    apixaban: "apixaban",
    metformin: "metformin",
    "vitamin-d": "vitamin D"
  }[value] || value;
}
