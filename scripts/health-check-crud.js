#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = process.cwd();

const crudChecks = [
  {
    name: 'phase1-clinical-crud',
    script: 'tests/health/phase1-clinical-crud.js',
    env: {
      PHASE1_SKIP_LOGIN: '1',
      PHASE1_SKIP_FINAL_PAGES: '1',
    },
  },
  {
    name: 'phase2-app-crud',
    script: 'tests/health/phase2-app-crud.js',
    env: {},
  },
];

const suites = {
  all: crudChecks,
  phase1: crudChecks.filter((check) => check.name === 'phase1-clinical-crud'),
  phase2: crudChecks.filter((check) => check.name === 'phase2-app-crud'),
};

function selectedChecks() {
  const suiteName = process.argv[2] || 'all';
  const checks = suites[suiteName];
  if (!checks) {
    const valid = Object.keys(suites).join(', ');
    throw new Error(`Unknown health check suite '${suiteName}'. Valid suites: ${valid}`);
  }
  return { suiteName, checks };
}

function nowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return 'n/a';
  if (ms < 1_000) return `${ms}ms`;
  const seconds = Math.round(ms / 1_000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function statusLabel(ok, skipped = false) {
  if (skipped) return 'SKIPPED';
  return ok ? 'PASSED' : 'FAILED';
}

function escapeMarkdown(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
}

function parseLastJsonObject(output) {
  const trimmed = output.trim();
  for (let index = trimmed.lastIndexOf('{'); index >= 0; index = trimmed.lastIndexOf('{', index - 1)) {
    try {
      return JSON.parse(trimmed.slice(index));
    } catch {
      // Keep scanning backward until we find the root of the final JSON block.
    }
  }
  return null;
}

function localNodeExecutable() {
  const candidates = [
    process.env.npm_node_execpath,
    path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'node.cmd' : 'node'),
    'node',
    process.execPath,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'node') return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }

  return 'node';
}

