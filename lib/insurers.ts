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

export async function fetchInsurers(): Promise<Insurer[]> {
  const q = query(collection(db, COLLECTION), orderBy("name", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Insurer, "id">) }));
}

export async function addInsurer(insurer: Omit<Insurer, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTION), {
    ...insurer,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function updateInsurer(id: string, insurer: Partial<Omit<Insurer, "id">>): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), {
    ...insurer,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteInsurer(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}
