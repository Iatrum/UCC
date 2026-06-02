#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

const protectedPrefixes = [
  "app/(routes)",
  "app/api",
  "modules",
];

const allowedPatterns = [
  /^app\/api\/admin\//,
  /^app\/api\/export-to-medplum\//,
  /^app\/api\/follow-up\/twilio\//,
  /^app\/\(routes\)\/api\/labs\/receive\//,
  /^app\/\(routes\)\/api\/imaging\/receive\//,
  /^app\/\(routes\)\/api\/imaging\/report\//,
];

function listFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(path);
    }
    return entry.isFile() ? [relative(root, path)] : [];
  });
}

const files = ["app", "modules"]
  .flatMap((dir) => listFiles(join(root, dir)))
  .filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file))
  .filter((file) => protectedPrefixes.some((prefix) => file.startsWith(prefix)))
  .filter((file) => !allowedPatterns.some((pattern) => pattern.test(file)));

const violations = [];
for (const file of files) {
  const contents = readFileSync(file, "utf8");
  if (
    /from ['"]@\/lib\/server\/medplum-admin['"]/.test(contents) ||
    /from ['"]@\/lib\/server\/medplum-auth['"][\s\S]*getAdminMedplum/.test(contents) ||
    /\bgetAdminMedplum\s*\(/.test(contents)
  ) {
    violations.push(relative(root, file));
  }
}

if (violations.length > 0) {
  console.error("Clinic-facing code must not use getAdminMedplum():");
  for (const file of violations) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}
