const { request } = require('@playwright/test');
const { loadEnvConfig } = require('@next/env');
const path = require('node:path');

loadEnvConfig(process.cwd());

const BASE_URL = process.env.PHASE2_BASE_URL || 'http://localhost:3000';
const MEDPLUM_BASE_URL = (process.env.MEDPLUM_BASE_URL || process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || '').replace(/\/$/, '');
const STORAGE_STATE = path.join(process.cwd(), 'tests/e2e/.auth/demo.json');

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function futureIso(days, hour = 9, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientTransportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|ECONNREFUSED|socket hang up|Target page, context or browser has been closed/i.test(message);
}

async function requestWithRetry(ctx, method, url, options, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await ctx[method.toLowerCase()](url, options);
    } catch (error) {
      lastError = error;
      if (!isTransientTransportError(error) || attempt === attempts) throw error;
      console.log(`[phase2] ${method} ${url} transport retry ${attempt}/${attempts}`);
      await delay(2_000 * attempt);
    }
  }
  throw lastError;
}

async function api(ctx, method, url, data) {
  console.log(`[phase2] ${method} ${url}`);
  const options = data === undefined ? { timeout: 45_000 } : { data, timeout: 45_000 };
  const response = await requestWithRetry(ctx, method, url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok()) {
    throw new Error(`${method} ${url} failed: ${JSON.stringify({ status: response.status(), body })}`);
  }
  console.log(`[phase2] ${method} ${url} -> ${response.status()}`);
  return { status: response.status(), body };
}

