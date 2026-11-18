/**
 * Print an HTML document through a hidden same-origin iframe (client only).
 *
 * Unlike `window.open(blob) + print()` this needs no pop-up permission and works
 * on phones/tablets; the browser's print dialog offers "Save as PDF". If the
 * iframe cannot print, fall back to opening the document in a new tab.
 */
export function printHtml(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  const cleanup = () => window.setTimeout(() => iframe.remove(), 60_000);
  iframe.onload = () => {
    const win = iframe.contentWindow;
    try {
      if (!win) throw new Error("no window");
      win.focus();
      win.print();
    } catch {
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      window.open(url, "_blank");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    cleanup();
  };
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}
