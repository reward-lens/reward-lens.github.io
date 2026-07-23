// Re-check the committed data invariants without the campaign store.
// build_data.py performs the deep cross-checks against the evidence store on
// the box that has it; this check runs everywhere (CI included) and fails the
// build if the committed projections ever drift from the scored-ledger totals.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures += 1;
  }
};

const ledger = read("src/data/ledger.json");
check(ledger.length === 53, `ledger rows ${ledger.length} != 53`);
const counts = { confirmed: 0, refuted: 0, inconclusive: 0 };
for (const row of ledger) counts[row.outcome] += 1;
check(counts.confirmed === 16, `confirmed ${counts.confirmed} != 16`);
check(counts.refuted === 21, `refuted ${counts.refuted} != 21`);
check(counts.inconclusive === 16, `inconclusive ${counts.inconclusive} != 16`);
const kills = new Set(ledger.map((r) => r.kill_id).filter(Boolean));
const expectedKills = [
  "K-err",
  "K-verif",
  "K-forensic",
  "K-vce",
  "K-kui",
  "K-transfer",
  "K-avp",
  "K-meta",
];
check(
  kills.size === 8 && expectedKills.every((k) => kills.has(k)),
  `kill ids ${[...kills].sort()} != expected 8`,
);

const cards = read("src/data/cards.json");
check(cards.length === 27, `cards ${cards.length} != 27`);
const verdicts = { confirmed: 0, refuted: 0, mixed: 0, inconclusive: 0 };
for (const c of cards) verdicts[c.verdict] += 1;
check(verdicts.confirmed === 4, `card confirmed ${verdicts.confirmed} != 4`);
check(verdicts.refuted === 8, `card refuted ${verdicts.refuted} != 8`);
check(verdicts.mixed === 7, `card mixed ${verdicts.mixed} != 7`);
check(
  verdicts.inconclusive === 8,
  `card inconclusive ${verdicts.inconclusive} != 8`,
);
const powered = cards.filter((c) => c.power_acceptance);
check(powered.length === 8, `power acceptances ${powered.length} != 8`);

const theorems = read("src/data/theorems.json");
check(theorems.length === 14, `theorems ${theorems.length} != 14`);
const byId = Object.fromEntries(theorems.map((t) => [t.id, t]));
check(byId.T9?.status === "confirmed", "T9 must be confirmed");
check(byId.T13?.status === "refuted", "T13 must be refuted");
check(
  theorems.filter((t) => t.status === "open").length === 12,
  "twelve theorem rows must be open",
);

const summary = read("src/data/campaign.json");
check(
  Math.abs(summary.spend_usd - 17.725824562737877) < 1e-9,
  "spend total drifted",
);
check(summary.hypotheses.total === 53, "summary hypothesis total != 53");
check(summary.cards.total === 27, "summary card total != 27");

const fleet = read("src/data/fleet/index.json");
check(fleet.length === 10, `fleet ${fleet.length} != 10`);

const provenance = read("src/data/provenance.json");
check(
  provenance.files.length > 100,
  `provenance manifest covers ${provenance.files.length} files; expected 100+`,
);

if (failures > 0) {
  console.error(`data_assertions: ${failures} failure(s)`);
  process.exit(1);
}
console.log("data_assertions: all committed data invariants hold");
