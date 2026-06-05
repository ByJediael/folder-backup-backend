const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const EVENTS_FILE = path.join(DATA_DIR, "events.jsonl");
const MAX_LINES = Number(process.env.EVENTS_MAX_LINES || 500);

function appendEvent(entry) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const line = JSON.stringify({
    at: new Date().toISOString(),
    ...entry,
  });
  fs.appendFileSync(EVENTS_FILE, line + "\n", "utf8");
  trimEventsFile();
}

function trimEventsFile() {
  if (!fs.existsSync(EVENTS_FILE)) return;
  const lines = fs.readFileSync(EVENTS_FILE, "utf8").trim().split("\n").filter(Boolean);
  if (lines.length <= MAX_LINES) return;
  const kept = lines.slice(-MAX_LINES);
  fs.writeFileSync(EVENTS_FILE, kept.join("\n") + "\n", "utf8");
}

function readEvents({ limit = 50, slot_id, device_id } = {}) {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  const lines = fs.readFileSync(EVENTS_FILE, "utf8").trim().split("\n").filter(Boolean);
  let events = lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (slot_id) {
    events = events.filter((e) => e.slot_id === slot_id);
  }
  if (device_id) {
    events = events.filter((e) => e.device_id === device_id);
  }

  return events.slice(-limit).reverse();
}

module.exports = { appendEvent, readEvents };
