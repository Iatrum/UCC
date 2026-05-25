"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createMedication } from "@/lib/inventory";
import { MEDICATION_CATEGORIES } from "@/lib/constants";

// ── CSV template ─────────────────────────────────────────────────────────────

const CSV_TEMPLATE =
  "name,category,dosageForm,stock,minimumStock,unitPrice,expiryDate,unit\n" +
  "Paracetamol 500mg,analgesics,Tablet,100,20,0.50,2027-12-31,units";

const VALID_CATEGORIES = new Set(MEDICATION_CATEGORIES.map((c) => c.toLowerCase()));

// ── Types ────────────────────────────────────────────────────────────────────

type ImportStep = "upload" | "preview" | "importing";
type RowStatus = "ready" | "warning" | "error";

interface ParsedRow {
  rowNum: number;
  raw: Record<string, string>;
  name: string;
  category: string;
  dosageForm: string;
  stock: number;
  minimumStock: number;
  unitPrice: number;
  expiryDate: string;
  unit: string;
  status: RowStatus;
  errors: string[];
  warnings: string[];
}

// ── CSV parser ───────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(raw: string): ParsedRow[] {
  // Strip UTF-8 BOM that Excel sometimes adds
  const text = raw.startsWith("﻿") ? raw.slice(1) : raw;
  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length < 2) return [];

  const headers = parseCSVLine(nonEmpty[0]).map((h) => h.toLowerCase().trim());
  const rows: ParsedRow[] = [];

  for (let i = 1; i < nonEmpty.length; i++) {
    const cells = parseCSVLine(nonEmpty[i]);
    if (cells.every((c) => !c)) continue; // skip blank rows

    const rawMap: Record<string, string> = {};
    headers.forEach((header, idx) => {
      rawMap[header] = (cells[idx] ?? "").trim();
    });

    const errors: string[] = [];
    const warnings: string[] = [];

    // name — required
    const name = (rawMap.name ?? "").trim();
    if (!name) errors.push("Name is required");

    // category — any string; warn if unrecognised
    const category = (rawMap.category ?? "").trim().toLowerCase();
    if (category && !VALID_CATEGORIES.has(category)) {
      warnings.push(`Category "${rawMap.category}" is not in the standard list`);
    }

    // stock — integer >= 0, default 0
    let stock = 0;
    const rawStock = rawMap.stock ?? "";
    if (rawStock !== "") {
      const parsed = parseInt(rawStock, 10);
      if (isNaN(parsed) || parsed < 0) {
        errors.push("Stock must be a whole number ≥ 0");
      } else {
        stock = parsed;
      }
    }

    // minimumStock — integer >= 0, default 0
    let minimumStock = 0;
    const rawMin = rawMap.minimumstock ?? "";
    if (rawMin !== "") {
      const parsed = parseInt(rawMin, 10);
      if (isNaN(parsed) || parsed < 0) {
        errors.push("Minimum stock must be a whole number ≥ 0");
      } else {
        minimumStock = parsed;
      }
    }

    // unitPrice — float >= 0, default 0
    let unitPrice = 0;
    const rawPrice = rawMap.unitprice ?? "";
    if (rawPrice !== "") {
      const parsed = parseFloat(rawPrice);
      if (isNaN(parsed) || parsed < 0) {
        errors.push("Unit price must be a number ≥ 0");
      } else {
        unitPrice = parsed;
      }
    }

    // expiryDate — optional, must be YYYY-MM-DD if present
    const expiryDate = (rawMap.expirydate ?? "").trim();
    if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
      errors.push("Expiry date must be in YYYY-MM-DD format");
    }

    const dosageForm = (rawMap.dosageform ?? "").trim();
    const unit = (rawMap.unit ?? "").trim() || "units";

    const status: RowStatus =
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "ready";

    rows.push({
      rowNum: i + 1,
      raw: rawMap,
      name,
      category,
      dosageForm,
      stock,
      minimumStock,
      unitPrice,
      expiryDate,
      unit,
      status,
      errors,
      warnings,
    });
  }

  return rows;
}

// ── Import runner ─────────────────────────────────────────────────────────────

async function runImport(
  rows: ParsedRow[],
  onProgress: (done: number) => void
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  let done = 0;
  const BATCH = 3;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((row) =>
        createMedication({
          name: row.name,
          category: row.category,
          dosageForm: row.dosageForm,
          stock: row.stock,
          minimumStock: row.minimumStock,
          unitPrice: row.unitPrice,
          expiryDate: row.expiryDate,
          unit: row.unit,
          strengths: [],
        })
      )
    );
    for (const r of results) {
      if (r.status === "fulfilled") success++;
      else failed++;
      done++;
      onProgress(done);
    }
  }

  return { success, failed };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface BatchImportDialogProps {
  onImportComplete: () => void;
}