function runCheck(nodeExecutable, check) {
  const startedAt = nowMs();
  const scriptPath = path.join(root, check.script);
  let stdout = '';
  let stderr = '';

  return new Promise((resolve) => {
    if (!fs.existsSync(scriptPath)) {
      resolve({
        name: check.name,
        script: check.script,
        ok: false,
        durationMs: nowMs() - startedAt,
        error: 'Script not found',
      });
      return;
    }

    const child = spawn(nodeExecutable, [scriptPath], {
      cwd: root,
      env: {
        ...process.env,
        ...check.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      process.stderr.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });

    child.on('error', (error) => {
      resolve({
        name: check.name,
        script: check.script,
        ok: false,
        durationMs: nowMs() - startedAt,
        error: error.message,
      });
    });

    child.on('close', (exitCode, signal) => {
      resolve({
        name: check.name,
        script: check.script,
        ok: exitCode === 0,
        durationMs: nowMs() - startedAt,
        exitCode,
        signal,
        report: parseLastJsonObject(stdout),
        stderr: stderr.trim() || undefined,
      });
    });
  });
}

const phase1Sections = [
  {
    name: 'Auth Reuse',
    steps: ['auth-reuse'],
  },
  {
    name: 'Registration',
    steps: ['patient-create', 'patient-read', 'patient-update'],
  },
  {
    name: 'Check-in',
    steps: ['check-in'],
  },
  {
    name: 'Triage',
    steps: ['triage-update', 'triage-read'],
  },
  {
    name: 'Consultation',
    steps: ['consultation-sign', 'consultation-update'],
  },
  {
    name: 'Medication, MC, Reorder',
    steps: ['order-medication-and-mc', 'consultation-read-after-order-1', 'second-medication-reorder', 'final-consultation-read'],
  },
];

const phase2Sections = [
  {
    name: 'Auth & Support',
    steps: ['auth', 'support-read-operational-routes'],
  },
  {
    name: 'Patient Operations',
    steps: ['patient-create', 'patient-intake-pilot-create', 'queue-crud', 'triage-crud'],
  },
  {
    name: 'Clinical Operations',
    steps: ['consultation-crud-read-update', 'document-crud', 'referral-crud', 'follow-up-crud', 'orders-get-patch-delete'],
  },
  {
    name: 'Business Operations',
    steps: ['billing-crud', 'appointment-crud', 'scheduling-crud'],
  },
  {
    name: 'Settings & Catalogs',
    steps: [
      'inventory-crud',
      'catalog-crud',
      'procedure-crud',
      'settings-insurer-crud',
      'settings-follow-up-put',
      'document-template-crud',
      'organization-put-same-values',
      'storage-logo-post',
    ],
  },
];

function reportSteps(result) {
  const report = result.report?.report;
  return Array.isArray(report) ? report : [];
}

function summarizeSection(steps, section) {
  const found = section.steps.filter((step) => steps.some((item) => item.step === step));
  const missing = section.steps.filter((step) => !found.includes(step));
  const failed = section.steps.filter((step) => {
    const item = steps.find((entry) => entry.step === step);
    return item?.ok === false || item?.status >= 400;
  });

  return {
    section: section.name,
    status: statusLabel(missing.length === 0 && failed.length === 0),
    evidence: found.join(', ') || 'none',
    notes: [...failed.map((step) => `failed: ${step}`), ...missing.map((step) => `missing: ${step}`)].join('; '),
  };
}

function skippedSections(results) {
  return results.flatMap((result) => reportSteps(result)
    .filter((item) => item.step && item.step.endsWith('-skipped') && item.step !== 'auth-dashboard-skipped')
    .map((item) => ({
      phase: result.name === 'phase1-clinical-crud' ? 'Phase 1' : 'Phase 2',
      section: item.step,
      reason: item.reason || 'No reason provided',
    })));
}

function failedChecks(summary) {
  return summary.checks.filter((check) => !check.ok).map((check) => ({
    name: check.name,
    reason: check.error || check.signal || `exit code ${check.exitCode}`,
  }));
}

function markdownTable(rows) {
  const lines = [
    '| Section | Status | Evidence | Notes |',
    '| --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    lines.push(`| ${escapeMarkdown(row.section)} | ${row.status} | ${escapeMarkdown(row.evidence)} | ${escapeMarkdown(row.notes || '-')} |`);
  }

  return lines.join('\n');
}

function buildMarkdown(summary) {
  const phase1 = summary.checks.find((check) => check.name === 'phase1-clinical-crud');
  const phase2 = summary.checks.find((check) => check.name === 'phase2-app-crud');
  const phase1Rows = phase1 ? phase1Sections.map((section) => summarizeSection(reportSteps(phase1), section)) : [];
  const phase2Rows = phase2 ? phase2Sections.map((section) => summarizeSection(reportSteps(phase2), section)) : [];
  const skipped = skippedSections(summary.checks);
  const failures = failedChecks(summary);

  const lines = [
    '# CRUD Health Check',
    '',
    `**Overall:** ${statusLabel(summary.ok)}`,
    `**Suite:** ${summary.suite}`,
    `**Duration:** ${formatDuration(summary.durations.totalMs)}`,
    '',
  ];

  if (phase1) {
    lines.push('## Phase 1 - Clinical Workflow', '', markdownTable(phase1Rows), '');
  }

  if (phase2) {
    lines.push('## Phase 2 - App CRUD', '', markdownTable(phase2Rows), '');
  }

  lines.push('## Skipped Sections', '');

  if (skipped.length === 0) {
    lines.push('None');
  } else {
    lines.push('| Phase | Section | Reason |');
    lines.push('| --- | --- | --- |');
    for (const item of skipped) {
      lines.push(`| ${escapeMarkdown(item.phase)} | ${escapeMarkdown(item.section)} | ${escapeMarkdown(item.reason)} |`);
    }
  }

  lines.push('', '## Failed Checks', '');
  if (failures.length === 0) {
    lines.push('None');
  } else {
    lines.push('| Check | Reason |');
    lines.push('| --- | --- |');
    for (const failure of failures) {
      lines.push(`| ${escapeMarkdown(failure.name)} | ${escapeMarkdown(failure.reason)} |`);
    }
  }

  lines.push('', '## Durations', '');
  lines.push('| Check | Duration | Exit |');
  lines.push('| --- | --- | --- |');
  for (const check of summary.checks) {
    lines.push(`| ${escapeMarkdown(check.name)} | ${formatDuration(check.durationMs)} | ${check.exitCode ?? 'n/a'} |`);
  }

  return lines.join('\n');
}

async function main() {
  const startedAt = nowMs();
  const nodeExecutable = localNodeExecutable();
  const { suiteName, checks } = selectedChecks();
  const results = [];

  for (const check of checks) {
    const result = await runCheck(nodeExecutable, check);
    results.push(result);

    if (!result.ok) break;
  }

  const summary = {
    ok: results.every((result) => result.ok) && results.length === checks.length,
    suite: suiteName,
    checks: results,
    durations: {
      totalMs: nowMs() - startedAt,
      byCheckMs: Object.fromEntries(results.map((result) => [result.name, result.durationMs])),
    },
  };

  process.stdout.write(`${buildMarkdown(summary)}\n\n`);
  process.stdout.write('## JSON Summary\n\n');
  process.stdout.write('```json\n');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write('```\n');

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    checks: [],
    durations: { totalMs: 0, byCheckMs: {} },
    error: error.message,
  }, null, 2));
  process.stdout.write('\n');
  process.exitCode = 1;
});
