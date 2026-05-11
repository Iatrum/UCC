import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

let adminApp: App;

function buildCredential() {
  // 1) FIREBASE_SERVICE_ACCOUNT as JSON or base64 JSON
  const svcRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (svcRaw) {
    try {
      const json = svcRaw.trim().startsWith('{') ? svcRaw : Buffer.from(svcRaw, 'base64').toString('utf8');
      const parsed = JSON.parse(json);
      if (parsed.private_key && typeof parsed.private_key === 'string') {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return cert(parsed as any);
    } catch (e) {
      console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT');
    }
  }

  // 2) Individual envs
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (projectId && clientEmail && privateKey) {
    return cert({ projectId, clientEmail, privateKey });
  }

  // 3) Fallback to ADC
  return undefined;
}

if (getApps().length === 0) {
  const credential = buildCredential();
  if (credential) {
    adminApp = initializeApp({ credential });
  } else {
    console.warn('Initializing Firebase Admin without explicit credentials; set FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY');
    adminApp = initializeApp();
  }
} else {
  adminApp = getApps()[0]!;
}

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
export const adminStorage = getStorage(adminApp);

export function getAdminStorageBucket() {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) {
    throw new Error('Firebase storage bucket is not configured');
  }
  return adminStorage.bucket(bucketName);
}

