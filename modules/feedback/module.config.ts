import type { ModuleDefinition } from "@/lib/module-registry";

// Toggle-only module (no nav entry, like time-chit): enables the Feedback control in the main chrome.
export default {
  id: "feedback",
  label: "Feedback (bug / feature request)",
  description: "Show a Feedback button so staff can report a bug or request a feature (PDPA-scrubbed).",
  routePath: "",
  pages: {},
} satisfies ModuleDefinition;
