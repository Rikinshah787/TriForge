const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createMemoryStore } = require("./lib/memory");
const trueforge = require("./lib/trueforge");
const twilioVoice = require("./lib/twilio-voice");
const { createDoseLogStore } = require("./lib/dose-log");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const AUDIT_PATH = path.join(DATA_DIR, "audit-log.json");
const MEMORY_PATH = path.join(DATA_DIR, "memory.json");
const DOSE_LOG_PATH = path.join(DATA_DIR, "dose-log.json");
const SKILLS_DIR = path.join(ROOT, "skills");
const RXNAV_BASE_URL = "https://rxnav.nlm.nih.gov/REST/Prescribe/drugs.json";
const OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json";
const USE_TRUEFORGE_AGENTS = String(process.env.USE_TRUEFORGE_AGENTS || "true").toLowerCase() !== "false";

loadEnv();

const memory = createMemoryStore(MEMORY_PATH);
const doseLog = createDoseLogStore(DOSE_LOG_PATH);

const medicationCatalog = {
  apixaban: {
    displayName: "Apixaban",
    queryName: "apixaban",
    criticality: "critical",
    reason: "Anticoagulant — missed doses raise stroke risk"
  },
  metformin: {
    displayName: "Metformin",
    queryName: "metformin",
    criticality: "important",
    reason: "Diabetes therapy — repeated misses raise glucose risk"
  },
  "vitamin-d": {
    displayName: "Vitamin D",
    queryName: "cholecalciferol",
    criticality: "low",
    reason: "Supplement — usually not urgent"
  },
  lisinopril: {
    displayName: "Lisinopril",
    queryName: "lisinopril",
    criticality: "important",
    reason: "Blood pressure — repeated misses matter"
  }
};

