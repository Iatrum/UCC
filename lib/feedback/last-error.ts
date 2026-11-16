// Client-side ring of the most recent uncaught error, so a bug report can include it.
// Only the message + short stack is kept in memory; it is scrubbed server-side before storage.
let last = "";

export function recordError(value: unknown) {
  if (value instanceof Error) last = `${value.name}: ${value.message}\n${value.stack ?? ""}`.slice(0, 1500);
  else if (typeof value === "string") last = value.slice(0, 1500);
}
export const getLastError = () => last;

export function installErrorCapture(target: Window = window): () => void {
  const onError = (e: ErrorEvent) => recordError(e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => recordError(e.reason);
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
