# Task 6c research: POST /api/inventory without strengths -> 500
## Code facts (read 2026-10-31)
- `app/api/inventory/route.ts` POST only checks `name`, then `createInventoryMedicationInMedplum(medplum, data, clinicId)`.
- `lib/fhir/inventory-service.ts toInventoryExtension`: `data.strengths.map(...)` -> TypeError when strengths missing -> 500. Also writes `{url:'stock', valueInteger: undefined}` etc. when numeric fields are missing: a FHIR extension must have a value[x] or child extensions (ext-1), so Medplum can reject it.
- UI forms always send `strengths: []`; batch import too. So only API callers hit this.
## Standards
- FHIR R4 Extension invariant ext-1: "Must have either extensions or value[x], not both". https://hl7.org/fhir/R4/extensibility.html#Extension
- valueInteger must be a 32-bit integer; valueDecimal a number. https://hl7.org/fhir/R4/datatypes.html
- OWASP API: validate input and answer 4xx, never 500, for bad client input. https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/
## Plan (builder Claude Sonnet, reviewer Codex low)
1. Route POST: 400 if `strengths` is present and not an array of strings; 400 if stock/minimumStock present and not a non-negative integer; 400 if unitPrice present and not a non-negative finite number. Missing `strengths` -> [].
2. `toInventoryExtension`: skip extension entries whose value is undefined/empty (no value-less extensions); `strengths ?? []`.
3. No UI change, no PATCH behaviour change except the same skip in the shared helper. No new deps.
Accept: e2e "inventory: validation returns 4xx not 500" passes; "inventory: create / update stock / delete" still passes.
