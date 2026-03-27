# Medplum Self-Hosted Details

## Endpoints

- API: `https://fhir.drhidayat.com`
- UI: `https://app.31-97-70-30.sslip.io/signin`

## Project

- Project name: `UCC Production`
- Project ID: `4988db2b-cee0-4fef-a399-b7e1e2cf138a`

## Client Application

- Client name: `UCC App Client`
- Client ID: `68a93110-dc4c-4481-83cc-272c27167c32`
- Client Secret: `1965b48ff0e073d277b93f09f03d6706cc3e3f2be61bc1027fcf3fdd2f0baa19`

## UI Login

- Email: `support@drhidayat.com`
- Password: `UccMedplum!2026#`

## Vercel Environment Values

```env
MEDPLUM_BASE_URL=https://fhir.drhidayat.com
NEXT_PUBLIC_MEDPLUM_BASE_URL=https://fhir.drhidayat.com
NEXT_PUBLIC_MEDPLUM_PROJECT_ID=4988db2b-cee0-4fef-a399-b7e1e2cf138a
MEDPLUM_CLIENT_ID=68a93110-dc4c-4481-83cc-272c27167c32
NEXT_PUBLIC_MEDPLUM_CLIENT_ID=68a93110-dc4c-4481-83cc-272c27167c32
MEDPLUM_CLIENT_SECRET=1965b48ff0e073d277b93f09f03d6706cc3e3f2be61bc1027fcf3fdd2f0baa19
```

## Notes

- The temporary UI domain is `app.31-97-70-30.sslip.io`.
- Recommended final UI domain: `app.drhidayat.com`.
- Vercel env values were updated, but the frontend still needs a redeploy for them to take effect.

## Admin Seed Data

### Organizations

- `Apex Health Group`
  - Organization ID: `ad5e14c9-66d5-4a87-b12d-078aab95b604`
  - Subdomain: `apex-group`
- `Apex Health Group Branch 1`
  - Organization ID: `da490170-0711-475c-bd42-b66858dfb5bc`
  - Subdomain: `apex-group-branch-1`
  - Parent: `Apex Health Group`
- `Beacon Care Group`
  - Organization ID: `da957c9f-4978-42f4-99db-8e22eef98b4d`
  - Subdomain: `beacon-group`
- `Beacon Care Group Branch 1`
  - Organization ID: `e5a6329f-9bb1-4e0b-a9a5-8eec5b751368`
  - Subdomain: `beacon-group-branch-1`
  - Parent: `Beacon Care Group`
- `Beacon Care Group Branch 2`
  - Organization ID: `25166271-4ba0-4de7-9ef4-86819c33b5a6`
  - Subdomain: `beacon-group-branch-2`
  - Parent: `Beacon Care Group`

### Clinic Users

- Temporary password for all seeded clinic users: `ClinicUser!2026#`
- `klinikputeri.1773494478187@drhidayat.com`
  - Name: `Klinik Puteri Admin`
  - Practitioner ID: `4f746014-0d16-460c-bca9-fca495e9020d`
  - Assigned clinic: `Klinik Puteri`
  - Verified EMR login password: `KlinikPuteri!2026`
- `apex-group-admin@drhidayat.com`
  - Name: `Apex Group Admin`
  - Practitioner ID: `355eed26-d3a3-4471-9453-f562a65036a8`
  - Assigned clinic: `Apex Health Group`
- `beacon-group-admin@drhidayat.com`
  - Name: `Beacon Group Admin`
  - Practitioner ID: `fb636b53-34f7-4983-b28f-0581900bbebe`
  - Assigned clinic: `Beacon Care Group`