const patientProfiles = {
  eleanor: {
    id: "eleanor",
    name: "Eleanor Shah",
    age: 78,
    location: "Brooklyn, NY",
    caregiver: "Anika Shah",
    caregiverRelation: "Daughter",
    conditions: ["Atrial fibrillation", "Mild cognitive impairment", "Hypertension"],
    diagnostics: [
      {
        label: "INR / clotting note",
        value: "On apixaban; skip risk includes stroke and bleeding per label"
      },
      {
        label: "Last clinic visit",
        value: "2026-09-12 — adherence counseling documented"
      },
      {
        label: "Fall risk",
        value: "Moderate — dizzy spells reported twice this month"
      }
    ],
    schedule: [
      { time: "08:00", medicationId: "apixaban", medication: "Apixaban 5mg", status: "due", criticality: "critical" },
      { time: "20:00", medicationId: "apixaban", medication: "Apixaban 5mg", status: "upcoming", criticality: "critical" },
      { time: "09:00", medicationId: "lisinopril", medication: "Lisinopril 10mg", status: "taken", criticality: "important" }
    ],
    inventory: [
      {
        medicationId: "apixaban",
        name: "Apixaban 5mg",
        criticality: "critical",
        lastBought: "2026-08-28",
        pillsRemaining: 3,
        daysSupplyLeft: 1.5,
        pendingRefill: true,
        pendingQty: 60,
        pharmacyStatus: "Refill claim submitted — due yesterday",
        lastPickup: "2026-08-28"
      },
      {
        medicationId: "lisinopril",
        name: "Lisinopril 10mg",
        criticality: "important",
        lastBought: "2026-09-01",
        pillsRemaining: 18,
        daysSupplyLeft: 18,
        pendingRefill: false,
        pendingQty: 0,
        pharmacyStatus: "On hand",
        lastPickup: "2026-09-01"
      }
    ],
    misses7d: 2,
    refill: "Due yesterday",
    refillDays: -1
  },
  marcus: {
    id: "marcus",
    name: "Marcus Lee",
    age: 71,
    location: "Queens, NY",
    caregiver: "Dev Lee",
    caregiverRelation: "Son",
    conditions: ["Type 2 diabetes", "Hyperlipidemia"],
    diagnostics: [
      { label: "A1C", value: "7.4% — trending up" },
      { label: "Last clinic visit", value: "2026-08-28" }
    ],
    schedule: [
      { time: "07:30", medicationId: "metformin", medication: "Metformin 500mg", status: "due", criticality: "important" },
      { time: "19:30", medicationId: "metformin", medication: "Metformin 500mg", status: "upcoming", criticality: "important" }
    ],
    inventory: [
      {
        medicationId: "metformin",
        name: "Metformin 500mg",
        criticality: "important",
        lastBought: "2026-09-05",
        pillsRemaining: 24,
        daysSupplyLeft: 12,
        pendingRefill: false,
        pendingQty: 0,
        pharmacyStatus: "On hand",
        lastPickup: "2026-09-05"
      }
    ],
    misses7d: 1,
    refill: "12 days remaining",
    refillDays: 12
  },
  rosa: {
    id: "rosa",
    name: "Rosa Alvarez",
    age: 82,
    location: "Bronx, NY",
    caregiver: "Nina Alvarez",
    caregiverRelation: "Daughter",
    conditions: ["Atrial fibrillation", "Osteoporosis"],
    diagnostics: [
      { label: "Cardiology note", value: "High-risk anticoagulant therapy" },
      { label: "Last clinic visit", value: "2026-09-05" }
    ],
    schedule: [
      { time: "08:00", medicationId: "apixaban", medication: "Apixaban 5mg", status: "due", criticality: "critical" },
      { time: "21:00", medicationId: "vitamin-d", medication: "Vitamin D", status: "upcoming", criticality: "low" }
    ],
    inventory: [
      {
        medicationId: "apixaban",
        name: "Apixaban 5mg",
        criticality: "critical",
        lastBought: "2026-09-10",
        pillsRemaining: 0,
        daysSupplyLeft: 0,
        pendingRefill: true,
        pendingQty: 60,
        pharmacyStatus: "Ready for pickup",
        lastPickup: "2026-09-10"
      }
    ],
    misses7d: 3,
    refill: "Ready for pickup",
    refillDays: 0
  }
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

ensureDataFiles();
seedPatientMemory();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/mcp") {
      return handleMcpHttp(request, response);
    }

    if (request.method === "GET" && url.pathname === "/api/patient") {
      const patientId = url.searchParams.get("id") || "eleanor";
      const patient = patientProfiles[patientId] || patientProfiles.eleanor;
      doseLog.seedFromSchedule(patient);
      return sendJson(response, 200, { patient: publicPatient(patient) });
    }

    if (request.method === "GET" && url.pathname === "/api/dose-log") {
      const patientId = url.searchParams.get("patient_id") || "eleanor";
      const patient = patientProfiles[patientId] || patientProfiles.eleanor;
      doseLog.seedFromSchedule(patient);
      return sendJson(response, 200, {
        patient_id: patientId,
        today: doseLog.getDay(patientId),
        recent: doseLog.listRecent(patientId, 7)
      });
    }

    if (request.method === "POST" && url.pathname === "/api/dose-log") {
      const body = await readJson(request);
      const patientId = body.patientId || body.patient_id || "eleanor";
      const patient = patientProfiles[patientId] || patientProfiles.eleanor;
      doseLog.seedFromSchedule(patient);
      const dose = doseLog.recordDose({
        patientId,
        medicationId: body.medicationId || body.medication_id || "apixaban",
        time: body.time || null,
        status: body.status || "due",
        source: body.source || "dashboard",
        note: body.note || null,
        sessionId: body.sessionId || body.session_id || null
      });
      writeAuditRecord({
        sessionId: body.sessionId || "dose-log",
        action: "dose_record",
        channel: "dose_log",
        result: `Recorded ${dose.medication} @ ${dose.time} as ${dose.status} via ${dose.source}`
      });
      return sendJson(response, 200, { dose, today: doseLog.getDay(patientId) });
    }

    if (request.method === "GET" && url.pathname === "/api/memory") {
      const key = url.searchParams.get("key");
      if (key) return sendJson(response, 200, { entry: memory.get(key) });
      const prefix = url.searchParams.get("prefix") || "";
      return sendJson(response, 200, { entries: memory.list(prefix) });
    }

    if (request.method === "GET" && url.pathname === "/api/skills") {
      return sendJson(response, 200, { skills: listSkillPacks() });
    }

    if (request.method === "GET" && url.pathname === "/api/trueforge/live") {
      const live = await getTrueForgeLive();
      return sendJson(response, 200, live);
    }

    if (request.method === "GET" && url.pathname === "/api/schedules") {
      try {
        const schedules = await trueforge.listSchedules();
        return sendJson(response, 200, { schedules, trueforge: trueforge.TRUEFORGE_URL });
      } catch (error) {
        return sendJson(response, 200, { schedules: [], error: error.message, trueforge: trueforge.TRUEFORGE_URL });
      }
    }

    if (request.method === "POST" && url.pathname === "/api/schedules/ensure") {
      const result = await ensureMedforgeSchedule();
      return sendJson(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/schedules/run") {
      const body = await readJson(request);
      const result = await runScheduleNow(body.scheduleId || body.schedule_id);
      return sendJson(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/reminder-call") {
      const body = await readJson(request);
      const result = await startPatientReminderCall(body);
      return sendJson(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/no-response") {
      const body = await readJson(request);
      const result = markReminderNoResponse(body);
      return sendJson(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/elder-response") {
      const body = await readJson(request);
      const result = await handleElderResponse(body);
      return sendJson(response, 200, result);
    }

    if (request.method === "GET" && url.pathname === "/api/conversation") {
      const sessionId = url.searchParams.get("session_id") || "";
      return sendJson(response, 200, {
        conversation: memory.get(`session:${sessionId}:conversation`),
        reminder: memory.get(`session:${sessionId}:reminder`)
      });
    }

    if (request.method === "POST" && url.pathname === "/twilio/voice/reminder") {
      const form = await readForm(request);
      const sessionId = url.searchParams.get("session_id") || form.session_id || "unknown";
      const patientId = url.searchParams.get("patient_id") || "eleanor";
      const medicationId = url.searchParams.get("medication_id") || "apixaban";
      const xml = buildReminderGatherTwiml({ sessionId, patientId, medicationId });
      return sendXml(response, 200, xml);
    }

    if (request.method === "POST" && url.pathname === "/twilio/voice/gather") {
      const form = await readForm(request);
      const sessionId = url.searchParams.get("session_id") || form.session_id || "unknown";
      const patientId = url.searchParams.get("patient_id") || "eleanor";
      const medicationId = url.searchParams.get("medication_id") || "apixaban";
      const step = url.searchParams.get("step") || "symptoms";
      const speech = String(form.SpeechResult || form.speech_result || "").trim();
      const confidence = Number(form.Confidence || form.confidence || 0);
      const xml = await handleConversationalGather({
        sessionId,
        patientId,
        medicationId,
        speech,
        confidence,
        step
      });
      return sendXml(response, 200, xml);
    }

    if (request.method === "POST" && url.pathname === "/api/sessions") {
      const body = await readJson(request);
      const result = await orchestrateMissedDose(body);
      return sendJson(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/escalations") {
      const body = await readJson(request);
      const result = await executeEscalation(body);
      return sendJson(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/demo/usecase") {
      const body = await readJson(request);
      const result = await runDemoUseCase(body);
      return sendJson(response, 200, result);
    }

    if (request.method === "GET" && url.pathname === "/api/session-state") {
      const sessionId = url.searchParams.get("session_id") || "";
      return sendJson(response, 200, {
        session: memory.get(`session:${sessionId}`),
        conversation: memory.get(`session:${sessionId}:conversation`),
        reminder: memory.get(`session:${sessionId}:reminder`),
        investigators: memory.get(`session:${sessionId}:investigators`),
        correlation: memory.get(`session:${sessionId}:correlation`),
        trueforge: memory.get(`session:${sessionId}:trueforge`)
      });
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
  console.log(`MedForge demo listening at http://localhost:${PORT}`);
});

async function orchestrateMissedDose(input) {
  const patient = patientProfiles[input.patientId] || patientProfiles.eleanor;
  const medication = medicationCatalog[input.medicationId] ? input.medicationId : "apixaban";
  const sessionId = String(input.sessionId || `mg-${Date.now().toString().slice(-6)}`);
  const wellnessText = String(input.wellnessText || "");
  const context = {
    sessionId,
    patient,
    medication,
    wellnessText
  };

  memory.put(`session:${sessionId}`, {
    stage: "investigate",
    patient_id: patient.id,
    medication_id: medication,
    wellness_text: wellnessText,
    started_at: new Date().toISOString()
  });
  memory.put(`patient:${patient.id}`, publicPatient(patient));

  const startedAt = new Date().toISOString();
  let mode = "local";
  let investigators;
  let trueforgeRuns = [];
  let correlation;

  if (USE_TRUEFORGE_AGENTS) {
    try {
      const live = await runTrueForgeInvestigators(context);
      investigators = live.investigators;
      trueforgeRuns = live.runs;
      correlation = live.correlation;
      if (live.correlationRun) trueforgeRuns = [...trueforgeRuns, { key: "correlation", agent: "medforge-correlation-agent", result: live.correlationRun }];
      mode = "trueforge";
    } catch (error) {
      investigators = await Promise.all([
        withLatency(() => scheduleInvestigator(context), 260),
        withLatency(() => clinicalRiskInvestigator(context), 420),
        withLatency(() => pharmacyInvestigator(context), 330),
        withLatency(() => wellnessInvestigator(context), 520)
      ]);
      correlation = correlationAgent(investigators, { symptoms: wellnessText, intent: wellnessText ? "reported" : "unknown" });
      mode = `local_fallback:${error.message}`;
    }
  } else {
    investigators = await Promise.all([
      withLatency(() => scheduleInvestigator(context), 260),
      withLatency(() => clinicalRiskInvestigator(context), 420),
      withLatency(() => pharmacyInvestigator(context), 330),
      withLatency(() => wellnessInvestigator(context), 520)
    ]);
    correlation = correlationAgent(investigators, { symptoms: wellnessText, intent: wellnessText ? "reported" : "unknown" });
  }

  if (!correlation) {
    correlation = correlationAgent(investigators, { symptoms: wellnessText, intent: wellnessText ? "reported" : "unknown" });
  }
  memory.put(`session:${sessionId}:investigators`, investigators);
  memory.put(`session:${sessionId}:correlation`, correlation);
  memory.put(`session:${sessionId}:trueforge`, trueforgeRuns);

  return {
    session: {
      id: sessionId,
      started_at: startedAt,
      patient: patient.name,
      medication: labelMedication(medication),
      orchestrator: "complete",
      approval_required: true,
      mode
    },
    investigators,
    correlation,
    trueforge: trueforgeRuns,
    gate: {
      status: "waiting_for_human",
      allowed_actions: ["call", "alert", "dismiss"]
    }
  };
}

async function runTrueForgeInvestigators(context) {
  const { sessionId, patient, medication, wellnessText } = context;
  const today = doseLog.getDay(patient.id);
  const base = `session_id=${sessionId}; patient_id=${patient.id}; medication_id=${medication}; medication_name=${labelMedication(medication)}; elder_symptoms="${String(wellnessText || "").replace(/"/g, "'")}"; dose_log_today=${JSON.stringify(today)}.
IMPORTANT: score must be an integer from 0 to 25 only (not 0-100). Call get_skill, memory_get, your domain tool (and get_dose_log if useful), memory_put, return JSON only.`;

  // Schedule agent ALWAYS runs first (live), then the rest in parallel
  const scheduleJob = {
    key: "schedule",
    agent: "medforge-schedule-investigator",
    skill: "schedule-adherence",
    prompt: `${base} Skill=schedule-adherence. You run FIRST. Check miss pattern + today's dose log for this medication. score 0-10 if one-off, 15-25 if 2+ misses in 7 days.`
  };
  const scheduleRun = {
    ...scheduleJob,
    result: await trueforge.runAgentTurn(scheduleJob.agent, scheduleJob.prompt, { timeoutMs: 120000 })
  };

  const otherJobs = [
    {
      key: "clinical",
      agent: "medforge-clinical-risk-investigator",
      skill: "clinical-skip-risk",
      prompt: `${base} Skill=clinical-skip-risk. Use lookup_drug_risk for ${labelMedication(medication)}. Critical anticoagulant skip → score 18-25. Mild → under 12.`
    },
    {
      key: "pharmacy",
      agent: "medforge-pharmacy-investigator",
      skill: "pharmacy-refill",
      prompt: `${base} Skill=pharmacy-refill. Call get_refill_status. Low critical stock → 12-20. Adequate supply → 0-6. Never score above 25.`
    },
    {
      key: "wellness",
      agent: "medforge-wellness-investigator",
      skill: "wellness-distress",
      prompt: `${base} Skill=wellness-distress. Score ONLY from elder_symptoms transcript. No symptoms/no answer → 0-8. Dizzy/unwell/help → 16-25. Never invent symptoms.`
    }
  ];

  const otherRuns = await Promise.all(
    otherJobs.map(async (job) => {
      const result = await trueforge.runAgentTurn(job.agent, job.prompt, { timeoutMs: 120000 });
      return { ...job, result };
    })
  );

  const runs = [scheduleRun, ...otherRuns];
  const investigators = [];
  for (const run of runs) {
    let parsed = normalizeInvestigator(run.result.json, run.key);
    if (!parsed || run.result.status === "error") {
      console.warn(`[trueforge] ${run.agent} parse/status fallback`, run.result.status);
      const localFallback = {
        schedule: () => scheduleInvestigator(context),
        clinical: () => clinicalRiskInvestigator(context),
        pharmacy: () => pharmacyInvestigator(context),
        wellness: () => wellnessInvestigator(context)
      }[run.key];
      parsed = await localFallback();
      parsed.source = "local_fallback";
      parsed.summary = `[fallback] ${parsed.summary}`;
    } else {
      parsed.source = "trueforge";
      parsed.trueforge_session_id = run.result.trueforge_session_id;
      parsed.trueforge_turn_id = run.result.trueforge_turn_id;
    }
    memory.put(`session:${sessionId}:${run.key}`, parsed, {
      source: parsed.source,
      agent: run.agent,
      trueforge_session_id: run.result.trueforge_session_id || null
    });
    investigators.push(parsed);
  }

  // Live correlation agent
  let correlation = null;
  let correlationRun = null;
  try {
    correlationRun = await trueforge.runAgentTurn(
      "medforge-correlation-agent",
      [
        `You are medforge-correlation-agent. Combine these investigator JSON results into one risk score 0-100.`,
        `Each investigator score is already 0-25; SUM them for risk_score (max 100).`,
        `Symptoms: "${String(wellnessText || "").replace(/"/g, "'")}"`,
        `Investigators: ${JSON.stringify(investigators)}`,
        `Return JSON only: agent, status, risk_score, severity, title, narrative, evidence_count, live_agents.`
      ].join("\n"),
      { timeoutMs: 90000 }
    );
    if (correlationRun.json && Number.isFinite(Number(correlationRun.json.risk_score))) {
      correlation = {
        agent: "correlation-agent",
        status: "complete",
        risk_score: Math.max(0, Math.min(100, Math.round(Number(correlationRun.json.risk_score)))),
        severity: String(correlationRun.json.severity || "medium").toLowerCase(),
        title: String(correlationRun.json.title || "Correlation complete"),
        narrative: String(correlationRun.json.narrative || "Live correlation complete."),
        evidence_count: Number(correlationRun.json.evidence_count) || investigators.reduce((s, i) => s + (i.evidence?.length || 0), 0),
        live_agents: investigators.filter((i) => i.source === "trueforge").length,
        source: "trueforge",
        trueforge_session_id: correlationRun.trueforge_session_id
      };
    }
  } catch (error) {
    console.warn("[trueforge] correlation fallback", error.message);
  }
  if (!correlation) {
    correlation = correlationAgent(investigators, { symptoms: wellnessText, intent: wellnessText ? "reported" : "unknown" });
    correlation.source = "local_fallback";
  }

  return { investigators, runs, correlation, correlationRun };
}

function normalizeInvestigator(json, key) {
  if (!json || typeof json !== "object") return null;
  const agentName = {
    schedule: "schedule-investigator",
    clinical: "clinical-risk-investigator",
    pharmacy: "pharmacy-investigator",
    wellness: "wellness-investigator"
  }[key];

  const evidence = Array.isArray(json.evidence)
    ? json.evidence.map((item) => {
        if (item && typeof item === "object" && item.label) return item;
        return { label: "note", value: String(item) };
      })
    : [{ label: "raw", value: JSON.stringify(json.evidence || {}) }];

  // Agents sometimes return 0-100; normalize into 0-25 contribution buckets
  let score = Number(json.score);
  if (!Number.isFinite(score)) score = 10;
  if (score > 25) score = Math.round(score / 4);
  score = Math.max(0, Math.min(25, Math.round(score)));

  return agentResult({
    agent: agentName,
    severity: String(json.severity || "medium").toLowerCase(),
    confidence: Number(json.confidence) || 0.7,
    score,
    summary: String(json.summary || "Investigator complete."),
    evidence,
    recommended_action: String(json.recommended_action || "Review findings."),
    source: "trueforge"
  });
}

async function getTrueForgeLive() {
  const base = trueforge.TRUEFORGE_URL;
  try {
    const [agents, schedules, sessions] = await Promise.all([
      trueforge.tfFetch("/api/v1/agents"),
      trueforge.tfFetch("/api/v1/schedules"),
      trueforge.tfFetch("/api/v1/sessions?limit=12")
    ]);

    const agentList = (agents.data || []).filter((item) => String(item.name).startsWith("medforge-"));
    const scheduleList = schedules.data || [];
    const sessionList = (sessions.data || []).slice(0, 12).map((item) => ({
      id: item.id,
      title: item.title || "Untitled session",
      created_at: item.created_at,
      url: `${base}/sessions/${item.id}`
    }));

    return {
      ok: true,
      storage: "trueforge-sqlite",
      note: "TrueForge local mode persists agents, schedules, and sessions in its SQLite DB. MedForge reads them through the TrueForge HTTP API.",
      base_url: base,
      library_url: `${base}/library`,
      schedules_url: `${base}/schedules`,
      sessions_url: `${base}/sessions`,
      agents: agentList.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        url: `${base}/library/${item.id}`
      })),
      schedules: scheduleList.map((item) => ({
        id: item.id,
        name: item.name,
        agent_name: item.agent_name,
        cron: item.manifest?.cron,
        timezone: item.manifest?.timezone,
        status: item.manifest?.status,
        url: `${base}/schedules`
      })),
      sessions: sessionList
    };
  } catch (error) {
    return {
      ok: false,
      storage: "trueforge-sqlite",
      base_url: base,
      error: error.message,
      agents: [],
      schedules: [],
      sessions: []
    };
  }
}

async function ensureMedforgeSchedule() {
  const task = [
    "You are the MedForge Scheduling Agent on a TrueForge schedule.",
    "Patient: Eleanor Shah (patient_id=eleanor). Medication: apixaban.",
    "1) Call get_skill name=schedule-adherence",
    "2) Call memory_get key=patient:eleanor",
    "3) Call get_adherence_history for patient_id=eleanor medication_id=apixaban",
    "4) memory_put your investigator JSON under key=schedule:latest",
    "Return investigator JSON only."
  ].join(" ");

  const schedule = await trueforge.ensureSchedule({
    name: "eleanor-apixaban-morning-check",
    agent_name: "medforge-schedule-investigator",
    manifest: {
      cron: "0 8 * * *",
      timezone: "America/New_York",
      status: "active",
      task
    }
  });

  memory.put("trueforge:schedule:eleanor-apixaban-morning-check", schedule);
  return { schedule, memory_key: "trueforge:schedule:eleanor-apixaban-morning-check" };
}

async function runScheduleNow(scheduleId) {
  let id = scheduleId;
  if (!id) {
    const ensured = await ensureMedforgeSchedule();
    id = ensured.schedule.id;
  }
  const run = await trueforge.triggerSchedule(id);
  memory.put(`trueforge:schedule-run:${id}:${Date.now()}`, run);
  return { schedule_id: id, run };
}

function seedPatientMemory() {
  Object.values(patientProfiles).forEach((patient) => {
    memory.put(`patient:${patient.id}`, publicPatient(patient), { seeded: true });
  });
}

function listSkillPacks() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillPath = path.join(SKILLS_DIR, entry.name, "SKILL.md");
      const body = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, "utf8") : "";
      const nameMatch = body.match(/^name:\s*(.+)$/m);
      const descMatch = body.match(/^description:\s*(.+)$/m);
      return {
        id: entry.name,
        name: (nameMatch && nameMatch[1].trim()) || entry.name,
        description: (descMatch && descMatch[1].trim()) || "",
        path: skillPath
      };
    });
}

