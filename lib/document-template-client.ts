import type { DocumentKind } from "./document-render";
import { fetchWithTimeout } from "./fetch-with-timeout";

export async function fetchDocumentTemplate(kind: DocumentKind): Promise<string> {
  const response = await fetchWithTimeout(`/api/document-templates?type=${kind}`, {}, 15_000);
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Could not load the document template.");
  }

  const { html } = await response.json();
  return html;
}
