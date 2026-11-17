import { expect, test } from 'bun:test';
import { stagingPreflight } from '../../scripts/staging/preflight';

const good = {
  UCC_STAGING_MEDPLUM_URL: 'http://127.0.0.1:8123/',
  MEDPLUM_BASE_URL: 'http://127.0.0.1:8123/',
  NEXT_PUBLIC_MEDPLUM_BASE_URL: 'http://127.0.0.1:8123',
  UCC_BASE_URL: 'http://127.0.0.1:3220',
  UCC_STAGING_ALLOWED_FIREBASE_PROJECT: 'ucc-stg-fake',
  FIREBASE_PROJECT_ID: 'ucc-stg-fake',
  FIREBASE_STORAGE_BUCKET: 'ucc-stg-fake.appspot.com',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'ucc-stg-fake.appspot.com',
  COOKIE_DOMAIN: '',
  NEXT_PUBLIC_BASE_DOMAIN: '127.0.0.1',
};

test('accepts a fully staging environment', () => expect(stagingPreflight(good)).toEqual([]));

test('fails closed on dev, production and unset targets', () => {
  for (const bad of [
    { MEDPLUM_BASE_URL: 'http://127.0.0.1:8113/' },
    { MEDPLUM_BASE_URL: 'https://fhir.example.com/' },
    { MEDPLUM_URL: 'http://127.0.0.1:8113/' },
    { UCC_STAGING_MEDPLUM_URL: undefined },
    { UCC_STAGING_MEDPLUM_URL: 'http://user:pw@127.0.0.1:8123/' },
    { UCC_BASE_URL: 'http://127.0.0.1:3210' },
    { FIREBASE_PROJECT_ID: 'other-project' },
    { FIREBASE_STORAGE_BUCKET: 'prod-bucket.appspot.com' },
    { UCC_STAGING_ALLOWED_FIREBASE_PROJECT: undefined, FIREBASE_PROJECT_ID: undefined },
    { GOOGLE_APPLICATION_CREDENTIALS: '/x.json' },
    { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'other' }) },
    { COOKIE_DOMAIN: '.iatrum.com' },
    { NEXT_PUBLIC_BASE_DOMAIN: 'demo.drhidayat.com' },
  ]) expect(stagingPreflight({ ...good, ...bad }).length).toBeGreaterThan(0);
});

test('failure messages never contain values', () => {
  const out = stagingPreflight({ ...good, FIREBASE_SERVICE_ACCOUNT: '{"project_id":"secret-proj"}' }).join('|');
  expect(out).not.toContain('secret-proj');
});
