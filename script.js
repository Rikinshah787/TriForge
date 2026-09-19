const form = document.querySelector("#missed-dose-form");
const cards = {
  schedule: document.querySelector('[data-agent="schedule"]'),
  clinical: document.querySelector('[data-agent="clinical"]'),
  pharmacy: document.querySelector('[data-agent="pharmacy"]'),
  wellness: document.querySelector('[data-agent="wellness"]')
};
const sessionId = document.querySelector("#session-id");
const runtime = document.querySelector("#runtime");
const auditCount = document.querySelector("#audit-count");
const riskScore = document.querySelector("#risk-score");
const riskRing = document.querySelector("#risk-ring");
const riskTitle = document.querySelector("#risk-title");
const riskNarrative = document.querySelector("#risk-narrative");
const auditLog = document.querySelector("#audit-log");
const actionButtons = document.querySelectorAll("[data-action]");

let audits = 0;
let timer;
let activeSessionId = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetRun();

  const started = performance.now();
  timer = setInterval(() => {
    runtime.textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
  }, 100);

  try {
    markRunning();
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        patientId: form.patient.value,
        medicationId: form.medication.value,
        wellnessText: form["wellness-text"].value
      })
    });
    const payload = await response.json();

    clearInterval(timer);
    activeSessionId = payload.session.id;
    sessionId.textContent = activeSessionId;
    renderInvestigators(payload.investigators);
    correlate(payload.correlation);
  } catch (error) {
    clearInterval(timer);
    riskTitle.textContent = "Server error";
    riskNarrative.textContent = error.message;
  }
});

actionButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const response = await fetch("/api/escalations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: activeSessionId,
        action: button.dataset.action
      })
    });
    const payload = await response.json();
    audits = payload.records.length;
    auditCount.textContent = `${audits} record${audits === 1 ? "" : "s"}`;
    const item = document.createElement("li");
    item.textContent = `${new Date(payload.record.created_at).toLocaleTimeString()} ${payload.record.result}`;
    auditLog.prepend(item);
  });
});

function resetRun() {
  Object.values(cards).forEach((card) => {
    card.className = "agent-card";
    card.querySelector(".summary").textContent = "Queued by Orchestrator.";
    card.querySelector("dl").replaceChildren();
  });
  actionButtons.forEach((button) => {
    button.disabled = true;
  });
  setRisk(0);
  riskTitle.textContent = "Investigators running";
  riskNarrative.textContent = "The Orchestrator has started a parallel fan-out. Evidence will appear as each agent completes.";
}

function markRunning() {
  Object.values(cards).forEach((card) => {
    card.classList.add("running");
  });
}

function renderInvestigators(results) {
  results.forEach((result) => {
    const key = result.agent.split("-")[0];
    renderCard(cards[key], result);
  });
}

function renderCard(card, result) {
  card.className = `agent-card complete ${result.severity}`;
  card.querySelector(".summary").textContent = result.summary;

  const details = card.querySelector("dl");
  details.replaceChildren();
  result.evidence.forEach(({ label, value }) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    details.append(dt, dd);
  });
}

function correlate(correlation) {
  setRisk(correlation.risk_score);
  riskTitle.textContent = correlation.title;
  riskNarrative.textContent = correlation.narrative;

  actionButtons.forEach((button) => {
    button.disabled = false;
  });
}

function setRisk(value) {
  const circumference = 301.59;
  const offset = circumference - (circumference * value) / 100;
  riskScore.textContent = value;
  riskRing.style.strokeDashoffset = offset;
  riskRing.style.stroke = value >= 70 ? "var(--red)" : value >= 35 ? "var(--amber)" : "var(--green)";
}