function readSkillPack(name) {
  const packs = listSkillPacks();
  const pack = packs.find((item) => item.id === name || item.name === name);
  if (!pack) return null;
  return {
    ...pack,
    content: fs.readFileSync(pack.path, "utf8")
  };
}

function scheduleInvestigator({ patient, medication }) {
  const history = getAdherenceHistory(patient.id, medication);
  const missCount = countRecentMisses(history, 7);
  const patterned = missCount >= 2;
  return agentResult({
    agent: "schedule-investigator",
    severity: patterned ? "high" : "low",
    confidence: patterned ? 0.93 : 0.76,
    score: patterned ? 26 : 8,
    summary: patterned
      ? `Pattern detected: ${missCount} missed ${labelMedication(medication)} doses in 7 days.`
      : "Likely one-off miss, no repeated pattern yet.",
    evidence: [
      { label: "Miss count", value: `${missCount} misses / 7 days` },
      { label: "Pattern rule", value: "2+ misses in 7 days" }
    ],
    recommended_action: patterned ? "Escalate to approval gate." : "Monitor."
  });
}

async function clinicalRiskInvestigator({ medication }) {
  const medicationInfo = medicationCatalog[medication];
  const queryName = medicationInfo.queryName;
  const rxNav = await lookupRxNav(queryName);
  const openFda = await lookupOpenFdaLabel(queryName);
  const risk = classifyMedicationRisk(queryName, rxNav, openFda);

  return agentResult({
    agent: "clinical-risk-investigator",
    severity: risk.severity,
    confidence: risk.confidence,
    score: risk.score,
    summary: risk.summary,
    evidence: [
      { label: "RxNav status", value: rxNav.status },
      { label: "RxNav concept", value: rxNav.conceptName || "none found" },
      { label: "openFDA status", value: openFda.status },
      { label: "Label risk signal", value: risk.signal },
      { label: "Data source", value: "Live RxNav + openFDA label APIs with deterministic fallback" }
    ],
    recommended_action: risk.severity === "high" ? "Require human review." : "Add context to correlation."
  });
}

function pharmacyInvestigator({ patient }) {
  const inventory = getMedicineInventory(patient.id);
  const criticalLow = inventory.filter(
    (item) => item.criticality === "critical" && (item.pillsRemaining <= 3 || item.pendingRefill)
  );
  const blocked = patient.refillDays <= 0 || criticalLow.length > 0;
  return agentResult({
    agent: "pharmacy-investigator",
    severity: blocked ? "medium" : "low",
    confidence: 0.9,
    score: blocked ? 16 : 2,
    summary: blocked
      ? `Supply risk: ${criticalLow.map((item) => `${item.name} (${item.pillsRemaining} left, pending ${item.pendingQty})`).join("; ") || patient.refill}`
      : "Refill supply looks adequate.",
    evidence: inventory.flatMap((item) => [
      { label: `${item.name} stock`, value: `${item.pillsRemaining} pills · ${item.daysSupplyLeft} days left` },
      { label: `${item.name} last bought`, value: item.lastBought },
      { label: `${item.name} pending refill`, value: item.pendingRefill ? `${item.pendingQty} pending · ${item.pharmacyStatus}` : "none" }
    ]),
    recommended_action: blocked ? "Include stock/refill note in caregiver alert." : "No pharmacy action."
  });
}

function wellnessInvestigator({ wellnessText }) {
  const analysis = analyzeWellnessText(wellnessText);
  const severe = analysis.signals.length > 0;
  return agentResult({
    agent: "wellness-investigator",
    severity: severe ? "high" : "low",
    confidence: severe ? 0.84 : 0.71,
    score: severe ? 28 : 4,
    summary: severe
      ? `Distress/confusion signal detected: ${analysis.signals.join(", ")}.`
      : "No confusion or distress terms detected in check-in.",
    evidence: [
      { label: "Input type", value: "Text stand-in for voice transcript" },
      { label: "Matched signals", value: analysis.signals.length ? analysis.signals.join(", ") : "none" }
    ],
    recommended_action: severe ? "Escalate for human call decision." : "No wellness escalation."
  });
}

function getAdherenceHistory(patientId, medicationId) {
  const patient = Object.values(patientProfiles).find((profile) => profile.id === patientId) || patientProfiles.eleanor;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return Array.from({ length: patient.misses7d }, (_, index) => ({
    patient_id: patientId,
    medication_id: medicationId,
    status: "missed",
    occurred_at: new Date(now - (index + 1) * day).toISOString()
  }));
}

function countRecentMisses(history, windowDays) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  return history.filter((event) => event.status === "missed" && new Date(event.occurred_at).getTime() >= cutoff).length;
}

function getRefillStatus(patientId) {
  const patient = Object.values(patientProfiles).find((profile) => profile.id === patientId) || patientProfiles.eleanor;
  const inventory = getMedicineInventory(patient.id);
  return {
    patient_id: patient.id,
    status: patient.refill,
    refillDays: patient.refillDays,
    source: "mock-pharmacy-json",
    inventory
  };
}

function getMedicineInventory(patientId) {
  const patient = Object.values(patientProfiles).find((profile) => profile.id === patientId) || patientProfiles.eleanor;
  return (patient.inventory || []).map((item) => ({ ...item }));
}

function getMissedMedicines(patientId) {
  const patient = Object.values(patientProfiles).find((profile) => profile.id === patientId) || patientProfiles.eleanor;
  return (patient.schedule || [])
    .filter((item) => item.status === "due" || item.status === "missed")
    .map((item) => ({
      ...item,
      criticality: item.criticality || medicationCatalog[item.medicationId]?.criticality || "important",
      reason: medicationCatalog[item.medicationId]?.reason || "Review clinically"
    }));
}

function analyzeWellnessText(wellnessText) {
  const text = wellnessText.toLowerCase();
  const keywords = ["confused", "dizzy", "help", "scared", "lost", "unwell", "not feeling well", "nauseous", "weak", "fall"];
  const signals = keywords.filter((keyword) => text.includes(keyword));
  return {
    transcript: wellnessText,
    signals,
    severity: signals.length ? "high" : "low"
  };
}

