const fs = require("fs");
const path = require("path");

function createDoseLogStore(filePath) {
  function ensureFile() {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `${JSON.stringify({ updated_at: new Date().toISOString(), patients: {} }, null, 2)}\n`);
    }
  }

  function read() {
    ensureFile();
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  function write(db) {
    ensureFile();
    db.updated_at = new Date().toISOString();
    fs.writeFileSync(filePath, `${JSON.stringify(db, null, 2)}\n`);
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function seedFromSchedule(patient) {
    const db = read();
    const day = todayKey();
    if (!db.patients[patient.id]) db.patients[patient.id] = { days: {} };
    if (!db.patients[patient.id].days[day]) {
      db.patients[patient.id].days[day] = {
        date: day,
        doses: (patient.schedule || []).map((item, index) => ({
          id: `${patient.id}-${day}-${item.medicationId}-${item.time}-${index}`,
          time: item.time,
          medication_id: item.medicationId,
          medication: item.medication,
          criticality: item.criticality || "important",
          status: item.status === "taken" ? "taken" : item.status === "upcoming" ? "upcoming" : "due",
          source: "chart",
          updated_at: new Date().toISOString(),
          note: null,
          session_id: null
        }))
      };
      write(db);
    }
    return db.patients[patient.id].days[day];
  }

  function getDay(patientId, day = todayKey()) {
    const db = read();
    return db.patients[patientId]?.days?.[day] || { date: day, doses: [] };
  }

  function listRecent(patientId, limit = 14) {
    const db = read();
    const days = Object.values(db.patients[patientId]?.days || {}).sort((a, b) => (a.date < b.date ? 1 : -1));
    return days.slice(0, limit);
  }

  function recordDose({ patientId, medicationId, status, source = "pipeline", note = null, sessionId = null, time = null }) {
    const db = read();
    const day = todayKey();
    if (!db.patients[patientId]) db.patients[patientId] = { days: {} };
    if (!db.patients[patientId].days[day]) {
      db.patients[patientId].days[day] = { date: day, doses: [] };
    }
    const dayEntry = db.patients[patientId].days[day];
    let dose = dayEntry.doses.find(
      (item) =>
        item.medication_id === medicationId &&
        (time ? item.time === time : item.status === "due" || item.status === "missed" || item.status === "unknown")
    );
    if (!dose) {
      dose = dayEntry.doses.find((item) => item.medication_id === medicationId);
    }
    if (!dose) {
      dose = {
        id: `${patientId}-${day}-${medicationId}-${Date.now()}`,
        time: time || "—",
        medication_id: medicationId,
        medication: medicationId,
        criticality: "important",
        status: "due",
        source: "chart",
        updated_at: new Date().toISOString(),
        note: null,
        session_id: null
      };
      dayEntry.doses.push(dose);
    }
    dose.status = status;
    dose.source = source;
    dose.note = note;
    dose.session_id = sessionId;
    dose.updated_at = new Date().toISOString();
    write(db);
    return dose;
  }

  function markMissedDue(patientId, { source = "pipeline", sessionId = null, note = null } = {}) {
    const day = getDay(patientId);
    const updated = [];
    for (const dose of day.doses) {
      if (dose.status === "due" || dose.status === "unknown") {
        updated.push(
          recordDose({
            patientId,
            medicationId: dose.medication_id,
            time: dose.time,
            status: "missed",
            source,
            sessionId,
            note
          })
        );
      }
    }
    return updated;
  }

  return {
    todayKey,
    seedFromSchedule,
    getDay,
    listRecent,
    recordDose,
    markMissedDue
  };
}

module.exports = { createDoseLogStore };
