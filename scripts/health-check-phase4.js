#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = process.cwd();

const checks = [
  {
    name: 'phase4-apex-admin',
    script: 'tests/health/phase4-apex-admin.js',
    env: {},
  },
];

function nowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function localNodeExecutable() {
  const candidates = [
    process.env.npm_node_execpath,
    process.execPath,
    'node',
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

    child.stdout.on('data', (chunk) => process.stderr.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));

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
      });
    });
  });
}

async function main() {
  const startedAt = nowMs();
  const nodeExecutable = localNodeExecutable();
  const results = [];

  for (const check of checks) {
    const result = await runCheck(nodeExecutable, check);
    results.push(result);
    if (!result.ok) break;
  }

  const summary = {
    ok: results.every((result) => result.ok) && results.length === checks.length,
    checks: results,
    durations: {
      totalMs: nowMs() - startedAt,
      byCheckMs: Object.fromEntries(results.map((result) => [result.name, result.durationMs])),
    },
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) process.exitCode = 1;
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