export function BatchImportDialog({ onImportComplete }: BatchImportDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<ImportStep>("upload");
  const [parsedRows, setParsedRows] = React.useState<ParsedRow[]>([]);
  const [importProgress, setImportProgress] = React.useState(0);
  const [importTotal, setImportTotal] = React.useState(0);
  const [importResult, setImportResult] = React.useState<{ success: number; failed: number } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setStep("upload");
    setParsedRows([]);
    setImportProgress(0);
    setImportTotal(0);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    setOpen(next);
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "medication-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setParsedRows(parseCSV(text));
      setStep("preview");
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    const importable = parsedRows.filter((r) => r.status !== "error");
    setImportTotal(importable.length);
    setImportProgress(0);
    setStep("importing");
    const result = await runImport(importable, (done) => setImportProgress(done));
    setImportResult(result);
  }

  function handleDone() {
    setOpen(false);
    reset();
    onImportComplete();
  }

  const readyRows = parsedRows.filter((r) => r.status === "ready");
  const warningRows = parsedRows.filter((r) => r.status === "warning");
  const errorRows = parsedRows.filter((r) => r.status === "error");
  const importableCount = readyRows.length + warningRows.length;
  const progressPct = importTotal > 0 ? Math.round((importProgress / importTotal) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Import CSV
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Import medications from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import multiple medications at once.
          </DialogDescription>
        </DialogHeader>

        {/* ── Step A: Upload ── */}
        {step === "upload" && (
          <div className="space-y-6 py-2">
            <div className="space-y-4 rounded-lg border border-dashed p-8 text-center">
              <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Select a CSV file to upload</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Required headers: name, category, dosageForm, stock, minimumStock, unitPrice, expiryDate, unit
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <p className="text-sm text-muted-foreground">
              Need a template?{" "}
              <button
                type="button"
                onClick={downloadTemplate}
                className="text-primary underline hover:no-underline"
              >
                Download sample CSV
              </button>
            </p>
          </div>
        )}

        {/* ── Step B: Preview ── */}
        {step === "preview" && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            {/* Summary bar */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{parsedRows.length} rows parsed</span>
              {readyRows.length > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-emerald-700">{readyRows.length} ready</span>
                </>
              )}
              {warningRows.length > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-amber-600">{warningRows.length} warnings</span>
                </>
              )}
              {errorRows.length > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-rose-600">{errorRows.length} errors (will be skipped)</span>
                </>
              )}
            </div>

            {/* Preview table */}
            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Category</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Form</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Stock</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Min</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Price</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Expiry</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row) => (
                    <tr key={row.rowNum} className="border-t">
                      <td className="px-3 py-2 text-muted-foreground">{row.rowNum}</td>
                      <td className="px-3 py-2 font-medium">
                        {row.name || <span className="italic text-rose-500">empty</span>}
                      </td>
                      <td className="px-3 py-2">{row.raw.category || "—"}</td>
                      <td className="px-3 py-2">{row.dosageForm || "—"}</td>
                      <td className="px-3 py-2">{row.raw.stock || "0"}</td>
                      <td className="px-3 py-2">{row.raw.minimumstock || "0"}</td>
                      <td className="px-3 py-2">{row.raw.unitprice || "0"}</td>
                      <td className="px-3 py-2">{row.expiryDate || "—"}</td>
                      <td className="px-3 py-2">
                        {row.status === "ready" && (
                          <Badge
                            variant="secondary"
                            className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                          >
                            Ready
                          </Badge>
                        )}
                        {row.status === "warning" && (
                          <Badge
                            variant="secondary"
                            className="bg-amber-100 text-amber-700 hover:bg-amber-100"
                            title={row.warnings.join("; ")}
                          >
                            Warning
                          </Badge>
                        )}
                        {row.status === "error" && (
                          <Badge
                            variant="secondary"
                            className="bg-rose-100 text-rose-700 hover:bg-rose-100"
                            title={row.errors.join("; ")}
                          >
                            Error
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                  {parsedRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                        No rows found in the file.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setParsedRows([]);
                  setStep("upload");
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={importableCount === 0}
                onClick={handleImport}
              >
                Import {importableCount} {importableCount === 1 ? "row" : "rows"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step C: Importing ── */}
        {step === "importing" && (
          <div className="flex flex-col items-center gap-6 py-10 text-center">
            {importResult ? (
              <>
                <div className="space-y-1">
                  <p className="text-base font-semibold">Import complete</p>
                  <p className="text-sm text-muted-foreground">
                    Successfully imported {importResult.success}{" "}
                    {importResult.success === 1 ? "medication" : "medications"}.
                    {importResult.failed > 0 && ` ${importResult.failed} failed.`}
                  </p>
                </div>
                <Button type="button" onClick={handleDone}>
                  Done
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Importing {importProgress} of {importTotal}…
                </p>
                <div className="w-full max-w-xs overflow-hidden rounded-full bg-muted" style={{ height: 8 }}>
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{progressPct}%</p>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
