const PATIENT_ID = "eleanor";
const MEDICATION_ID = "apixaban";
const WELLNESS_TEXT = "No answer on reminder call. Last known check-in mentioned feeling dizzy and confused.";

const els = {
  sessionId: document.querySelector("#session-id"),
  stageLabel: document.querySelector("#stage-label"),
  engineLabel: document.querySelector("#engine-label"),
  runtime: document.querySelector("#runtime"),
  patientName: document.querySelector("#patient-name"),
  patientLede: document.querySelector("#patient-lede"),
  conditionChips: document.querySelector("#condition-chips"),
  scheduleList: document.querySelector("#schedule-list"),
  stockList: document.querySelector("#stock-list"),
  diagList: document.querySelector("#diag-list"),
  reminderStatus: document.querySelector("#reminder-status"),
  callSid: document.querySelector("#call-sid"),
  doseList: document.querySelector("#dose-list"),
  doseListPatient: document.querySelector("#dose-list-patient"),
  doseHint: document.querySelector("#dose-hint"),
  btnDoseRefresh: document.querySelector("#btn-dose-refresh"),
  callingSummary: document.querySelector("#calling-summary"),
  corrSummary: document.querySelector("#corr-summary"),
  riskScore: document.querySelector("#risk-score"),
  riskRing: document.querySelector("#risk-ring"),
  riskTitle: document.querySelector("#risk-title"),
  riskNarrative: document.querySelector("#risk-narrative"),
  auditLog: document.querySelector("#audit-log"),
  btnReminder: document.querySelector("#btn-reminder"),
  btnInvestigate: document.querySelector("#btn-investigate"),
  btnDemoOk: document.querySelector("#btn-demo-ok"),
  btnDemoNoAnswer: document.querySelector("#btn-demo-noanswer"),
  btnDemoDistress: document.querySelector("#btn-demo-distress"),
  demoHint: document.querySelector("#demo-hint"),
  btnScheduleEnsure: document.querySelector("#btn-schedule-ensure"),
  btnScheduleRun: document.querySelector("#btn-schedule-run"),
  btnTfRefresh: document.querySelector("#btn-tf-refresh"),
  scheduleStatus: document.querySelector("#schedule-status"),
  tfStatusTitle: document.querySelector("#tf-status-title"),
  tfStatusNote: document.querySelector("#tf-status-note"),
  tfAgentList: document.querySelector("#tf-agent-list"),
  tfScheduleList: document.querySelector("#tf-schedule-list"),
  tfSessionList: document.querySelector("#tf-session-list"),
  tfRunBox: document.querySelector("#tf-run-box"),
  tfRunList: document.querySelector("#tf-run-list"),
  tfLibraryLink: document.querySelector("#tf-library-link"),
  tfSchedulesLink: document.querySelector("#tf-schedules-link"),
  tfSessionsLink: document.querySelector("#tf-sessions-link"),
  pipeline: [...document.querySelectorAll("#pipeline li")],
  cards: {
    calling: document.querySelector('[data-agent="calling"]'),
    schedule: document.querySelector('[data-agent="schedule"]'),
    clinical: document.querySelector('[data-agent="clinical"]'),
    pharmacy: document.querySelector('[data-agent="pharmacy"]'),
    wellness: document.querySelector('[data-agent="wellness"]'),
    correlation: document.querySelector('[data-agent="correlation"]')
  }
};

let activeSessionId = null;
let activeScheduleId = null;
let timer = null;
let startedAt = null;
let conversationPoll = null;
let sessionStatePoll = null;

boot();

document.querySelectorAll(".side-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".side-tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`[data-panel="${tab.dataset.tab}"]`)?.classList.add("active");
  });
});

els.btnReminder.addEventListener("click", runReminderCall);
els.btnInvestigate.addEventListener("click", runInvestigation);
els.btnDemoOk.addEventListener("click", () => runDemoUseCase("confirmed"));
els.btnDemoNoAnswer.addEventListener("click", () => runDemoUseCase("no_response"));
els.btnDemoDistress.addEventListener("click", () => runDemoUseCase("distress"));
els.btnDoseRefresh?.addEventListener("click", refreshDoseLog);
els.btnScheduleEnsure.addEventListener("click", ensureSchedule);
els.btnScheduleRun.addEventListener("click", runScheduleNow);
els.btnTfRefresh.addEventListener("click", refreshTrueForgeLive);