function correlationAgent(results, { symptoms = "", intent = "" } = {}) {
  // Each investigator contributes 0-25 → total risk 0-100
  const risk_score = Math.min(
    100,
    results.reduce((sum, result) => sum + Math.max(0, Math.min(25, Number(result.score || 0))), 0)
  );
  const highCount = results.filter((result) => result.severity === "high").length;
  const liveCount = results.filter((result) => result.source === "trueforge").length;
  let title = "Low concern";
  let narrative = `Symptom intake: "${symptoms || "none"}". Chart review complete. Risk ${risk_score}/100 (${liveCount}/4 live agents).`;

  if (risk_score >= 70 || (intent === "distress" && highCount >= 2)) {
    title = "High concern — calling caregiver";
    narrative = `Elder reported: "${symptoms || intent}". Live investigators found multiple signals (risk ${risk_score}/100). Calling caregiver.`;
  } else if (risk_score >= 40) {
    title = "Elevated — calling caregiver";
    narrative = `Symptoms "${symptoms || intent}" plus medication chart (risk ${risk_score}/100). Calling caregiver for check-in.`;
  } else if (risk_score >= 20) {
    title = "Mild concern";
    narrative = `Some signals after "${symptoms || "check-in"}" (risk ${risk_score}/100). Monitoring / light follow-up.`;
  }

  return {
    agent: "correlation-agent",
    status: "complete",
    risk_score,
    severity: risk_score >= 70 ? "high" : risk_score >= 40 ? "medium" : "low",
    title,
    narrative,
    evidence_count: results.reduce((sum, result) => sum + (result.evidence?.length || 0), 0),
    live_agents: liveCount,
    symptoms: symptoms || null,
    intent: intent || null
  };
}

function publicPatient(patient) {
  doseLog.seedFromSchedule(patient);
  const today = doseLog.getDay(patient.id);
  return {
    id: patient.id,
    name: patient.name,
    age: patient.age,
    location: patient.location,
    caregiver: patient.caregiver,
    caregiverRelation: patient.caregiverRelation,
    conditions: patient.conditions || [],
    diagnostics: patient.diagnostics || [],
    schedule: patient.schedule || [],
    dose_log: today,
    inventory: patient.inventory || [],
    refill: patient.refill,
    misses7d: patient.misses7d
  };
}

function applyDoseFromCall({ patientId, medicationId, intent, sessionId, symptoms }) {
  const patient = patientProfiles[patientId] || patientProfiles.eleanor;
  doseLog.seedFromSchedule(patient);
  const today = doseLog.getDay(patientId);
  const target =
    today.doses.find((d) => d.medication_id === medicationId && (d.status === "due" || d.status === "missed")) ||
    today.doses.find((d) => d.medication_id === medicationId);

  if (intent === "confirmed") {
    const dose = doseLog.recordDose({
      patientId,
      medicationId,
      time: target?.time || null,
      status: "taken",
      source: "call",
      sessionId,
      note: symptoms ? `Call confirmed OK. Symptoms: ${symptoms}` : "Confirmed on call"
    });
    return { action: "taken", dose, today: doseLog.getDay(patientId) };
  }

  if (intent === "no_input" || intent === "no_response") {
    const dose = doseLog.recordDose({
      patientId,
      medicationId,
      time: target?.time || null,
      status: "missed",
      source: "call",
      sessionId,
      note: "No answer on reminder call — marked missed in dose log"
    });
    return { action: "missed", dose, today: doseLog.getDay(patientId) };
  }

  // distress / unclear — do not trust memory; chart stays due→missed
  const dose = doseLog.recordDose({
    patientId,
    medicationId,
    time: target?.time || null,
    status: "missed",
    source: "call+chart",
    sessionId,
    note: symptoms
      ? `Symptoms on call: ${symptoms}. Chart marked not taken (elder not asked to recall).`
      : "Chart marked not taken after call"
  });
  return { action: "missed", dose, today: doseLog.getDay(patientId) };
}

async function startPatientReminderCall(input) {
  const patient = patientProfiles[input.patientId] || patientProfiles.eleanor;
  const medication = medicationCatalog[input.medicationId] ? input.medicationId : "apixaban";
  const sessionId = String(input.sessionId || `mg-${Date.now().toString().slice(-6)}`);
  const webhookBase = (process.env.TWILIO_WEBHOOK_BASE_URL || "").replace(/\/$/, "");
  const to = input.to || process.env.TWILIO_DEFAULT_TO_NUMBER;
  const from = process.env.TWILIO_FROM_NUMBER || "";

  doseLog.seedFromSchedule(patient);
  memory.put(`session:${sessionId}`, {
    stage: "reminder_call",
    patient_id: patient.id,
    medication_id: medication,
    conversational: true
  });
  memory.put(`patient:${patient.id}`, publicPatient(patient));
  memory.put(`session:${sessionId}:conversation`, {
    status: "calling",
    agent: "medforge-conversation-agent",
    harness: "trueforge",
    updated_at: new Date().toISOString()
  });

  // Simple conversational reminder first (no TrueForge before the call — avoids Twilio / auth timeouts)
  let call;
  if (webhookBase) {
    const url = `${webhookBase}/twilio/voice/reminder?session_id=${encodeURIComponent(sessionId)}&patient_id=${encodeURIComponent(patient.id)}&medication_id=${encodeURIComponent(medication)}`;
    call = await twilioVoice.createTwilioCall({ to, from, url });
  } else {
    const message = `Hello ${patient.name}. This is MedForge with your ${labelMedication(medication)} reminder. After the tone, tell me how you feel — okay, or dizzy, missed a dose, or need help.`;
    call = await placeCaregiverCall({
      approved_action: "call",
      session_id: sessionId,
      message,
      to
    });
  }

  const stage = {
    session_id: sessionId,
    stage: "reminder_call",
    patient: publicPatient(patient),
    medication: labelMedication(medication),
    conversational_agent: "medforge-conversation-agent",
    webhook_configured: Boolean(webhookBase),
    webhook_base: webhookBase || null,
    reminder: {
      status: call.status === "success" ? "called" : "failed",
      summary: call.summary,
      call_sid: call.artifacts?.call_sid || null,
      informed: false,
      responded: false,
      mode: webhookBase ? "converse_then_pipeline" : "prompt_only_set_TWILIO_WEBHOOK_BASE_URL"
    },
    twilio: call
  };

  memory.put(`session:${sessionId}:reminder`, stage.reminder);
  writeAuditRecord({
    sessionId,
    action: "reminder_call",
    channel: "twilio_voice",
    provider_sid: call.artifacts?.call_sid || null,
    result:
      call.status === "success"
        ? `Reminder call ${call.artifacts.call_sid} — conversational listen, then pipeline if needed.`
        : `Reminder call failed: ${call.summary}`
  });

  return stage;
}

function getWebhookBase() {
  return (process.env.TWILIO_WEBHOOK_BASE_URL || "").replace(/\/$/, "");
}

