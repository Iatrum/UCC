const { chromium } = require('@playwright/test');
const path = require('node:path');

const BASE_URL = process.env.PHASE1_BASE_URL || 'http://localhost:3000';
const STORAGE_STATE = path.join(process.cwd(), 'tests/e2e/.auth/demo.json');
const LOGIN_EMAIL = process.env.PHASE1_LOGIN_EMAIL || 'demo@iatrum.com';
const LOGIN_PASSWORD = process.env.PHASE1_LOGIN_PASSWORD || 'demouser123';
const SKIP_LOGIN = process.env.PHASE1_SKIP_LOGIN === '1';
const SKIP_FINAL_PAGES = process.env.PHASE1_SKIP_FINAL_PAGES === '1';

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

async function api(page, method, url, data) {
  console.log(`[phase1] ${method} ${url}`);
  const response = await page.request[method.toLowerCase()](
    url,
    data === undefined ? { timeout: 30_000 } : { data, timeout: 30_000 }
  );
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  const result = { status: response.status(), body };
  if (!response.ok()) {
    throw new Error(`${method} ${url} failed: ${JSON.stringify(result)}`);
  }
  console.log(`[phase1] ${method} ${url} -> ${response.status()}`);
  return result;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE });
  const page = await context.newPage();
  const createdAt = stamp();
  const report = [];

  try {
    if (!SKIP_LOGIN) {
      console.log('[phase1] POST /api/auth/login');
      const loginResponse = await page.request.post('/api/auth/login', {
        data: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
        timeout: 30_000,
      });
      const loginPayload = await loginResponse.json().catch(() => ({}));
      if (!loginResponse.ok()) {
        throw new Error(`Login failed: ${JSON.stringify({ status: loginResponse.status(), body: loginPayload })}`);
      }
      await page.context().storageState({ path: STORAGE_STATE });
      report.push({
        step: 'auth-login',
        status: loginResponse.status(),
        clinicId: loginPayload.clinicId ?? null,
        redirectUrl: loginPayload.redirectUrl ?? null,
      });
    } else {
      const me = await page.request.get('/api/auth/me', { timeout: 30_000 });
      const mePayload = await me.json().catch(() => ({}));
      if (!me.ok()) {
        throw new Error(`Stored auth state is invalid: ${JSON.stringify({ status: me.status(), body: mePayload })}`);
      }
      report.push({
        step: 'auth-reuse',
        status: me.status(),
        profile: mePayload?.profile?.id ?? null,
      });
    }

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle').catch(() => {});
    if (!page.url().includes('/dashboard')) {
      throw new Error(`Auth fixture did not reach dashboard; current URL is ${page.url()}`);
    }
    report.push({ step: 'auth-dashboard', url: page.url() });

    const patientPayload = {
      fullName: `QA Phase1 ${createdAt}`,
      nric: `QA${createdAt}`,
      dateOfBirth: '1990-01-01',
      gender: 'male',
      phoneNumber: '0123456789',
      address: 'Headless Playwright QA',
    };
    const patientCreate = await api(page, 'POST', '/api/patients', patientPayload);
    const patientId = patientCreate.body.patientId;
    if (!patientId) throw new Error('Patient create returned no patientId');
    report.push({ step: 'patient-create', status: patientCreate.status, patientId });

    const patientRead = await api(page, 'GET', `/api/patients?id=${encodeURIComponent(patientId)}`);
    report.push({ step: 'patient-read', status: patientRead.status, patientId: patientRead.body.patient?.id });

    const patientUpdate = await api(page, 'PATCH', '/api/patients', {
      patientId,
      phoneNumber: '0198765432',
      address: 'Headless Playwright QA updated',
    });
    report.push({ step: 'patient-update', status: patientUpdate.status });

    const checkIn = await api(page, 'POST', '/api/check-in', {
      patientId,
      chiefComplaint: 'Fever and cough for 2 days',
      visitIntent: 'consultation',
      payerType: 'cash',
      paymentMethod: 'cash',
      registrationSource: 'qa-headless',
      registrationAt: new Date().toISOString(),
      performedBy: 'Playwright QA',
    });
    report.push({ step: 'check-in', status: checkIn.status });

    const triagePatch = await api(page, 'PATCH', '/api/triage', {
      patientId,
      triageLevel: 3,
      chiefComplaint: 'Fever and cough for 2 days',
      vitalSigns: {
        temperature: '38.1',
        bloodPressure: '120/80',
        heartRate: '88',
        respiratoryRate: '18',
        oxygenSaturation: '98',
      },
      triageNotes: 'Headless Phase 1 triage update',
    });
    report.push({ step: 'triage-update', status: triagePatch.status });

    const triageRead = await api(page, 'GET', `/api/triage?patientId=${encodeURIComponent(patientId)}`);
    report.push({
      step: 'triage-read',
      status: triageRead.status,
      queueStatus: triageRead.body.triage?.queueStatus ?? null,
      triageLevel: triageRead.body.triage?.triage?.level ?? triageRead.body.triage?.triageLevel ?? null,
    });

    const consultationCreate = await api(page, 'POST', '/api/consultations', {
      patientId,
      chiefComplaint: '<p>Fever, cough, and body ache for 2 days.</p>',
      diagnosis: 'Upper respiratory tract infection',
      notes: 'Initial headless consultation note',
    });
    const consultationId = consultationCreate.body.consultationId;
    if (!consultationId) throw new Error('Consultation create returned no consultationId');
    report.push({ step: 'consultation-sign', status: consultationCreate.status, consultationId });

    const consultationUpdate = await api(page, 'PATCH', '/api/consultations', {
      consultationId,
      chiefComplaint: '<p>Updated: fever, cough, sore throat. No red flags.</p>',
      diagnosis: 'Acute upper respiratory infection',
      notes: 'Headless update consultation persisted',
      progressNote: 'Patient stable, symptomatic treatment.',
    });
    report.push({ step: 'consultation-update', status: consultationUpdate.status });

    const medicationOne = {
      medication: { id: `qa-paracetamol-${createdAt}`, name: 'QA Paracetamol 500mg', strength: '500mg' },
      frequency: 'TDS',
      duration: '3 days',
      quantity: 9,
      category: 'items',
      price: 0,
    };
    const mcProcedure = {
      name: 'MEDICAL CERTIFICATE (MC)',
      quantity: 1,
      category: 'documents',
      price: 0,
      procedureId: 'letter-mc',
      notes: JSON.stringify({
        kind: 'mc',
        status: 'completed',
        title: 'MEDICAL CERTIFICATE (MC)',
        instruction: '',
        mcDays: '1',
        mcDiagnosis: 'Acute upper respiratory infection',
        mcStartDate: new Date().toISOString().slice(0, 10),
        mcDoctorName: 'Playwright QA Doctor',
      }),
    };
    const orderOne = await api(page, 'POST', '/api/orders', {
      consultationId,
      prescriptions: [medicationOne],
      procedures: [mcProcedure],
    });
    report.push({ step: 'order-medication-and-mc', status: orderOne.status });

    const afterOrderOne = await api(page, 'GET', `/api/consultations?id=${encodeURIComponent(consultationId)}`);
    report.push({
      step: 'consultation-read-after-order-1',
      status: afterOrderOne.status,
      prescriptions: afterOrderOne.body.consultation?.prescriptions?.length ?? 0,
      procedures: afterOrderOne.body.consultation?.procedures?.length ?? 0,
    });

    const medicationTwo = {
      medication: { id: `qa-cetirizine-${createdAt}`, name: 'QA Cetirizine 10mg', strength: '10mg' },
      frequency: 'ON',
      duration: '3 days',
      quantity: 3,
      category: 'items',
      price: 0,
    };
    const orderTwo = await api(page, 'POST', '/api/orders', {
      consultationId,
      prescriptions: [medicationTwo],
    });
    report.push({ step: 'second-medication-reorder', status: orderTwo.status });

    const finalRead = await api(page, 'GET', `/api/consultations?id=${encodeURIComponent(consultationId)}`);
    const finalConsult = finalRead.body.consultation;
    report.push({
      step: 'final-consultation-read',
      status: finalRead.status,
      diagnosis: finalConsult?.diagnosis,
      prescriptions: finalConsult?.prescriptions?.map((rx) => rx.medication?.name),
      procedures: finalConsult?.procedures?.map((p) => p.name),
    });

    if (!SKIP_FINAL_PAGES) {
      await page.goto(`/patients/${patientId}`);
      await page.screenshot({ path: 'output/playwright/phase1-patient-profile.png', fullPage: true });
      await page.goto(`/consultations/${consultationId}`);
      await page.screenshot({ path: 'output/playwright/phase1-consultation.png', fullPage: true });
    }

    console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, patientId, consultationId, report }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