async function apiMaybe(ctx, method, url, data) {
  console.log(`[phase2] ${method} ${url}`);
  const options = data === undefined ? { timeout: 45_000 } : { data, timeout: 45_000 };
  const response = await requestWithRetry(ctx, method, url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  console.log(`[phase2] ${method} ${url} -> ${response.status()}`);
  return { status: response.status(), ok: response.ok(), body };
}

async function main() {
  const ctx = await request.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE });
  const id = stamp();
  const report = [];
  let medplumCtx;
  let manualBookedAppointmentId = '';

  try {
    const me = await api(ctx, 'GET', '/api/auth/me');
    const practitionerId = me.body.profile?.id;
    if (!practitionerId) throw new Error('Authenticated profile has no practitioner id');
    report.push({ step: 'auth', status: me.status, practitionerId });
    const session = await api(ctx, 'GET', '/api/auth/medplum-session');
    const accessToken = session.body.accessToken;
    const clinicId = session.body.clinicId || 'demo';
    if (!accessToken || !MEDPLUM_BASE_URL) throw new Error('Missing Medplum access token or base URL for direct setup');
    medplumCtx = await request.newContext({
      baseURL: MEDPLUM_BASE_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
    });

    await api(ctx, 'GET', '/api/practitioners');
    await api(ctx, 'GET', '/api/diagnoses?q=qa&limit=1');
    await apiMaybe(ctx, 'GET', '/api/health');
    await apiMaybe(ctx, 'GET', '/api/health/deep');
    await api(ctx, 'POST', '/api/audit-log', {
      action: 'phase2-crud-verifier',
      entityType: 'qa',
      entityId: id,
      message: 'Phase 2 CRUD verifier audit event',
    });
    report.push({ step: 'support-read-operational-routes' });

    const patientCreate = await api(ctx, 'POST', '/api/patients', {
      fullName: `QA Phase2 ${id}`,
      nric: `QA2${id}`,
      dateOfBirth: '1992-02-02',
      gender: 'female',
      phoneNumber: '0122222222',
      address: 'Phase 2 verifier',
    });
    const patientId = patientCreate.body.patientId;
    await api(ctx, 'GET', `/api/patients?id=${encodeURIComponent(patientId)}`);
    await api(ctx, 'GET', `/api/patients?search=${encodeURIComponent(`QA Phase2 ${id}`)}`);
    await api(ctx, 'PATCH', '/api/patients', {
      patientId,
      address: 'Phase 2 verifier updated',
      phoneNumber: '0122222233',
    });
    report.push({ step: 'patient-create', patientId });

    const intakePilot = await api(ctx, 'POST', '/api/patients/intake-pilot', {
      fullName: `QA Intake ${id}`,
      nric: `QAI${id}`,
      dateOfBirth: '1993-03-03',
      gender: 'male',
      phoneNumber: '0133333333',
      address: 'Phase 2 intake verifier',
    });
    report.push({ step: 'patient-intake-pilot-create', patientId: intakePilot.body.patientId });

    const queuePost = await api(ctx, 'POST', '/api/queue', { patientId });
    await api(ctx, 'GET', '/api/queue');
    await api(ctx, 'PATCH', '/api/queue', { patientId, status: 'waiting' });
    await api(ctx, 'DELETE', '/api/queue', { patientId });
    await api(ctx, 'POST', '/api/check-in', {
      patientId,
      chiefComplaint: 'Phase 2 queue re-check-in',
      visitIntent: 'consultation',
      payerType: 'cash',
      paymentMethod: 'cash',
    });
    report.push({ step: 'queue-crud', status: queuePost.status });

    const triageCreate = await api(ctx, 'POST', '/api/triage', {
      patientId,
      triageLevel: 4,
      chiefComplaint: 'Phase 2 triage create',
      vitalSigns: { temperature: 37.1, heartRate: 80 },
    });
    await api(ctx, 'GET', `/api/triage?patientId=${encodeURIComponent(patientId)}`);
    await api(ctx, 'PATCH', '/api/triage', {
      patientId,
      triageLevel: 3,
      chiefComplaint: 'Phase 2 triage update',
      vitalSigns: { temperature: 37.2, heartRate: 82 },
    });
    await api(ctx, 'DELETE', '/api/triage', { patientId });
    await api(ctx, 'POST', '/api/check-in', {
      patientId,
      chiefComplaint: 'Phase 2 post-triage-delete re-check-in',
      visitIntent: 'consultation',
      payerType: 'cash',
      paymentMethod: 'cash',
    });
    report.push({ step: 'triage-crud', encounterId: triageCreate.body.encounterId });

    const inventoryCreate = await api(ctx, 'POST', '/api/inventory', {
      name: `QA Inventory ${id}`,
      category: 'QA',
      dosageForm: 'tablet',
      strengths: ['10mg'],
      stock: 10,
      minimumStock: 2,
      unit: 'tablet',
      unitPrice: 1.5,
      expiryDate: '2027-12-31',
    });
    const medicationId = inventoryCreate.body.medicationId;
    await api(ctx, 'GET', `/api/inventory?id=${encodeURIComponent(medicationId)}`);
    await api(ctx, 'PATCH', '/api/inventory', { medicationId, stock: 12, unitPrice: 2 });
    const inventoryList = await api(ctx, 'GET', '/api/inventory');
    report.push({ step: 'inventory-crud', medicationId, count: inventoryList.body.count });

    const catalogCreate = await api(ctx, 'POST', '/api/catalogs', {
      type: 'document',
      name: `QA Catalog MC ${id}`,
      display: `QA Catalog MC ${id}`,
      defaultPrice: 0,
      active: true,
      notes: 'Phase 2 verifier',
    });
    const catalogId = catalogCreate.body.id;
    await api(ctx, 'GET', '/api/catalogs?type=document');
    await api(ctx, 'PATCH', '/api/catalogs', { id: catalogId, notes: 'Phase 2 verifier updated', defaultPrice: 1 });
    report.push({ step: 'catalog-crud', catalogId });

    const procedureCreate = await api(ctx, 'POST', '/api/procedures', {
      name: `QA Procedure ${id}`,
      category: 'QA',
      defaultPrice: 3,
      notes: 'Phase 2 procedure verifier',
    });
    const procedureId = procedureCreate.body.procedureId;
    await api(ctx, 'GET', `/api/procedures?id=${encodeURIComponent(procedureId)}`);
    await api(ctx, 'GET', '/api/procedures');
    await api(ctx, 'PATCH', '/api/procedures', { procedureId, defaultPrice: 4, notes: 'Phase 2 procedure updated' });
    report.push({ step: 'procedure-crud', procedureId });

    const insurerCreate = await api(ctx, 'POST', '/api/settings/insurers', {
      name: `QA Insurer ${id}`,
      value: `qa-insurer-${id}`,
    });
    const insurerId = insurerCreate.body.insurer?.id;
    if (!insurerId) throw new Error('Insurer create returned no id');
    await api(ctx, 'GET', '/api/settings/insurers');
    await api(ctx, 'PATCH', '/api/settings/insurers', { id: insurerId, name: `QA Insurer Updated ${id}` });
    report.push({ step: 'settings-insurer-crud', insurerId });

    const supplierCreate = await apiMaybe(ctx, 'POST', '/api/suppliers', {
      name: `QA Supplier ${id}`,
      phone: '0123333333',
      email: `qa-supplier-${id}@example.com`,
      address: 'Phase 2 supplier verifier',
      contactPerson: 'QA Buyer',
      notes: 'Phase 2 supplier',
    });
    let supplierId = '';
    let purchaseId = '';
    if (supplierCreate.status === 403) {
      report.push({ step: 'supplier-purchase-crud-skipped', reason: supplierCreate.body.error || 'disabled' });
    } else {
      if (!supplierCreate.ok) throw new Error(`POST /api/suppliers failed: ${JSON.stringify(supplierCreate)}`);
      supplierId = supplierCreate.body.supplier?.id;
      await api(ctx, 'GET', '/api/suppliers');
      await api(ctx, 'PATCH', '/api/suppliers', { id: supplierId, notes: 'Phase 2 supplier updated' });
      const purchaseCreate = await api(ctx, 'POST', '/api/purchases', {
        supplierId,
        supplierName: `QA Supplier ${id}`,
        reference: `PO-${id}`,
        status: 'draft',
        items: [],
      });
      purchaseId = purchaseCreate.body.id;
      await api(ctx, 'GET', `/api/purchases?id=${encodeURIComponent(purchaseId)}`);
      await api(ctx, 'GET', '/api/purchases');
      await api(ctx, 'PATCH', '/api/purchases', { id: purchaseId, notes: 'Phase 2 purchase updated' });
      report.push({ step: 'supplier-purchase-crud', supplierId, purchaseId });
    }

    await api(ctx, 'GET', '/api/settings/follow-up');
    await api(ctx, 'PUT', '/api/settings/follow-up', {
      deliveryMode: 'manual',
      googleReviewUrl: 'https://example.com/review',
      reviewTemplate: 'Hi {{patientName}}, QA review template.',
      appointmentTemplate: 'Hi {{patientName}}, QA appointment reminder.',
      twilioReviewContentSid: '',
      twilioAppointmentContentSid: '',
    });
    report.push({ step: 'settings-follow-up-put' });

    await api(ctx, 'GET', '/api/document-templates?type=mc');
    await api(ctx, 'POST', '/api/document-templates', {
      type: 'mc',
      html: `<p>QA MC template ${id}</p>`,
    });
    await api(ctx, 'GET', '/api/document-templates?type=mc');
    report.push({ step: 'document-template-crud' });

    const organizationGet = await api(ctx, 'GET', '/api/organization');
    if (organizationGet.body.organization?.name) {
      await api(ctx, 'PUT', '/api/organization', organizationGet.body.organization);
      report.push({ step: 'organization-put-same-values' });
    } else {
      report.push({ step: 'organization-put-skipped', reason: 'No organization returned' });
    }

    const logoUpload = await requestWithRetry(ctx, 'POST', '/api/storage/logo', {
      multipart: {
        file: {
          name: `qa-logo-${id}.png`,
          mimeType: 'image/png',
          buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l0z3VwAAAABJRU5ErkJggg==',
            'base64'
          ),
        },
      },
      timeout: 45_000,
    });
    if (!logoUpload.ok()) {
      const logoBody = await logoUpload.text();
      throw new Error(`POST /api/storage/logo failed: ${logoUpload.status()} ${logoBody}`);
    }
    report.push({ step: 'storage-logo-post', status: logoUpload.status() });

    const appointmentCreate = await api(ctx, 'POST', '/api/appointments', {
      patientId,
      patientName: `QA Phase2 ${id}`,
      clinician: 'Phase 2 Clinician',
      reason: 'Phase 2 appointment CRUD',
      type: 'consultation',
      status: 'booked',
      scheduledAt: futureIso(4, 10, 15),
      durationMinutes: 30,
    });
    const appointmentId = appointmentCreate.body.appointmentId;
    await api(ctx, 'GET', `/api/appointments?id=${encodeURIComponent(appointmentId)}`);
    await api(ctx, 'PATCH', '/api/appointments', { appointmentId, status: 'arrived', scheduledAt: futureIso(4, 11, 0) });
    await api(ctx, 'GET', `/api/appointments?patientId=${encodeURIComponent(patientId)}`);
    report.push({ step: 'appointment-crud', appointmentId });

    const scheduleCreate = await api(ctx, 'POST', '/api/scheduling/schedules', {
      practitionerId,
      practitionerName: 'Phase 2 Practitioner',
    });
    const scheduleId = scheduleCreate.body.schedule?.id;
    if (!scheduleId) throw new Error('Schedule create returned no id');
    await api(ctx, 'GET', '/api/scheduling/schedules');
    const slotMinute = Number(id.slice(-2)) % 45;
    const slotStart = futureIso(20, 9, slotMinute);
    const slotEnd = futureIso(20, 10, slotMinute);
    await api(ctx, 'POST', '/api/scheduling/slots/generate', {
      scheduleId,
      start: slotStart,
      end: slotEnd,
      durationMinutes: 30,
    });
    const slots = await api(
      ctx,
      'GET',
      `/api/scheduling/slots?scheduleId=${encodeURIComponent(scheduleId)}&start=${encodeURIComponent(slotStart)}&end=${encodeURIComponent(slotEnd)}&status=free`
    );
    const slotId = slots.body.slots?.[0]?.id;
    if (!slotId) throw new Error('No generated free slot returned');
    const slotBooking = await api(ctx, 'POST', '/api/scheduling/book', {
      slotId,
      patientId,
      reason: 'Phase 2 slot booking',
      clinicianDisplayOverride: 'Phase 2 Practitioner',
      durationMinutes: 30,
    });
    let manualBooking = await apiMaybe(ctx, 'POST', '/api/scheduling/manual-book', {
      patientId,
      practitionerId,
      practitionerName: 'Phase 2 Practitioner',
      scheduledAt: futureIso(120 + slotMinute, 14, slotMinute),
      durationMinutes: 30,
      reason: 'Phase 2 manual scheduling',
      type: 'consultation',
      notes: 'Phase 2 manual booking verifier',
      reminderDaysBefore: 1,
    });
    if (manualBooking.status === 409 && /overlap|unavailable/i.test(String(manualBooking.body.error || ''))) {
      manualBooking = await api(ctx, 'POST', '/api/scheduling/manual-book', {
        patientId,
        practitionerId,
        practitionerName: 'Phase 2 Practitioner',
        scheduledAt: futureIso(240 + slotMinute, 15, slotMinute),
        durationMinutes: 30,
        reason: 'Phase 2 manual scheduling retry',
        type: 'consultation',
        notes: 'Phase 2 manual booking verifier retry',
        reminderDaysBefore: 1,
      });
    } else if (!manualBooking.ok) {
      throw new Error(`POST /api/scheduling/manual-book failed: ${JSON.stringify(manualBooking)}`);
    }
    manualBookedAppointmentId = manualBooking.body.appointmentId;
    report.push({
      step: 'scheduling-crud',
      scheduleId,
      slotId,
      bookedAppointmentId: slotBooking.body.appointmentId,
      manualBookedAppointmentId,
    });

    const consultationCreate = await api(ctx, 'POST', '/api/consultations', {
      patientId,
      chiefComplaint: '<p>Phase 2 billing consultation.</p>',
      diagnosis: 'Billing verification diagnosis',
      notes: 'Phase 2 verifier',
    });
    const consultationId = consultationCreate.body.consultationId;
    await api(ctx, 'GET', `/api/consultations?id=${encodeURIComponent(consultationId)}`);
    await api(ctx, 'GET', `/api/consultations?patientId=${encodeURIComponent(patientId)}`);
    await api(ctx, 'GET', '/api/consultations?recent=5');
    await api(ctx, 'PATCH', '/api/consultations', {
      consultationId,
      notes: 'Phase 2 consultation updated',
      diagnosis: 'Billing verification diagnosis updated',
      progressNote: '<p>Phase 2 consultation patch.</p>',
    });
    report.push({ step: 'consultation-crud-read-update', consultationId });

    const planDraftId = `phase2-${id}`;
    const planPost = await apiMaybe(ctx, 'POST', '/api/consultations/plan', {
      draftId: planDraftId,
      patientId,
      consultationId,
      entry: {
        tab: 'items',
        name: `QA Plan Item ${id}`,
        quantity: 1,
        unitPrice: 1,
        dosage: '10mg',
        frequency: 'OD',
        duration: '1 day',
      },
    });
    if (planPost.status === 503 && planPost.body.persistenceAvailable === false) {
      report.push({ step: 'consultation-plan-crud-skipped', reason: planPost.body.error });
    } else {
      if (!planPost.ok) throw new Error(`POST /api/consultations/plan failed: ${JSON.stringify(planPost)}`);
      const planEntryId = planPost.body.plan?.entries?.[0]?.id;
      await api(ctx, 'GET', `/api/consultations/plan?draftId=${encodeURIComponent(planDraftId)}&patientId=${encodeURIComponent(patientId)}&consultationId=${encodeURIComponent(consultationId)}`);
      await api(ctx, 'DELETE', '/api/consultations/plan', { draftId: planDraftId, entryId: planEntryId });
      await api(ctx, 'DELETE', '/api/consultations/plan', { draftId: planDraftId, clearAll: true });
      report.push({ step: 'consultation-plan-crud', draftId: planDraftId });
    }

    const documentCreate = await api(ctx, 'POST', '/api/documents', {
      patientId,
      title: `QA Document ${id}.pdf`,
      url: `https://example.com/qa-document-${id}.pdf`,
      contentType: 'application/pdf',
      size: 123,
    });
    const documentId = documentCreate.body.id;
    await api(ctx, 'GET', `/api/documents?patientId=${encodeURIComponent(patientId)}`);
    await api(ctx, 'PATCH', '/api/documents', { id: documentId, title: `QA Document Updated ${id}.pdf` });
    report.push({ step: 'document-crud', documentId });

    const referralCreate = await api(ctx, 'POST', '/api/referrals', {
      patientId,
      specialty: 'ENT',
      facility: 'QA Specialist Center',
      reason: 'Phase 2 referral verifier',
      clinicalInfo: 'Referral QA clinical info',
      urgency: 'routine',
    });
    const referralId = referralCreate.body.referralId;
    await api(ctx, 'GET', `/api/referrals?id=${encodeURIComponent(referralId)}`);
    await api(ctx, 'GET', `/api/referrals?patientId=${encodeURIComponent(patientId)}`);
    await api(ctx, 'PATCH', '/api/referrals', { referralId, clinicalInfo: 'Referral QA updated', status: 'active' });
    report.push({ step: 'referral-crud', referralId });

    const followUpCreate = await api(ctx, 'POST', '/api/follow-up', {
      patientId,
      patientName: `QA Phase2 ${id}`,
      patientPhone: '0122222222',
      type: 'review-request',
      message: `Phase 2 follow-up ${id}`,
      deliveryMode: 'manual',
      sourceType: 'manual',
      sourceId: `phase2-${id}`,
    });
    const followUpId = followUpCreate.body.followUp?.id;
    await api(ctx, 'GET', '/api/follow-up');
    await api(ctx, 'PATCH', `/api/follow-up/${encodeURIComponent(followUpId)}`, { action: 'open' });
    await api(ctx, 'POST', '/api/follow-up/process-due', {});
    await api(ctx, 'PATCH', `/api/follow-up/${encodeURIComponent(followUpId)}`, { status: 'completed' });
    report.push({ step: 'follow-up-crud', followUpId });

    await api(ctx, 'POST', '/api/orders', {
      consultationId,
      prescriptions: [
        {
          medication: { id: `phase2-med-${id}`, name: `QA Billing Med ${id}`, strength: '10mg' },
          frequency: 'OD',
          duration: '1 day',
          quantity: 1,
          category: 'items',
          price: 2,
        },
      ],
    });
    await api(ctx, 'GET', `/api/orders?consultationId=${encodeURIComponent(consultationId)}&patientId=${encodeURIComponent(patientId)}`);
    await api(ctx, 'PATCH', '/api/orders', {
      consultationId,
      prescriptions: [
        {
          medication: { id: `phase2-patch-med-${id}`, name: `QA Patched Med ${id}`, strength: '5mg' },
          frequency: 'BD',
          duration: '2 days',
          quantity: 4,
          category: 'items',
          price: 1,
        },
      ],
      procedures: [
        {
          name: `QA Patched Procedure ${id}`,
          quantity: 1,
          category: 'services',
          price: 2,
          procedureId: `qa-procedure-${id}`,
        },
      ],
    });
    await api(ctx, 'DELETE', '/api/orders', {
      consultationId,
      clearProcedures: true,
      clearPrescriptions: true,
    });
    await api(ctx, 'GET', '/api/orders/billable');
    report.push({ step: 'orders-get-patch-delete' });

    await api(ctx, 'POST', '/api/orders', {
      consultationId,
      prescriptions: [
        {
          medication: { id: `phase2-med-${id}`, name: `QA Billing Med ${id}`, strength: '10mg' },
          frequency: 'OD',
          duration: '1 day',
          quantity: 1,
          category: 'items',
          price: 2,
        },
      ],
    });
    const billingCreate = await api(ctx, 'POST', '/api/billing', {
      consultationId,
      patientId,
      items: [{ id: `phase2-line-${id}`, name: `QA Billing Item ${id}`, type: 'Item', quantity: 1, price: 2 }],
      paymentMethod: 'cash',
      paidAmount: 2,
      totalAmount: 2,
    });
    const invoiceId = billingCreate.body.invoiceId;
    await api(ctx, 'GET', `/api/billing?id=${encodeURIComponent(invoiceId)}`);
    await api(ctx, 'GET', `/api/billing?consultationId=${encodeURIComponent(consultationId)}`);
    await api(ctx, 'GET', `/api/billing?patientId=${encodeURIComponent(patientId)}`);
    await api(ctx, 'PATCH', '/api/billing', { invoiceId, action: 'void' });
    report.push({ step: 'billing-crud', consultationId, invoiceId });

    const taskCreate = await api(medplumCtx, 'POST', '/fhir/R4/Task', {
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      code: {
        coding: [{ system: 'https://ucc.emr/task-type', code: 'billing-exception' }],
        text: 'Billing exception follow-up',
      },
      identifier: [
        { system: 'clinic', value: clinicId },
        { system: 'https://ucc.emr/task/billing-exception', value: `phase2-task-${id}` },
      ],
      description: `Phase 2 task verifier ${id}`,
      authoredOn: new Date().toISOString(),
      for: { reference: `Patient/${patientId}` },
      focus: { reference: `Encounter/${consultationId}` },
      extension: [
        { url: 'https://ucc.emr/task/consultation-id', valueString: consultationId },
        { url: 'https://ucc.emr/task/clinic-id', valueString: clinicId },
        { url: 'https://ucc.emr/task/error-class', valueString: 'phase2-test' },
      ],
    });
    const taskId = taskCreate.body.id;
    const tasksList = await apiMaybe(ctx, 'GET', '/api/tasks?type=billing-exception&status=all');
    if (tasksList.status === 404 && /disabled/i.test(String(tasksList.body.error || ''))) {
      report.push({ step: 'tasks-crud-skipped', reason: tasksList.body.error });
    } else {
      if (!tasksList.ok) throw new Error(`GET /api/tasks failed: ${JSON.stringify(tasksList)}`);
      await api(ctx, 'PATCH', `/api/tasks/${encodeURIComponent(taskId)}`, {
      status: 'completed',
      note: 'Phase 2 task verifier completed',
      });
      report.push({ step: 'tasks-get-patch', taskId });
    }

    await api(ctx, 'DELETE', `/api/inventory?id=${encodeURIComponent(medicationId)}`);
    await api(ctx, 'DELETE', `/api/catalogs?id=${encodeURIComponent(catalogId)}`);
    await api(ctx, 'DELETE', `/api/procedures?id=${encodeURIComponent(procedureId)}`);
    await api(ctx, 'DELETE', `/api/settings/insurers?id=${encodeURIComponent(insurerId)}`);
    if (purchaseId) await api(ctx, 'DELETE', `/api/purchases?id=${encodeURIComponent(purchaseId)}`);
    if (supplierId) await api(ctx, 'DELETE', `/api/suppliers?id=${encodeURIComponent(supplierId)}`);
    await api(ctx, 'DELETE', '/api/appointments', { appointmentId });
    await api(ctx, 'DELETE', '/api/appointments', { appointmentId: slotBooking.body.appointmentId });
    if (manualBookedAppointmentId) await api(ctx, 'DELETE', '/api/appointments', { appointmentId: manualBookedAppointmentId });
    await api(ctx, 'DELETE', '/api/billing', { invoiceId });
    await api(ctx, 'DELETE', '/api/documents', { id: documentId });
    await api(ctx, 'DELETE', '/api/referrals', { referralId });
    await api(ctx, 'DELETE', `/api/follow-up/${encodeURIComponent(followUpId)}`);
    await api(ctx, 'DELETE', '/api/consultations', { consultationId });
    await api(ctx, 'DELETE', `/api/patients?patientId=${encodeURIComponent(patientId)}`);
    await api(ctx, 'DELETE', `/api/patients?patientId=${encodeURIComponent(intakePilot.body.patientId)}`);
    await api(medplumCtx, 'DELETE', `/fhir/R4/Task/${encodeURIComponent(taskId)}`);
    report.push({ step: 'cleanup' });

    console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, patientId, report }, null, 2));
  } finally {
    if (medplumCtx) await medplumCtx.dispose();
    await ctx.dispose();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