function buildReminderGatherTwiml({ sessionId, patientId, medicationId }) {
  const base = getWebhookBase();
  const action = `${base}/twilio/voice/gather?session_id=${encodeURIComponent(sessionId)}&patient_id=${encodeURIComponent(patientId)}&medication_id=${encodeURIComponent(medicationId)}&step=symptoms`;
  const med = labelMedication(medicationId);
  const patient = patientProfiles[patientId] || patientProfiles.eleanor;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" speechTimeout="auto" enhanced="true" action="${twilioVoice.escapeXml(action)}" method="POST" timeout="6">
    <Say voice="Polly.Joanna">Hello ${twilioVoice.escapeXml(patient.name)}. This is MedForge with your ${twilioVoice.escapeXml(med)} reminder. How are you feeling? Please tell me if you feel okay, or if you missed a dose, feel dizzy, or need help.</Say>
  </Gather>
  <Say voice="Polly.Joanna">I did not hear a response. I will check your chart and may contact your caregiver.</Say>
  <Redirect method="POST">${twilioVoice.escapeXml(action)}&amp;empty=1</Redirect>
</Response>`;
}

function classifySpeechFast(transcript) {
  const text = String(transcript || "")
    .trim()
    .toLowerCase();
  if (!text || text === "(no speech detected)") {
    return {
      intent: "no_input",
      spoken_reply_to_elder: "Okay. I did not catch that. We will check your chart and get back to you shortly.",
      escalate_caregiver: true
    };
  }
  if (/\b(dizzy|dizziness|unwell|not feeling|nauseous|help|scared|confused|missed|didn't take|did not take|forgot)\b/.test(text)) {
    return {
      intent: "distress",
      spoken_reply_to_elder: "Okay. Thank you for telling me. We will check your medication chart and get back to you shortly.",
      escalate_caregiver: true
    };
  }
  if (/\b(yes|yeah|yep|fine|okay|ok|good|alright|all good|feeling fine|i'?m fine|took it)\b/.test(text)) {
    return {
      intent: "confirmed",
      spoken_reply_to_elder: "Okay. Glad you are feeling fine. Take care.",
      escalate_caregiver: false
    };
  }
  return {
    intent: "unclear",
    spoken_reply_to_elder: "Okay. We will check your medication chart and get back to you shortly.",
    escalate_caregiver: true
  };
}

async function handleConversationalGather({ sessionId, patientId, medicationId, speech, confidence }) {
  const patient = patientProfiles[patientId] || patientProfiles.eleanor;
  const transcript = speech || "";
  doseLog.seedFromSchedule(patient);

  // Fast path for Twilio webhook timeout — do NOT wait on TrueForge here
  const fast = classifySpeechFast(transcript);
  const doseUpdate = applyDoseFromCall({
    patientId,
    medicationId,
    intent: fast.intent,
    sessionId,
    symptoms: transcript
  });

  memory.put(`session:${sessionId}:dose-log`, doseUpdate.today);
  memory.put(`patient:${patientId}`, publicPatient(patient));
  memory.put(`session:${sessionId}:conversation`, {
    status: fast.intent === "confirmed" ? "complete" : "pipeline_running",
    agent: "medforge-conversation-agent",
    harness: "trueforge",
    step: "symptoms",
    transcript,
    confidence,
    decision: fast,
    dose_record: doseUpdate.dose,
    updated_at: new Date().toISOString()
  });
  memory.put(`session:${sessionId}:reminder`, {
    informed: true,
    responded: Boolean(transcript),
    status: fast.intent,
    utterance: transcript,
    dose: doseUpdate.dose,
    at: new Date().toISOString()
  });

  writeAuditRecord({
    sessionId,
    action: "conversation_ack",
    channel: "twilio_voice",
    result: `Heard "${transcript || "(silence)"}" → ${fast.intent}. Dose ${doseUpdate.dose.status}. Ack then pipeline.`
  });

  // Full pipeline AFTER the call replies (conversation agent enrich + investigators + caregiver if high)
  if (fast.intent !== "confirmed") {
    setImmediate(() => {
      runPostCallPipeline({
        sessionId,
        patientId,
        medicationId,
        transcript: transcript || "No speech on reminder call",
        fastIntent: fast.intent
      }).catch((error) => console.warn("[pipeline]", error.message));
    });
  } else {
    // Still log a live conversation turn in background for TrueForge proof
    setImmediate(() => {
      runConversationAgent({
        sessionId,
        patientId,
        medicationId,
        transcript: transcript || "feeling fine",
        confidence,
        phase: "symptoms"
      })
        .then((decision) => {
          memory.put(`session:${sessionId}:conversation`, {
            ...(memory.get(`session:${sessionId}:conversation`)?.value || {}),
            decision: { ...fast, ...decision, intent: "confirmed" },
            trueforge_enriched: true,
            updated_at: new Date().toISOString()
          });
        })
        .catch(() => {});
    });
  }

  return twilioVoice.sayTwiml([
    fast.spoken_reply_to_elder,
    fast.intent === "confirmed"
      ? "Goodbye."
      : "Please stay nearby. If needed we will contact your caregiver in a few moments."
  ]);
}

async function runPostCallPipeline({ sessionId, patientId, medicationId, transcript, fastIntent }) {
  memory.put(`session:${sessionId}:conversation`, {
    ...(memory.get(`session:${sessionId}:conversation`)?.value || {}),
    status: "pipeline_running",
    updated_at: new Date().toISOString()
  });

  // Enrich with live conversation agent (non-blocking for the elder — already acknowledged)
  try {
    const decision = await runConversationAgent({
      sessionId,
      patientId,
      medicationId,
      transcript,
      confidence: 0.9,
      phase: "symptoms"
    });
    memory.put(`session:${sessionId}:conversation`, {
      ...(memory.get(`session:${sessionId}:conversation`)?.value || {}),
      decision: { ...decision, intent: decision.intent || fastIntent },
      trueforge_enriched: true,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.warn("[conversation enrich]", error.message);
  }

  const intent = fastIntent === "no_input" ? "no_response" : "distress";
  const result = await handleElderResponse({
    patientId,
    sessionId,
    intent,
    utterance: transcript
  });

  memory.put(`session:${sessionId}:conversation`, {
    ...(memory.get(`session:${sessionId}:conversation`)?.value || {}),
    status: "complete",
    pipeline: {
      path: result.path,
      risk_score: result.correlation?.risk_score,
      called: Boolean(result.auto_called_caregiver),
      mode: result.mode
    },
    updated_at: new Date().toISOString()
  });

  return result;
}

async function runConversationAgent({ sessionId, patientId, medicationId, transcript, confidence, phase = "symptoms" }) {
  memory.put(`patient:${patientId}`, publicPatient(patientProfiles[patientId] || patientProfiles.eleanor));
  const today = doseLog.getDay(patientId);
  const dose = today.doses.find((d) => d.medication_id === medicationId) || null;
  const prompt = [
    `You are medforge-conversation-agent on a live medication reminder call.`,
    `phase=${phase}; session_id=${sessionId}; patient_id=${patientId}; medication_id=${medicationId}; speech_confidence=${confidence}.`,
    `CHART dose record (source of truth — do NOT ask elder if they remember taking the pill): ${JSON.stringify(dose)}.`,
    `Elder speech (symptoms only): """${transcript}"""`,
    `Call get_skill name=elder-conversation, memory_get key=patient:${patientId}, get_dose_log, then memory_put JSON to session:${sessionId}:conversation-decision.`,
    `Classify symptoms: confirmed (feeling fine), distress (dizzy/unwell/help), unclear, no_input.`,
    `Never ask them to recall whether they took medication — the dose log already tracks that.`,
    `Return JSON only with intent, spoken_reply_to_elder, escalate_caregiver, caregiver_message, reason, confidence.`
  ].join("\n");

  const turn = await trueforge.runAgentTurn("medforge-conversation-agent", prompt, { timeoutMs: 90000 });
  const parsed = turn.json || {};
  const intent = String(parsed.intent || "unclear").toLowerCase();

  return {
    intent,
    spoken_reply_to_elder:
      parsed.spoken_reply_to_elder ||
      (intent === "confirmed" ? "Thank you. Glad you are feeling okay." : "Thank you for telling me how you feel."),
    escalate_caregiver: intent === "distress" || intent === "no_input",
    caregiver_message: parsed.caregiver_message || "",
    reason: parsed.reason || "",
    confidence: Number(parsed.confidence) || confidence || 0,
    trueforge: {
      session_id: turn.trueforge_session_id,
      turn_id: turn.trueforge_turn_id,
      status: turn.status,
      live: turn.status === "done"
    }
  };
}

function markReminderNoResponse(input) {
  const sessionId = String(input.sessionId || "unknown");
  const patient = patientProfiles[input.patientId] || patientProfiles.eleanor;
  const reminder = {
    informed: true,
    responded: false,
    status: "no_response",
    at: new Date().toISOString()
  };
  memory.put(`session:${sessionId}:reminder`, reminder);
  memory.put(`session:${sessionId}`, {
    ...(memory.get(`session:${sessionId}`)?.value || {}),
    stage: "no_response",
    reminder
  });
  const audit = writeAuditRecord({
    sessionId,
    action: "no_response",
    channel: "pipeline",
    result: `No response from ${patient.name} after reminder call. Opening investigation.`
  });

  return {
    session_id: sessionId,
    stage: "no_response",
    informed: true,
    responded: false,
    next_stage: "investigate",
    message: "Reminder delivered with no patient feedback. Investigators will now review schedule, clinical risk, pharmacy, and wellness.",
    audit: audit.record
  };
}

async function handleElderResponse(input) {
  const patient = patientProfiles[input.patientId] || patientProfiles.eleanor;
  const sessionId = String(input.sessionId || `mg-${Date.now().toString().slice(-6)}`);
  const utterance = String(input.utterance || input.text || "").trim();
  const intent = String(input.intent || "").toLowerCase();
  const analysis = analyzeWellnessText(utterance || (intent === "distress" ? "I am not feeling well and dizzy" : ""));
  const missed = getMissedMedicines(patient.id);
  const inventory = getMedicineInventory(patient.id);
  const criticalMissed = missed.filter((item) => item.criticality === "critical");

  // Path A: elder confirms OK
  if (intent === "ok" || /took it|i'm fine|im fine|all good/i.test(utterance)) {
    const reminder = { informed: true, responded: true, status: "confirmed", utterance, at: new Date().toISOString() };
    memory.put(`session:${sessionId}:reminder`, reminder);
    writeAuditRecord({
      sessionId,
      action: "elder_confirmed",
      channel: "conversation",
      result: `${patient.name} confirmed medication / feeling OK. No escalation.`
    });
    return {
      session_id: sessionId,
      path: "confirmed",
      stage: "complete",
      next_stage: null,
      message: "Elder confirmed. Pipeline can stop.",
      missed,
      inventory,
      analysis
    };
  }

  // Path B: no response
  if (intent === "no_response" || intent === "no-response") {
    return markReminderNoResponse({ patientId: patient.id, sessionId });
  }

  // Path C: distress → live TrueForge investigators → hold at human gate
  const distressText = utterance || "I am not feeling well and dizzy";
  const reminder = {
    informed: true,
    responded: true,
    status: "distress",
    utterance: distressText,
    signals: analysis.signals,
    at: new Date().toISOString()
  };
  memory.put(`session:${sessionId}:reminder`, reminder);
  memory.put(`session:${sessionId}:missed`, missed);
  memory.put(`session:${sessionId}:inventory`, inventory);
  memory.put(`patient:${patient.id}`, publicPatient(patient));

  let investigators;
  let trueforgeRuns = [];
  let mode = "local";
  let correlation;
  const context = {
    sessionId,
    patient,
    medication: "apixaban",
    wellnessText: distressText
  };

  if (USE_TRUEFORGE_AGENTS) {
    try {
      const live = await runTrueForgeInvestigators(context);
      investigators = live.investigators;
      trueforgeRuns = live.runs;
      correlation = live.correlation;
      if (live.correlationRun) {
        trueforgeRuns = [...trueforgeRuns, { key: "correlation", agent: "medforge-correlation-agent", result: live.correlationRun }];
      }
      mode = "trueforge";
    } catch (error) {
      investigators = await Promise.all([
        Promise.resolve(scheduleInvestigator(context)),
        clinicalRiskInvestigator(context),
        Promise.resolve(pharmacyInvestigator(context)),
        Promise.resolve(wellnessInvestigator(context))
      ]);
      correlation = correlationAgent(investigators, { symptoms: distressText, intent: "distress" });
      mode = `local_fallback:${error.message}`;
    }
  } else {
    investigators = await Promise.all([
      Promise.resolve(scheduleInvestigator(context)),
      clinicalRiskInvestigator(context),
      Promise.resolve(pharmacyInvestigator(context)),
      Promise.resolve(wellnessInvestigator(context))
    ]);
    correlation = correlationAgent(investigators, { symptoms: distressText, intent: "distress" });
  }

  if (!correlation) {
    correlation = correlationAgent(investigators, { symptoms: distressText, intent: "distress" });
  }

  const shouldCall = correlation.risk_score >= 40 || criticalMissed.length > 0;
  let call = null;
  if (shouldCall) {
    call = await placeCaregiverCall({
      approved_action: "call",
      session_id: sessionId,
      to: process.env.TWILIO_DEFAULT_TO_NUMBER,
      message: `MedForge alert for ${patient.caregiver}. ${patient.name} reported: ${distressText}. Missed/due: ${
        missed.map((item) => item.medication).join(", ") || "n/a"
      }. Risk ${correlation.risk_score}. Please check on them now.`
    });
    correlation.title = correlation.risk_score >= 70 ? "High concern — caregiver called" : "Caregiver called";
    correlation.narrative = `${correlation.narrative} Call: ${call.status}.`;
  } else {
    correlation.title = "Symptoms noted — no call yet";
    correlation.narrative = `${correlation.narrative} Risk below call threshold.`;
  }

  memory.put(`session:${sessionId}:investigators`, investigators);
  memory.put(`session:${sessionId}:correlation`, correlation);
  memory.put(`session:${sessionId}:trueforge`, trueforgeRuns);
  memory.put(`session:${sessionId}`, {
    ...(memory.get(`session:${sessionId}`)?.value || {}),
    stage: shouldCall ? "escalate" : "investigate",
    patient_id: patient.id,
    mode,
    twilio: call
  });

  writeAuditRecord({
    sessionId,
    action: shouldCall ? "auto_escalate_call" : "symptoms_reviewed",
    channel: shouldCall ? "twilio_voice" : "pipeline",
    provider_sid: call?.artifacts?.call_sid || null,
    actor: "medforge-auto",
    result: shouldCall
      ? `Symptoms→meds path via ${mode}. Risk ${correlation.risk_score}. Call ${call.status}.`
      : `Symptoms reviewed via ${mode}. Risk ${correlation.risk_score}. No call.`
  });

  return {
    session_id: sessionId,
    path: shouldCall ? "distress_escalate" : "distress_observe",
    stage: shouldCall ? "escalate" : "investigate",
    mode,
    auto_called_caregiver: call?.status === "success",
    caregiver: patient.caregiver,
    utterance: distressText,
    analysis,
    missed,
    critical_missed: criticalMissed,
    inventory,
    investigators,
    correlation,
    trueforge: trueforgeRuns,
    twilio: call,
    message: correlation.narrative
  };
}

async function runDemoUseCase(input) {
  const useCase = String(input.useCase || input.usecase || "").toLowerCase();
  const patientId = input.patientId || "eleanor";
  const medicationId = input.medicationId || "apixaban";
  const sessionId = String(input.sessionId || `mg-${Date.now().toString().slice(-6)}`);
  const patient = patientProfiles[patientId] || patientProfiles.eleanor;

  doseLog.seedFromSchedule(patient);
  // Reset today's target med to due so chart is the source of truth for this demo take
  if (useCase !== "confirmed" && useCase !== "ok") {
    doseLog.recordDose({
      patientId: patient.id,
      medicationId,
      status: "due",
      source: "chart",
      note: "Reset to due for demo run",
      sessionId
    });
  }

  memory.put(`patient:${patient.id}`, publicPatient(patient));
  memory.put(`session:${sessionId}`, {
    stage: "demo",
    use_case: useCase,
    patient_id: patient.id,
    medication_id: medicationId
  });

  if (useCase === "confirmed" || useCase === "ok") {
    const decision = await runConversationAgent({
      sessionId,
      patientId: patient.id,
      medicationId,
      transcript: "I feel fine, no dizziness",
      confidence: 0.95,
      phase: "symptoms"
    });
    const doseUpdate = applyDoseFromCall({
      patientId: patient.id,
      medicationId,
      intent: "confirmed",
      sessionId,
      symptoms: "I feel fine, no dizziness"
    });
    memory.put(`session:${sessionId}:conversation`, {
      status: "complete",
      agent: "medforge-conversation-agent",
      harness: "trueforge",
      transcript: "I feel fine, no dizziness",
      confidence: 0.95,
      decision,
      dose_record: doseUpdate.dose,
      updated_at: new Date().toISOString()
    });
    memory.put(`session:${sessionId}:dose-log`, doseUpdate.today);
    writeAuditRecord({
      sessionId,
      action: "demo_confirmed",
      channel: "trueforge_conversation_agent",
      result: `Use case A: symptoms OK. Dose log marked ${doseUpdate.dose.status}.`
    });
    return {
      use_case: "confirmed",
      session_id: sessionId,
      path: "confirmed",
      stage: "complete",
      decision,
      dose_log: doseUpdate.today,
      dose_record: doseUpdate.dose,
      message: `Elder feels fine. Dose record: ${doseUpdate.dose.medication} → ${doseUpdate.dose.status}.`,
      correlation: {
        risk_score: 0,
        title: "All clear",
        narrative: `Symptoms OK. Chart recorded ${doseUpdate.dose.medication} as taken via call.`,
        live_agents: 0
      }
    };
  }

  if (useCase === "no_response" || useCase === "no-response" || useCase === "noanswer") {
    markReminderNoResponse({ patientId: patient.id, sessionId });
    const doseUpdate = applyDoseFromCall({
      patientId: patient.id,
      medicationId,
      intent: "no_input",
      sessionId,
      symptoms: ""
    });
    memory.put(`session:${sessionId}:dose-log`, doseUpdate.today);
    const investigation = await orchestrateMissedDose({
      patientId: patient.id,
      medicationId,
      sessionId,
      wellnessText: "No answer on reminder call. Elder did not report symptoms. Dose log marked missed from chart."
    });
    const score = investigation.correlation?.risk_score ?? 0;
    const call = await placeCaregiverCall({
      approved_action: "call",
      session_id: sessionId,
      to: process.env.TWILIO_DEFAULT_TO_NUMBER,
      message: `MedForge alert for ${patient.caregiver}. ${patient.name} did not answer. Dose log: ${doseUpdate.dose.medication} marked ${doseUpdate.dose.status}. Risk ${score}. Please check on them.`
    });
    investigation.correlation.title = "No answer — caregiver called";
    investigation.correlation.narrative = `No answer. Chart dose ${doseUpdate.dose.medication} → ${doseUpdate.dose.status}. Risk ${score}/100. Calling ${patient.caregiver}.`;
    memory.put(`session:${sessionId}:correlation`, investigation.correlation);
    return {
      use_case: "no_response",
      session_id: sessionId,
      path: "investigate_escalate",
      stage: "escalate",
      ...investigation,
      dose_log: doseUpdate.today,
      dose_record: doseUpdate.dose,
      twilio: call,
      auto_called_caregiver: call.status === "success",
      message: investigation.correlation.narrative
    };
  }

  if (useCase === "distress" || useCase === "dizzy") {
    // Symptoms on call → chart dose log (not memory question) → live investigate → call
    const symptomTurn = await runConversationAgent({
      sessionId,
      patientId: patient.id,
      medicationId,
      transcript: "I am not feeling well and dizzy",
      confidence: 0.94,
      phase: "symptoms"
    });
    const doseUpdate = applyDoseFromCall({
      patientId: patient.id,
      medicationId,
      intent: "distress",
      sessionId,
      symptoms: "I am not feeling well and dizzy"
    });
    memory.put(`session:${sessionId}:conversation`, {
      status: "complete",
      agent: "medforge-conversation-agent",
      harness: "trueforge",
      step: "symptoms",
      transcript: "I am not feeling well and dizzy",
      decision: symptomTurn,
      dose_record: doseUpdate.dose,
      updated_at: new Date().toISOString()
    });
    memory.put(`session:${sessionId}:dose-log`, doseUpdate.today);
    const distress = await handleElderResponse({
      patientId: patient.id,
      sessionId,
      intent: "distress",
      utterance: "I am not feeling well and dizzy"
    });
    return {
      use_case: "distress",
      session_id: sessionId,
      flow: ["symptoms", "chart_dose_log", "live_investigate", "escalate_if_needed"],
      decision: symptomTurn,
      dose_log: doseUpdate.today,
      dose_record: doseUpdate.dose,
      ...distress,
      message: `${distress.message} Dose log: ${doseUpdate.dose.medication} → ${doseUpdate.dose.status}.`
    };
  }

  return {
    error: "unknown_usecase",
    message: "useCase must be confirmed | no_response | distress"
  };
}

async function executeEscalation(input) {
  const action = String(input.action || "").toLowerCase();
  const sessionId = String(input.sessionId || "unknown");
  const patient = patientProfiles[input.patientId] || patientProfiles.eleanor;
  const medicationName = labelMedication(input.medicationId || "apixaban");

  if (action === "call") {
    const call = await placeCaregiverCall({
      approved_action: "call",
      session_id: sessionId,
      to: input.to || process.env.TWILIO_DEFAULT_TO_NUMBER,
      message:
        input.message ||
        `MedForge caregiver alert for ${patient.caregiver}. ${patient.name} did not respond to a medication reminder for ${medicationName}. Please check on them now.`
    });
    return {
      action,
      twilio: call,
      record: call.artifacts?.audit_id
        ? readAuditRecords().find((item) => item.id === call.artifacts.audit_id) || writeAuditRecord({ sessionId, action: "call" }).record
        : writeAuditRecord({
            sessionId,
            action: "call",
            channel: "twilio_voice",
            result: call.summary
          }).record,
      records: readAuditRecords()
    };
  }

  if (action === "alert") {
    const sms = await sendCaregiverSms({
      approved_action: "alert",
      session_id: sessionId,
      to: input.to || process.env.TWILIO_DEFAULT_TO_NUMBER,
      body:
        input.body ||
        `MedForge: ${patient.name} missed ${medicationName} and did not respond to reminder. Please check in. Caregiver: ${patient.caregiver}.`
    });
    return {
      action,
      twilio: sms,
      record: sms.artifacts?.audit_id
        ? readAuditRecords().find((item) => item.id === sms.artifacts.audit_id) || writeAuditRecord({ sessionId, action: "alert" }).record
        : writeAuditRecord({
            sessionId,
            action: "alert",
            channel: "twilio_sms",
            result: sms.summary
          }).record,
      records: readAuditRecords()
    };
  }

  return writeAuditRecord({ sessionId, action: "dismiss" });
}

function writeAuditRecord(input) {
  const records = readAuditRecords();
  const record = {
    id: `audit-${Date.now()}`,
    created_at: new Date().toISOString(),
    session_id: String(input.sessionId || "unknown"),
    action: String(input.action || "unknown"),
    actor: input.actor || "human-approver",
    agent: input.agent || "escalation-agent",
    channel: input.channel || null,
    provider_sid: input.provider_sid || null,
    result: input.result || escalationResult(input.action)
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
    setTimeout(() => resolve(Promise.resolve(callback())), ms);
  });
}

async function lookupRxNav(name) {
  const url = `${RXNAV_BASE_URL}?name=${encodeURIComponent(name)}`;
  try {
    const json = await fetchJsonWithTimeout(url, 3500);
    const group = json.drugGroup?.conceptGroup || [];
    const concept = group.flatMap((item) => item.conceptProperties || [])[0];
    return {
      status: concept ? "matched" : "no match",
      conceptName: concept?.name || "",
      rxcui: concept?.rxcui || "",
      tty: concept?.tty || ""
    };
  } catch (error) {
    return {
      status: `unavailable: ${error.message}`,
      conceptName: "",
      rxcui: "",
      tty: ""
    };
  }
}

async function lookupOpenFdaLabel(name) {
  const params = new URLSearchParams({
    search: `openfda.generic_name:"${name}"`,
    limit: "1"
  });
  if (process.env.OPENFDA_API_KEY) {
    params.set("api_key", process.env.OPENFDA_API_KEY);
  }

  try {
    const json = await fetchJsonWithTimeout(`${OPENFDA_LABEL_URL}?${params.toString()}`, 4500);
    const label = json.results?.[0] || {};
    return {
      status: "matched",
      boxedWarning: firstText(label.boxed_warning),
      warnings: firstText(label.warnings_and_cautions || label.warnings),
      contraindications: firstText(label.contraindications),
      indications: firstText(label.indications_and_usage)
    };
  } catch (error) {
    return {
      status: `unavailable: ${error.message}`,
      boxedWarning: "",
      warnings: "",
      contraindications: "",
      indications: ""
    };
  }
}

function classifyMedicationRisk(name, rxNav, openFda) {
  const text = `${name} ${rxNav.conceptName} ${openFda.boxedWarning} ${openFda.warnings} ${openFda.contraindications}`.toLowerCase();
  const highSignals = ["anticoagulant", "bleeding", "stroke", "seizure", "insulin", "transplant", "boxed warning"];
  const mediumSignals = ["diabetes", "glucose", "blood sugar", "contraindications", "warnings"];
  const matchedHigh = highSignals.filter((signal) => text.includes(signal));
  const matchedMedium = mediumSignals.filter((signal) => text.includes(signal));

  if (matchedHigh.length || name === "apixaban") {
    return {
      severity: "high",
      confidence: openFda.status === "matched" ? 0.86 : 0.74,
      score: 36,
      signal: matchedHigh.length ? matchedHigh.join(", ") : "known anticoagulant fallback",
      summary: `${labelMedication(name)} may be dangerous to skip; clinical labeling/risk rules indicate escalation-worthy medication risk.`
    };
  }

  if (matchedMedium.length || name === "metformin") {
    return {
      severity: "medium",
      confidence: openFda.status === "matched" ? 0.78 : 0.68,
      score: 18,
      signal: matchedMedium.length ? matchedMedium.join(", ") : "diabetes therapy fallback",
      summary: `${labelMedication(name)} miss is not usually an immediate emergency, but repeated misses can create clinical risk.`
    };
  }

  return {
    severity: "low",
    confidence: openFda.status === "matched" || rxNav.status === "matched" ? 0.7 : 0.55,
    score: 4,
    signal: "no high-acuity skip signal found",
    summary: `${labelMedication(name)} did not produce a high-acuity missed-dose signal in the current lookup.`
  };
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function firstText(value) {
  if (Array.isArray(value)) return String(value[0] || "").slice(0, 500);
  return String(value || "").slice(0, 500);
}

const MCP_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version"
};

async function handleMcpHttp(request, response) {
  const sessionId = request.headers["mcp-session-id"] || crypto.randomUUID();
  const headers = {
    ...MCP_CORS_HEADERS,
    "mcp-session-id": sessionId,
    "mcp-protocol-version": "2024-11-05"
  };

  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }

  if (request.method === "DELETE") {
    response.writeHead(204, headers);
    response.end();
    return;
  }

  if (request.method === "GET") {
    response.writeHead(405, { ...headers, allow: "POST, DELETE, OPTIONS" });
    response.end();
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405, { ...headers, allow: "POST, DELETE, OPTIONS" });
    response.end();
    return;
  }

  const body = await readJson(request);
  const payload = await handleMcpRequest(body);

  if (payload.empty) {
    response.writeHead(202, headers);
    response.end();
    return;
  }

  sendJson(response, 200, payload.body, headers);
}

async function handleMcpRequest(request) {
  const isBatch = Array.isArray(request);
  const requests = isBatch ? request : [request];
  const responses = [];

  for (const item of requests) {
    if (!item || typeof item.method !== "string") continue;

    const isNotification = item.id === undefined || item.id === null;
    if (isNotification || item.method.startsWith("notifications/")) {
      continue;
    }

    responses.push(await dispatchMcpMethod(item));
  }

  if (!responses.length) {
    return { empty: true };
  }

  return {
    empty: false,
    body: isBatch ? responses : responses[0]
  };
}

async function dispatchMcpMethod(item) {
  if (item.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: item.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: { listChanged: false }
        },
        serverInfo: {
          name: "medforge-tools",
          version: "0.1.0"
        }
      }
    };
  }

  if (item.method === "ping") {
    return {
      jsonrpc: "2.0",
      id: item.id,
      result: {}
    };
  }

  if (item.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: item.id,
      result: {
        tools: medforgeMcpTools()
      }
    };
  }

  if (item.method === "tools/call") {
    try {
      const result = await callMedforgeTool(item.params?.name, item.params?.arguments || {});
      return {
        jsonrpc: "2.0",
        id: item.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ],
          isError: false
        }
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: item.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "error",
                summary: error.message,
                next_actions: ["Retry with a supported MedForge tool name and required arguments."],
                artifacts: {}
              })
            }
          ],
          isError: true
        }
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id: item.id,
    error: {
      code: -32601,
      message: `Unknown method: ${item.method}`
    }
  };
}

function medforgeMcpTools() {
  return [
    {
      name: "get_adherence_history",
      description: "Return mock missed-dose history for a patient and medication, including misses in the last 7 days.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          patient_id: { type: "string", description: "Patient id such as eleanor, marcus, or rosa." },
          medication_id: { type: "string", description: "Medication id such as apixaban, metformin, or vitamin-d." }
        },
        required: ["patient_id", "medication_id"]
      },
      annotations: {
        title: "Get adherence history",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "get_dose_log",
      description: "Return today's dose log (taken / due / missed) from the MedForge chart — source of truth, not elder recall.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          patient_id: { type: "string", description: "Patient id such as eleanor." }
        },
        required: ["patient_id"]
      },
      annotations: {
        title: "Get dose log",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "record_dose_status",
      description: "Record whether a dose was taken or missed in the dose log (from call or pipeline). Do not ask the elder to remember.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          patient_id: { type: "string" },
          medication_id: { type: "string" },
          status: { type: "string", description: "taken | missed | due" },
          source: { type: "string", description: "call | pipeline | chart" },
          session_id: { type: "string" },
          note: { type: "string" }
        },
        required: ["patient_id", "medication_id", "status"]
      },
      annotations: {
        title: "Record dose status",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "lookup_drug_risk",
      description: "Use live RxNav and openFDA lookups to classify how dangerous it may be to skip a medication.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          medication_name: { type: "string", description: "Medication name or id, for example apixaban." }
        },
        required: ["medication_name"]
      },
      annotations: {
        title: "Lookup drug skip risk",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    {
      name: "get_refill_status",
      description: "Return mock pharmacy refill status JSON for a patient.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          patient_id: { type: "string", description: "Patient id such as eleanor, marcus, or rosa." },
          medication_id: { type: "string", description: "Medication id such as apixaban, metformin, or vitamin-d." }
        },
        required: ["patient_id", "medication_id"]
      },
      annotations: {
        title: "Get refill status",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "analyze_wellness_text",
      description: "Analyze a check-in transcript for confusion or distress keywords.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          transcript: { type: "string", description: "Voice check-in transcript or text stand-in." }
        },
        required: ["transcript"]
      },
      annotations: {
        title: "Analyze wellness transcript",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "send_caregiver_sms",
      description:
        "Send a caregiver SMS alert via Twilio AFTER human approval. Requires approved_action=alert and a destination phone in E.164 format.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          to: {
            type: "string",
            description: "Caregiver phone in E.164 format, e.g. +15551234567. Falls back to TWILIO_DEFAULT_TO_NUMBER."
          },
          body: {
            type: "string",
            description: "SMS body for the caregiver alert."
          },
          session_id: {
            type: "string",
            description: "MedForge session id for the audit trail."
          },
          approved_action: {
            type: "string",
            description: "Must be exactly 'alert'. Rejects any other value."
          }
        },
        required: ["body", "approved_action"]
      },
      annotations: {
        title: "Send caregiver SMS (Twilio)",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    {
      name: "place_caregiver_call",
      description:
        "Place a caregiver voice call via Twilio AFTER human approval. Speaks a short MedForge alert using Twilio TTS. Requires approved_action=call.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          to: {
            type: "string",
            description: "Caregiver phone in E.164 format. Falls back to TWILIO_DEFAULT_TO_NUMBER."
          },
          message: {
            type: "string",
            description: "Spoken alert script for the caregiver."
          },
          session_id: {
            type: "string",
            description: "MedForge session id for the audit trail."
          },
          approved_action: {
            type: "string",
            description: "Must be exactly 'call'. Rejects any other value."
          }
        },
        required: ["message", "approved_action"]
      },
      annotations: {
        title: "Place caregiver call (Twilio Voice)",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    {
      name: "memory_get",
      description: "Read a value from MedForge persistent memory by key (patient chart, session state, schedule results).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string", description: "Memory key, e.g. patient:eleanor or session:mg-123:schedule" }
        },
        required: ["key"]
      },
      annotations: {
        title: "Memory get",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "memory_put",
      description: "Write a JSON value into MedForge persistent memory.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string" },
          value: { description: "Any JSON value to store." }
        },
        required: ["key", "value"]
      },
      annotations: {
        title: "Memory put",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "get_skill",
      description: "Load a MedForge skill pack (procedure) by name. Use before classifying.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: {
            type: "string",
            description: "Skill id/name such as schedule-adherence, clinical-skip-risk, pharmacy-refill, wellness-distress, escalation-human-gate."
          }
        },
        required: ["name"]
      },
      annotations: {
        title: "Get skill pack",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    }
  ];
}

async function callMedforgeTool(name, args) {
  if (name === "get_adherence_history") {
    const patientId = args.patient_id || "eleanor";
    const medicationId = args.medication_id || "apixaban";
    const history = getAdherenceHistory(patientId, medicationId);
    const misses7d = countRecentMisses(history, 7);
    const today = doseLog.getDay(patientId);
    return {
      status: "success",
      summary: `${misses7d} missed ${labelMedication(medicationId)} doses in 7 days for ${patientId}. Today's log included.`,
      next_actions: ["Use dose log + history for schedule investigator JSON."],
      artifacts: {
        patient_id: patientId,
        medication_id: medicationId,
        history,
        misses_7d: misses7d,
        dose_log_today: today,
        pattern_rule: "2+ misses in 7 days"
      }
    };
  }

  if (name === "get_dose_log") {
    const patientId = args.patient_id || "eleanor";
    const patient = patientProfiles[patientId] || patientProfiles.eleanor;
    doseLog.seedFromSchedule(patient);
    const today = doseLog.getDay(patientId);
    return {
      status: "success",
      summary: `Today's dose log for ${patientId}: ${today.doses.map((d) => `${d.medication}=${d.status}`).join(", ")}`,
      next_actions: ["Treat dose log as source of truth for taken/missed. Do not ask elder to recall."],
      artifacts: { patient_id: patientId, today, recent: doseLog.listRecent(patientId, 5) }
    };
  }

  if (name === "record_dose_status") {
    const patientId = args.patient_id || "eleanor";
    const medicationId = args.medication_id || "apixaban";
    const status = String(args.status || "due").toLowerCase();
    const dose = doseLog.recordDose({
      patientId,
      medicationId,
      status,
      source: args.source || "pipeline",
      sessionId: args.session_id || null,
      note: args.note || null
    });
    return {
      status: "success",
      summary: `Recorded ${dose.medication} as ${dose.status} via ${dose.source}.`,
      next_actions: ["Continue investigation with updated dose log."],
      artifacts: { dose, today: doseLog.getDay(patientId) }
    };
  }

  if (name === "lookup_drug_risk") {
    const medicationName = String(args.medication_name || "apixaban").toLowerCase();
    const rxNav = await lookupRxNav(medicationName);
    const openFda = await lookupOpenFdaLabel(medicationName);
    const risk = classifyMedicationRisk(medicationName, rxNav, openFda);
    return {
      status: "success",
      summary: risk.summary,
      next_actions: ["Use RxNav/openFDA evidence plus the risk classification in investigator JSON. Do not invent live lookup results."],
      artifacts: {
        medication_name: medicationName,
        rxNav,
        openFda,
        risk
      }
    };
  }

  if (name === "get_refill_status") {
    const refill = getRefillStatus(args.patient_id || "eleanor");
    return {
      status: "success",
      summary: `Refill status for ${refill.patient_id}: ${refill.status}.`,
      next_actions: ["State clearly that pharmacy data is mocked, then return investigator JSON."],
      artifacts: refill
    };
  }

  if (name === "analyze_wellness_text") {
    const analysis = analyzeWellnessText(String(args.transcript || ""));
    return {
      status: "success",
      summary: analysis.signals.length
        ? `Distress/confusion signals: ${analysis.signals.join(", ")}.`
        : "No confusion or distress terms detected.",
      next_actions: ["Use matched signals only; do not invent symptoms. Then return investigator JSON."],
      artifacts: analysis
    };
  }

  if (name === "send_caregiver_sms") {
    return sendCaregiverSms(args);
  }

  if (name === "place_caregiver_call") {
    return placeCaregiverCall(args);
  }

  if (name === "memory_get") {
    const key = String(args.key || "");
    const entry = memory.get(key);
    return {
      status: entry ? "success" : "empty",
      summary: entry ? `Loaded memory key ${key}.` : `No memory for key ${key}.`,
      next_actions: entry ? ["Use this chart/session data in your classification."] : ["Continue with domain tools only."],
      artifacts: { key, entry }
    };
  }

  if (name === "memory_put") {
    const key = String(args.key || "");
    const entry = memory.put(key, args.value);
    return {
      status: "success",
      summary: `Stored memory key ${key}.`,
      next_actions: ["Continue with investigator JSON output."],
      artifacts: { entry }
    };
  }

  if (name === "get_skill") {
    const skill = readSkillPack(String(args.name || ""));
    if (!skill) {
      return {
        status: "error",
        summary: `Unknown skill: ${args.name}`,
        next_actions: ["Use one of: schedule-adherence, clinical-skip-risk, pharmacy-refill, wellness-distress, escalation-human-gate."],
        artifacts: { available: listSkillPacks().map((item) => item.id) }
      };
    }
    return {
      status: "success",
      summary: `Loaded skill ${skill.name}.`,
      next_actions: ["Follow the skill procedure, then call domain tools."],
      artifacts: skill
    };
  }

  throw new Error(`Unknown MedForge MCP tool: ${name}`);
}