async function boot() {
  const response = await fetch(`/api/patient?id=${PATIENT_ID}`);
  const payload = await response.json();
  renderProfile(payload.patient);
  renderDoseLog(payload.patient.dose_log);
  setStage("Ready", "reminder");
  await refreshSchedules();
  await refreshTrueForgeLive();
  await refreshDoseLog();
}

function renderDoseLog(today) {
  const doses = today?.doses || [];
  const render = (listEl) => {
    if (!listEl) return;
    if (!doses.length) {
      listEl.replaceChildren(emptyItem("No dose log yet"));
      return;
    }
    listEl.replaceChildren(
      ...doses.map((dose) => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${dose.time} · ${dose.medication}</strong>
          <span class="dose-status ${dose.status}">${dose.status}</span>
          <small>${dose.source || "chart"}${dose.note ? ` · ${dose.note}` : ""} · ${dose.updated_at ? new Date(dose.updated_at).toLocaleTimeString() : ""}</small>`;
        return li;
      })
    );
  };
  render(els.doseList);
  render(els.doseListPatient);
  if (els.doseHint) {
    const missed = doses.filter((d) => d.status === "missed" || d.status === "due");
    els.doseHint.textContent = missed.length
      ? `${missed.length} dose(s) still due/missed on chart — not asking elder to recall.`
      : "All logged doses taken for today.";
  }
}

async function refreshDoseLog() {
  try {
    const response = await fetch(`/api/dose-log?patient_id=${PATIENT_ID}`);
    const payload = await response.json();
    renderDoseLog(payload.today);
  } catch (error) {
    if (els.doseHint) els.doseHint.textContent = error.message;
  }
}

function renderProfile(patient) {
  els.patientName.textContent = patient.name;
  els.patientLede.textContent = `${patient.age} · ${patient.location} · Caregiver ${patient.caregiver} (${patient.caregiverRelation})`;
  els.conditionChips.replaceChildren(
    ...patient.conditions.map((condition) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = condition;
      return chip;
    })
  );
  els.scheduleList.replaceChildren(
    ...patient.schedule.map((item) => {
      const li = document.createElement("li");
      const crit = item.criticality === "critical" ? " · CRITICAL" : "";
      li.innerHTML = `<strong>${item.time} · ${item.medication}${crit}</strong><small>${item.status}</small>`;
      return li;
    })
  );
  els.stockList.replaceChildren(
    ...(patient.inventory || []).map((item) => {
      const li = document.createElement("li");
      const low = item.pillsRemaining <= 3 || item.pendingRefill;
      li.innerHTML = `<strong class="${low ? "crit" : ""}">${item.name}</strong>
        <small>Last bought ${item.lastBought} · ${item.pillsRemaining} pills (~${item.daysSupplyLeft}d)</small>
        <small>Pending refill: ${item.pendingRefill ? `${item.pendingQty} · ${item.pharmacyStatus}` : "none"}</small>`;
      return li;
    })
  );
  els.diagList.replaceChildren(
    ...patient.diagnostics.map((item) => {
      const wrap = document.createElement("div");
      wrap.innerHTML = `<dt>${item.label}</dt><dd>${item.value}</dd>`;
      return wrap;
    })
  );
}

async function refreshTrueForgeLive() {
  try {
    const response = await fetch("/api/trueforge/live");
    const live = await response.json();
    els.tfLibraryLink.href = live.library_url || "http://localhost:8790/library";
    els.tfSchedulesLink.href = live.schedules_url || "http://localhost:8790/schedules";
    els.tfSessionsLink.href = live.sessions_url || "http://localhost:8790/sessions";
    if (!live.ok) {
      els.engineLabel.textContent = "TrueForge offline";
      els.tfStatusTitle.textContent = "TrueForge unreachable";
      els.tfStatusNote.textContent = live.error || "Start TrueForge on :8790";
      return;
    }
    els.engineLabel.textContent = "TrueForge LIVE";
    els.tfStatusTitle.textContent = `${live.agents.length} agents · ${live.schedules.length} schedules · ${live.sessions.length} sessions`;
    els.tfStatusNote.textContent = live.note;
    els.tfAgentList.replaceChildren(
      ...live.agents.map((agent) => {
        const li = document.createElement("li");
        li.innerHTML = `<a href="${agent.url}" target="_blank" rel="noreferrer">${agent.name}</a>`;
        return li;
      })
    );
    els.tfScheduleList.replaceChildren(
      ...(live.schedules.length
        ? live.schedules.map((schedule) => {
            const li = document.createElement("li");
            li.innerHTML = `<strong>${schedule.name}</strong><br><span class="tiny">${schedule.agent_name} · ${schedule.cron}</span>`;
            return li;
          })
        : [emptyItem("No schedules yet")])
    );
    els.tfSessionList.replaceChildren(
      ...(live.sessions.length
        ? live.sessions.map((session) => {
            const li = document.createElement("li");
            li.innerHTML = `<a href="${session.url}" target="_blank" rel="noreferrer">${(session.title || session.id).slice(0, 64)}</a>`;
            return li;
          })
        : [emptyItem("No sessions yet")])
    );
  } catch (error) {
    els.engineLabel.textContent = "TrueForge error";
    els.tfStatusTitle.textContent = error.message;
  }
}

function emptyItem(text) {
  const li = document.createElement("li");
  li.textContent = text;
  return li;
}

async function refreshSchedules() {
  try {
    const response = await fetch("/api/schedules");
    const payload = await response.json();
    const match = (payload.schedules || []).find((item) => item.name === "eleanor-apixaban-morning-check");
    if (match) {
      activeScheduleId = match.id;
      els.scheduleStatus.textContent = `Linked: ${match.name}`;
      els.btnScheduleRun.disabled = false;
    } else {
      els.scheduleStatus.textContent = "No morning schedule yet.";
    }
  } catch (error) {
    els.scheduleStatus.textContent = error.message;
  }
}

async function ensureSchedule() {
  els.btnScheduleEnsure.disabled = true;
  try {
    const response = await fetch("/api/schedules/ensure", { method: "POST" });
    const payload = await response.json();
    activeScheduleId = payload.schedule.id;
    els.scheduleStatus.textContent = `Linked: ${payload.schedule.name}`;
    els.btnScheduleRun.disabled = false;
    prependAudit("TrueForge schedule linked.");
    await refreshTrueForgeLive();
  } catch (error) {
    els.scheduleStatus.textContent = error.message;
  } finally {
    els.btnScheduleEnsure.disabled = false;
  }
}

async function runScheduleNow() {
  els.btnScheduleRun.disabled = true;
  try {
    const response = await fetch("/api/schedules/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduleId: activeScheduleId })
    });
    const payload = await response.json();
    els.scheduleStatus.textContent = `Run ${payload.run?.data?.id || "started"}`;
    prependAudit("Schedule run triggered.");
    await refreshTrueForgeLive();
  } catch (error) {
    els.scheduleStatus.textContent = error.message;
  } finally {
    els.btnScheduleRun.disabled = false;
  }
}

async function runReminderCall() {
  resetForNewRun();
  startTimer();
  setStage("Reminder call", "reminder");
  setCardRunning(els.cards.calling);
  setDemoBusy(true);
  els.reminderStatus.textContent = "Placing conversational reminder call…";
  try {
    const response = await fetch("/api/reminder-call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patientId: PATIENT_ID, medicationId: MEDICATION_ID, sessionId: activeSessionId })
    });
    const payload = await response.json();
    activeSessionId = payload.session_id;
    els.sessionId.textContent = activeSessionId;
    const ok = payload.reminder?.status === "called";
    const live = Boolean(payload.webhook_configured);
    els.cards.calling.className = `agent-card complete ${ok ? "low" : "high"}`;
    els.callingSummary.textContent = ok ? "Reminder call live — say how you feel." : payload.reminder?.summary || "Call failed.";
    els.reminderStatus.textContent = ok
      ? live
        ? "Answer and speak (e.g. missed + dizzy). Phone says we’ll check → pipeline → Anika if high."
        : "Call placed — set TWILIO_WEBHOOK_BASE_URL for speech."
      : payload.reminder?.summary || "Failed";
    els.callSid.textContent = payload.reminder?.call_sid ? `SID ${payload.reminder.call_sid}` : "";
    setPipeline("reminder", true);
    setStage("Listening", "converse");
    els.btnInvestigate.disabled = false;
    if (ok && live) startConversationPoll();
    prependAudit(ok ? "Conversational reminder placed." : "Reminder failed.");
    await refreshDoseLog();
  } catch (error) {
    els.reminderStatus.textContent = error.message;
  } finally {
    setDemoBusy(false);
  }
}

function stopConversationPoll() {
  if (conversationPoll) clearInterval(conversationPoll);
  conversationPoll = null;
}

function startConversationPoll() {
  stopConversationPoll();
  conversationPoll = setInterval(pollConversation, 2000);
  pollConversation();
}

async function pollConversation() {
  if (!activeSessionId) return;
  try {
    const response = await fetch(`/api/conversation?session_id=${encodeURIComponent(activeSessionId)}`);
    const payload = await response.json();
    const convo = payload.conversation?.value || payload.conversation;
    if (!convo) return;
    const decision = convo.decision || {};
    const intent = decision.intent || "unclear";
    const status = convo.status || "";

    if (status === "calling") {
      els.reminderStatus.textContent = "On the line — waiting for speech…";
      return;
    }
    if (status === "thinking" || status === "pipeline_running") {
      els.reminderStatus.textContent =
        status === "pipeline_running"
          ? "Heard you — OK, checking chart now. High risk will call Anika in seconds…"
          : "Listening / deciding…";
      setPipeline("converse", true);
      markInvestigatorsRunning();
      if (status === "pipeline_running") startSessionStatePoll();
      return;
    }
    if (status !== "complete") return;

    setPipeline("converse", true);
    await refreshDoseLog();

    if (intent === "confirmed") {
      setRisk(0);
      els.riskTitle.textContent = "All clear";
      els.riskNarrative.textContent = decision.spoken_reply_to_elder || "Confirmed.";
      stopConversationPoll();
      stopTimer();
      return;
    }

    if (convo.pipeline?.called || decision.escalate_caregiver || intent === "distress" || intent === "no_input") {
      if (convo.pipeline?.risk_score != null) setRisk(convo.pipeline.risk_score);
      markInvestigatorsRunning();
      showTab("agents");
      stopConversationPoll();
      startSessionStatePoll();
    }
  } catch (_e) {}
}

function stopSessionStatePoll() {
  if (sessionStatePoll) clearInterval(sessionStatePoll);
  sessionStatePoll = null;
}

function startSessionStatePoll() {
  stopSessionStatePoll();
  sessionStatePoll = setInterval(pollSessionState, 2500);
  pollSessionState();
}

async function pollSessionState() {
  if (!activeSessionId) return;
  try {
    const response = await fetch(`/api/session-state?session_id=${encodeURIComponent(activeSessionId)}`);
    const payload = await response.json();
    const investigators = payload.investigators?.value || payload.investigators;
    const correlation = payload.correlation?.value || payload.correlation;
    const trueforge = payload.trueforge?.value || payload.trueforge || [];
    const session = payload.session?.value || payload.session;
    if (!investigators || !correlation) return;
    renderInvestigators(investigators, trueforge);
    renderTrueForgeRuns(trueforge);
    applyEscalateResult({
      correlation,
      mode: session?.mode || "trueforge",
      twilio: session?.twilio
    });
    stopSessionStatePoll();
    stopTimer();
    await refreshTrueForgeLive();
  } catch (_e) {}
}

async function runDemoUseCase(useCase) {
  resetForNewRun();
  startTimer();
  setDemoBusy(true);
  markInvestigatorsRunning();
  setCardRunning(els.cards.calling);
  showTab(useCase === "confirmed" ? "run" : "agents");
  els.demoHint.textContent = `Running ${useCase}… live TrueForge agents working.`;
  setStage(useCase === "confirmed" ? "Confirmed" : "Investigating", useCase === "confirmed" ? "converse" : "investigate");

  try {
    const response = await fetch("/api/demo/usecase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ useCase, patientId: PATIENT_ID, medicationId: MEDICATION_ID, sessionId: activeSessionId })
    });
    const payload = await response.json();
    if (payload.error) throw new Error(payload.message || payload.error);
    activeSessionId = payload.session_id || payload.session?.id || activeSessionId;
    els.sessionId.textContent = activeSessionId;

    if (useCase === "confirmed") {
      els.cards.calling.className = "agent-card complete low";
      els.callingSummary.textContent = "Schedule checked · elder feels fine.";
      if (els.cards.schedule) {
        els.cards.schedule.className = "agent-card complete low";
        els.cards.schedule.querySelector(".summary").textContent = "Live schedule agent ran first.";
      }
      if (els.cards.wellness) {
        els.cards.wellness.className = "agent-card complete low";
        els.cards.wellness.querySelector(".summary").textContent = "Symptoms OK.";
      }
      setRisk(0);
      els.riskTitle.textContent = "All clear";
      els.riskNarrative.textContent = payload.message;
      els.reminderStatus.textContent = "Use case A done.";
      if (payload.dose_log) renderDoseLog(payload.dose_log);
      else await refreshDoseLog();
      setPipeline("reminder", true);
      setPipeline("converse", true);
      setPipeline("investigate", true);
      prependAudit(`A: OK · dose ${payload.dose_record?.status || "taken"}`);
      showTab("run");
      stopTimer();
      await refreshTrueForgeLive();
      return;
    }

    renderInvestigators(payload.investigators || [], payload.trueforge || []);
    renderTrueForgeRuns(payload.trueforge || []);
    setPipeline("reminder", true);
    setPipeline("converse", true);
    setPipeline("investigate", true);
    applyEscalateResult({
      correlation: payload.correlation,
      mode: payload.session?.mode || payload.mode || "trueforge",
      twilio: payload.twilio
    });
    els.cards.calling.className = "agent-card complete high";
    els.callingSummary.textContent = payload.twilio?.summary || "Caregiver path finished.";
    els.reminderStatus.textContent = payload.message || "Done.";
    if (payload.dose_log) renderDoseLog(payload.dose_log);
    else await refreshDoseLog();
    els.callSid.textContent = payload.twilio?.artifacts?.call_sid
      ? `Caregiver SID ${payload.twilio.artifacts.call_sid}`
      : els.callSid.textContent;
    const liveN = payload.correlation?.live_agents ?? (payload.investigators || []).filter((i) => i.source === "trueforge").length;
    prependAudit(
      `${useCase === "no_response" ? "B" : "C"}: dose ${payload.dose_record?.status || "?"} · risk ${payload.correlation?.risk_score ?? "?"} · live ${liveN}/4`
    );
    showTab("run");
    stopTimer();
    await refreshTrueForgeLive();
  } catch (error) {
    els.riskTitle.textContent = "Demo failed";
    els.riskNarrative.textContent = error.message;
    els.demoHint.textContent = error.message;
  } finally {
    setDemoBusy(false);
  }
}

function setDemoBusy(busy) {
  [els.btnDemoOk, els.btnDemoNoAnswer, els.btnDemoDistress, els.btnReminder, els.btnInvestigate].forEach((button) => {
    if (button) button.disabled = busy;
  });
}

function applyEscalateResult({ correlation, mode, twilio }) {
  const score = Number(correlation?.risk_score || 0);
  setRisk(score);
  if (els.cards.correlation) {
    els.cards.correlation.className = `agent-card complete ${score >= 70 ? "high" : score >= 35 ? "medium" : "low"}`;
  }
  if (els.corrSummary) els.corrSummary.textContent = correlation?.narrative || "";
  els.riskTitle.textContent = correlation?.title || "Escalated";
  els.engineLabel.textContent = String(mode || "").startsWith("trueforge") ? "TrueForge LIVE" : mode || "local";
  els.riskNarrative.textContent = `${correlation?.narrative || ""} Risk ${score}.`;
  setPipeline("investigate", true);
  setPipeline("escalate", true);
  setStage("Escalated", "escalate");
  els.btnInvestigate.disabled = false;
  if (twilio?.artifacts?.call_sid) {
    els.callSid.textContent = `Caregiver SID ${twilio.artifacts.call_sid}`;
  }
}

async function runInvestigation() {
  setStage("Investigating", "investigate");
  els.btnInvestigate.disabled = true;
  markInvestigatorsRunning();
  showTab("agents");
  startTimer();
  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        patientId: PATIENT_ID,
        medicationId: MEDICATION_ID,
        wellnessText: WELLNESS_TEXT,
        sessionId: activeSessionId
      })
    });
    const payload = await response.json();
    activeSessionId = payload.session.id;
    els.sessionId.textContent = activeSessionId;
    renderInvestigators(payload.investigators, payload.trueforge || []);
    renderTrueForgeRuns(payload.trueforge || []);
    const escalate = await fetch("/api/escalations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: activeSessionId, patientId: PATIENT_ID, medicationId: MEDICATION_ID, action: "call" })
    });
    const esc = await escalate.json();
    applyEscalateResult({
      correlation: payload.correlation,
      mode: payload.session?.mode,
      twilio: esc.twilio
    });
    prependAudit(esc.twilio?.summary || "Escalated.");
    showTab("run");
    stopTimer();
    await refreshTrueForgeLive();
  } catch (error) {
    els.riskTitle.textContent = "Failed";
    els.riskNarrative.textContent = error.message;
    els.btnInvestigate.disabled = false;
    stopTimer();
  }
}

function showTab(name) {
  document.querySelectorAll(".side-tab").forEach((item) => {
    item.classList.toggle("active", item.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === name);
  });
}

function renderInvestigators(results, trueforgeRuns = []) {
  const map = {
    "schedule-investigator": "schedule",
    "clinical-risk-investigator": "clinical",
    "pharmacy-investigator": "pharmacy",
    "wellness-investigator": "wellness"
  };
  results.forEach((result) => {
    const key = map[result.agent];
    const card = els.cards[key];
    if (!card) return;
    const live = result.source === "trueforge";
    card.className = `agent-card complete ${result.severity || "medium"}`;
    const tag = card.querySelector(".live-tag");
    if (tag) {
      tag.textContent = live ? "live" : "fallback";
      tag.classList.toggle("fallback", !live);
    }
    const summary = card.querySelector(".summary");
    if (summary) {
      summary.textContent = `${result.summary || "Done"} · score ${result.score}/25`;
    }
    const dl = card.querySelector("dl");
    if (dl) {
      dl.replaceChildren(
        ...(result.evidence || []).slice(0, 4).map((item) => {
          const row = document.createElement("div");
          row.innerHTML = `<dt>${item.label}</dt><dd>${item.value}</dd>`;
          return row;
        })
      );
    }
    const sid = result.trueforge_session_id || trueforgeRuns.find((item) => item.key === key)?.result?.trueforge_session_id;
    if (sid) {
      let link = card.querySelector(".tf-link");
      if (!link) {
        link = document.createElement("a");
        link.className = "tf-link tiny";
        link.target = "_blank";
        link.rel = "noreferrer";
        card.appendChild(link);
      }
      link.href = `http://localhost:8790/sessions/${sid}`;
      link.textContent = "Open TrueForge session";
    }
  });
}

