"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getLastError, installErrorCapture } from "@/lib/feedback/last-error";

type Kind = "bug" | "feature";
const MAX_SHOT = 1_000_000;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function FeedbackControl() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [shot, setShot] = useState<string>("");
  const [shotOk, setShotOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => installErrorCapture(), []);

  const reset = () => {
    setKind("bug"); setTitle(""); setDescription(""); setShot(""); setShotOk(false); setError(""); setDone("");
  };

  async function onFile(file?: File) {
    setError(""); setShot(""); setShotOk(false);
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > MAX_SHOT) {
      setError("Screenshot must be a PNG or JPEG under 1 MB.");
      return;
    }
    setShot(await readAsDataUrl(file));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, title, description,
          page: pathname,
          browser: {
            userAgent: navigator.userAgent,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            language: navigator.language,
          },
          lastError: getLastError(),
          screenshot: shot || undefined,
          screenshotNoPatientData: shot ? shotOk : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send feedback.");
      setDone(kind === "feature" ? "Thanks! Your request has been recorded." : "Thanks! Your bug report has been sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send feedback.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" data-testid="feedback-trigger">
          <MessageSquarePlus className="mr-1 h-4 w-4" /> Feedback
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="feedback-dialog">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Do not type patient names, IC numbers or clinical notes. Obvious identifiers are removed automatically.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <p role="status" data-testid="feedback-done" className="text-sm">{done}</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div role="group" aria-label="Feedback type" className="flex gap-2">
              {(["bug", "feature"] as const).map((k) => (
                <Button key={k} type="button" size="sm" variant={kind === k ? "default" : "outline"}
                  aria-pressed={kind === k} data-testid={`feedback-kind-${k}`} onClick={() => setKind(k)}>
                  {k === "bug" ? "Bug" : "Feature request"}
                </Button>
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="feedback-title">Title</Label>
              <Input id="feedback-title" value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="feedback-description">{kind === "bug" ? "What went wrong?" : "What would you like?"}</Label>
              <Textarea id="feedback-description" value={description} maxLength={2000} rows={4} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="feedback-screenshot">Screenshot (optional)</Label>
              <Input id="feedback-screenshot" type="file" accept="image/png,image/jpeg" onChange={(e) => onFile(e.target.files?.[0])} />
              {shot && (
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" data-testid="feedback-shot-confirm" checked={shotOk} onChange={(e) => setShotOk(e.target.checked)} />
                  <span>This screenshot shows no patient information. It is kept in your clinic record only and is not sent to GitHub.</span>
                </label>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Page, clinic, browser and the last error are attached automatically.
            </p>
            {error && <p role="alert" data-testid="feedback-error" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy || title.trim().length < 3 || (Boolean(shot) && !shotOk)} data-testid="feedback-submit">
              {busy ? "Sending…" : "Send"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