function getTwilioAuth() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const apiKeySid = process.env.TWILIO_API_KEY_SID || "";
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET || "";
  const useAuthToken = Boolean(accountSid.startsWith("AC") && authToken);
  const useApiKey = Boolean(accountSid.startsWith("AC") && apiKeySid.startsWith("SK") && apiKeySecret);
  return {
    accountSid,
    useAuthToken,
    useApiKey,
    authUser: useAuthToken ? accountSid : apiKeySid,
    authPass: useAuthToken ? authToken : apiKeySecret,
    authMode: useAuthToken ? "auth_token" : useApiKey ? "api_key" : "none"
  };
}

async function placeCaregiverCall(args) {
  const approvedAction = String(args.approved_action || "").trim().toLowerCase();
  if (approvedAction !== "call") {
    return {
      status: "error",
      summary: "Refused: place_caregiver_call requires approved_action=call from the Human Approval Gate.",
      next_actions: ["Wait for human approval with action 'call', then retry."],
      artifacts: { approved_action: approvedAction || null }
    };
  }

  const twilio = getTwilioAuth();
  const from = process.env.TWILIO_FROM_NUMBER || "";
  const to = String(args.to || process.env.TWILIO_DEFAULT_TO_NUMBER || "").trim();
  const message = String(args.message || "").trim();
  const sessionId = String(args.session_id || "unknown");

  const missing = [];
  if (!twilio.accountSid.startsWith("AC")) missing.push("TWILIO_ACCOUNT_SID");
  if (!twilio.useAuthToken && !twilio.useApiKey) missing.push("TWILIO_AUTH_TOKEN");
  if (!from) missing.push("TWILIO_FROM_NUMBER");
  if (!to) missing.push("to or TWILIO_DEFAULT_TO_NUMBER");
  if (!message) missing.push("message");

  if (missing.length) {
    return {
      status: "error",
      summary: `Twilio Voice not fully configured: missing ${missing.join(", ")}.`,
      next_actions: ["Add missing Twilio env vars and restart MedForge."],
      artifacts: { missing }
    };
  }

  const safeMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const twiml = `<Response><Say voice="Polly.Joanna">${safeMessage}</Say><Pause length="1"/><Say voice="Polly.Joanna">This was a MedForge human-approved alert. Goodbye.</Say></Response>`;
  const auth = Buffer.from(`${twilio.authUser}:${twilio.authPass}`).toString("base64");
  const form = new URLSearchParams({
    To: to,
    From: from,
    Twiml: twiml
  });

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Calls.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "error",
        summary: `Twilio call failed: ${payload.message || `HTTP ${response.status}`}`,
        next_actions: [
          "On trial accounts, verify the To number under Verified Caller IDs.",
          "Check Twilio Voice logs in the console."
        ],
        artifacts: {
          twilio_status: response.status,
          twilio_code: payload.code || null,
          twilio_message: payload.message || null,
          auth_mode: twilio.authMode
        }
      };
    }

    const audit = writeAuditRecord({
      sessionId,
      action: "call",
      channel: "twilio_voice",
      result: `Placed Twilio call ${payload.sid} to ${to}.`,
      provider_sid: payload.sid
    });

    return {
      status: "success",
      summary: `Caregiver call placed via Twilio (${payload.sid}).`,
      next_actions: ["Return escalation JSON including the Twilio call SID and audit id."],
      artifacts: {
        call_sid: payload.sid,
        to,
        from,
        status: payload.status,
        session_id: sessionId,
        audit_id: audit.record.id,
        auth_mode: twilio.authMode
      }
    };
  } catch (error) {
    return {
      status: "error",
      summary: `Twilio call request failed: ${error.message}`,
      next_actions: ["Retry after confirming network access and Twilio credentials."],
      artifacts: {}
    };
  }
}

