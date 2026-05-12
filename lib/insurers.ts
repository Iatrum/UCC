import { db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";

export interface Insurer {
  id?: string;
  name: string;
  value: string;
  createdAt?: string;
  updatedAt?: string;
}

const COLLECTION = "insurers";
const REQUEST_TIMEOUT_MS = 5000;

function isFirebaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
}

function withTimeout<T>(promise: Promise<T>, action: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out while trying to ${action}.`));
    }, REQUEST_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export async function fetchInsurers(): Promise<Insurer[]> {
  if (!isFirebaseConfigured()) return [];
  const q = query(collection(db, COLLECTION), orderBy("name", "asc"));
  const snapshot = await withTimeout(getDocs(q), "load insurers");
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Insurer, "id">) }));
}

export async function addInsurer(insurer: Omit<Insurer, "id">): Promise<string> {
  if (!isFirebaseConfigured()) throw new Error("Firebase is not configured.");
  const ref = await withTimeout(
    addDoc(collection(db, COLLECTION), {
      ...insurer,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    "add insurer"
  );
  return ref.id;
}

export async function updateInsurer(id: string, insurer: Partial<Omit<Insurer, "id">>): Promise<void> {
  if (!isFirebaseConfigured()) throw new Error("Firebase is not configured.");
  await withTimeout(
    updateDoc(doc(db, COLLECTION, id), {
      ...insurer,
      updatedAt: new Date().toISOString(),
    }),
    "update insurer"
  );
}

export async function deleteInsurer(id: string): Promise<void> {
  if (!isFirebaseConfigured()) throw new Error("Firebase is not configured.");
  await withTimeout(deleteDoc(doc(db, COLLECTION, id)), "delete insurer");
}
