// Batch-runs the AI agent chat (Sophie & co.) against a REAL, running
// instance of the app — not a mock — so it exercises the actual Gemini
// model, the actual system prompt, actual tool-calling, and the actual
// database constraints. That last part matters: the contacts NOT NULL bug
// and the Ragic DNS bug both only showed up against the real stack, never
// against an in-memory fake with no schema. The trade-off is cost (real
// Gemini tokens per scenario) and needing a real session token.
//
// Usage:
//   EVAL_AUTH_TOKEN=<jwt> EVAL_AGENT_ID=<agent-uuid> npx tsx scripts/eval-agents.ts
//   (or: npm run eval:agents, with the same env vars set)
//
// Env vars:
//   EVAL_BASE_URL     Base URL of the running server (default http://localhost:3000)
//   EVAL_AUTH_TOKEN   Bearer token for a logged-in user on an Enterprise-plan
//                     tenant — REQUIRED. Grab it from the browser devtools'
//                     Network tab on any /api/* request while logged in
//                     (ideally a dedicated test account, not a real client's).
//   EVAL_AGENT_ID     id of the agent to test (e.g. Sophie's row id in the
//                     `agents` table) — REQUIRED.
//   EVAL_DELAY_MS     Delay between scenarios in ms, default 1500 — keeps
//                     this gentle on Gemini rate limits and AI credit spend.
//
// Each scenario runs in its own freshly-reset conversation (see
// resetConversation() below) so one scenario's topic never leaks into the
// next. Add new scenarios in scripts/eval-agents-scenarios.ts — this file
// only contains the runner, not the test cases themselves.
//
// This checks structural/behavioral invariants (empty replies, leaked
// backend errors, stale dates, claimed-but-unexecuted actions) — it does
// NOT judge reply quality or helpfulness. Read the full replies in the
// JSON report for anything a deterministic check can't catch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarios, type Scenario } from './eval-agents-scenarios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.EVAL_BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = process.env.EVAL_AUTH_TOKEN;
const AGENT_ID = process.env.EVAL_AGENT_ID;
const DELAY_MS = Number(process.env.EVAL_DELAY_MS || 1500);

if (!AUTH_TOKEN || !AGENT_ID) {
  console.error(
    'EVAL_AUTH_TOKEN et EVAL_AGENT_ID sont requis (voir le commentaire en tête de scripts/eval-agents.ts).'
  );
  process.exit(1);
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${AUTH_TOKEN}`, 'Content-Type': 'application/json' };
}

async function resetConversation(): Promise<void> {
  await fetch(`${BASE_URL}/api/agents/${AGENT_ID}/conversation`, {
    method: 'DELETE',
    headers: authHeaders(),
  }).catch(() => {
    // Best-effort — an eval run should still proceed even if the reset
    // itself fails (e.g. no prior conversation to delete).
  });
}

interface ChatResult {
  reply: string;
  httpStatus: number;
  errorBody?: unknown;
}

async function sendMessage(message: string): Promise<ChatResult> {
  const res = await fetch(`${BASE_URL}/api/agents/${AGENT_ID}/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ message }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) return { reply: '', httpStatus: res.status, errorBody: body };
  return { reply: body.reply ?? '', httpStatus: res.status };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface ScenarioReport {
  scenario: string;
  note: string;
  message: string;
  passed: boolean;
  failures: string[];
  reply: string;
  httpStatus: number;
}

async function runScenario(scenario: Scenario): Promise<ScenarioReport> {
  await resetConversation();
  const result = await sendMessage(scenario.message);

  if (result.httpStatus !== 200) {
    return {
      scenario: scenario.name,
      note: scenario.note,
      message: scenario.message,
      passed: false,
      failures: [`HTTP ${result.httpStatus} : ${JSON.stringify(result.errorBody)}`],
      reply: '',
      httpStatus: result.httpStatus,
    };
  }

  const failures = scenario.checks
    .map(check => check.run(result.reply))
    .filter((f): f is string => f !== null);

  return {
    scenario: scenario.name,
    note: scenario.note,
    message: scenario.message,
    passed: failures.length === 0,
    failures,
    reply: result.reply,
    httpStatus: result.httpStatus,
  };
}

async function main(): Promise<void> {
  console.log(`Exécution de ${scenarios.length} scénario(s) contre ${BASE_URL} (agent ${AGENT_ID})...\n`);
  const reports: ScenarioReport[] = [];

  for (const scenario of scenarios) {
    process.stdout.write(`→ ${scenario.name}... `);
    const report = await runScenario(scenario);
    reports.push(report);
    console.log(report.passed ? 'OK' : 'ÉCHEC');
    if (!report.passed) {
      for (const f of report.failures) console.log(`    - ${f}`);
      console.log(`    Réponse reçue : ${JSON.stringify(report.reply).slice(0, 400)}`);
    }
    await sleep(DELAY_MS);
  }

  const failed = reports.filter(r => !r.passed);
  console.log(`\n${reports.length - failed.length}/${reports.length} scénarios passent.`);

  const reportsDir = path.join(__dirname, 'eval-agents-reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const outPath = path.join(reportsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(reports, null, 2));
  console.log(`Rapport détaillé : ${outPath}`);

  if (failed.length > 0) process.exitCode = 1;
}

main();