async function sendCaregiverSms(args) {
  const approvedAction = String(args.approved_action || "").trim().toLowerCase();
  if (approvedAction !== "alert") {
    return {
      status: "error",
      summary: "Refused: send_caregiver_sms requires approved_action=alert from the Human Approval Gate.",
      next_actions: ["Wait for human approval with action 'alert', then retry."],
      artifacts: { approved_action: approvedAction || null }
    };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const apiKeySid = process.env.TWILIO_API_KEY_SID || "";
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET || "";
  const from = process.env.TWILIO_FROM_NUMBER || "";
  const to = String(args.to || process.env.TWILIO_DEFAULT_TO_NUMBER || "").trim();
  const body = String(args.body || "").trim();
  const sessionId = String(args.session_id || "unknown");

  const useAuthToken = Boolean(accountSid.startsWith("AC") && authToken);
  const useApiKey = Boolean(accountSid.startsWith("AC") && apiKeySid.startsWith("SK") && apiKeySecret);

  const missing = [];
  if (!accountSid.startsWith("AC")) missing.push("TWILIO_ACCOUNT_SID (must start with AC)");
  if (!useAuthToken && !useApiKey) missing.push("TWILIO_AUTH_TOKEN (or API Key SID+Secret)");
  if (!from) missing.push("TWILIO_FROM_NUMBER");
  if (!to) missing.push("to or TWILIO_DEFAULT_TO_NUMBER");
  if (!body) missing.push("body");

  if (missing.length) {
    return {
      status: "error",
      summary: `Twilio not fully configured: missing ${missing.join(", ")}.`,
      next_actions: [
        "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, and a destination number to .env, then restart the MedForge server."
      ],
      artifacts: { missing }
    };
  }

  const authUser = useAuthToken ? accountSid : apiKeySid;
  const authPass = useAuthToken ? authToken : apiKeySecret;
  const auth = Buffer.from(`${authUser}:${authPass}`).toString("base64");
  const form = new URLSearchParams({
    To: to,
    From: from,
    Body: body
  });

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "error",
        summary: `Twilio SMS failed: ${payload.message || `HTTP ${response.status}`}`,
        next_actions: [
          "On trial accounts, verify the To number under Verified Caller IDs.",
          "Check From number, Account SID, and Twilio console Messaging logs."
        ],
        artifacts: {
          twilio_status: response.status,
          twilio_code: payload.code || null,
          twilio_message: payload.message || null,
          auth_mode: useAuthToken ? "auth_token" : "api_key"
        }
      };
    }

    const audit = writeAuditRecord({
      sessionId,
      action: "alert",
      channel: "twilio_sms",
      result: `Sent Twilio SMS ${payload.sid} to ${to}.`,
      provider_sid: payload.sid
    });

    return {
      status: "success",
      summary: `Caregiver SMS sent via Twilio (${payload.sid}).`,
      next_actions: ["Return escalation JSON including the Twilio message SID and audit id."],
      artifacts: {
        message_sid: payload.sid,
        to,
        from,
        status: payload.status,
        session_id: sessionId,
        audit_id: audit.record.id,
        auth_mode: useAuthToken ? "auth_token" : "api_key"
      }
    };
  } catch (error) {
    return {
      status: "error",
      summary: `Twilio request failed: ${error.message}`,
      next_actions: ["Retry after confirming network access and Twilio credentials."],
      artifacts: {}
    };
  }
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

function readForm(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => {
      const params = new URLSearchParams(data || "");
      const out = {};
      for (const [key, value] of params.entries()) {
        out[key] = value;
      }
      resolve(out);
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendXml(response, status, xml) {
  response.writeHead(status, {
    "content-type": "text/xml; charset=utf-8"
  });
  response.end(xml);
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
  if (medicationCatalog[value]) return medicationCatalog[value].displayName;
  return value;
}

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separator = trimmed.indexOf("=");
      if (separator === -1) return;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    });
}