function renderTrueForgeRuns(runs) {
  if (!runs?.length) {
    els.tfRunBox.hidden = true;
    return;
  }
  els.tfRunBox.hidden = false;
  els.tfRunList.replaceChildren(
    ...runs.map((run) => {
      const li = document.createElement("li");
      const sid = run.result?.trueforge_session_id;
      li.innerHTML = sid
        ? `<a href="http://localhost:8790/sessions/${sid}" target="_blank" rel="noreferrer">${run.agent || run.key}</a>`
        : run.agent || run.key;
      return li;
    })
  );
}

function markInvestigatorsRunning() {
  ["schedule", "clinical", "pharmacy", "wellness", "correlation"].forEach((key) => setCardRunning(els.cards[key]));
}

function setCardRunning(card) {
  if (card) card.className = "agent-card running";
}

function resetForNewRun() {
  stopConversationPoll();
  stopSessionStatePoll();
  activeSessionId = `mg-${Date.now().toString().slice(-6)}`;
  els.sessionId.textContent = activeSessionId;
  els.auditLog.replaceChildren();
  els.callSid.textContent = "";
  els.btnInvestigate.disabled = true;
  setRisk(0);
  els.riskTitle.textContent = "Pipeline ready";
  els.riskNarrative.textContent = "Run A, B, or C for the demo video.";
  els.demoHint.textContent = "A stops. B/C investigate live then auto-call Anika.";
  Object.values(els.cards).forEach((card) => {
    if (!card) return;
    card.className = "agent-card";
    card.querySelector(".tf-link")?.remove();
  });
  els.pipeline.forEach((item) => item.classList.remove("active", "done"));
  els.tfRunBox.hidden = true;
}

function setStage(label, step) {
  els.stageLabel.textContent = label;
  setPipeline(step, false);
}

function setPipeline(step, markDone) {
  els.pipeline.forEach((item) => {
    const isCurrent = item.dataset.step === step;
    item.classList.toggle("active", isCurrent && !markDone);
    if (markDone && isCurrent) {
      item.classList.add("done");
      item.classList.remove("active");
    }
  });
}

function setRisk(value) {
  const score = Math.max(0, Math.min(100, Number(value) || 0));
  const circumference = 301.59;
  els.riskScore.textContent = String(Math.round(score));
  els.riskRing.style.strokeDashoffset = circumference - (circumference * score) / 100;
  els.riskRing.style.stroke = score >= 70 ? "var(--red)" : score >= 35 ? "var(--amber)" : "var(--green)";
}

function prependAudit(text) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} · ${text}`;
  els.auditLog.prepend(item);
}

function startTimer() {
  stopTimer();
  startedAt = performance.now();
  timer = setInterval(() => {
    els.runtime.textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
  }, 100);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}
