import { db } from './firebase';
import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  addDoc, 
  updateDoc,
  deleteDoc,
  query,
  where,
  Timestamp,
  DocumentData 
} from 'firebase/firestore';
export interface Medication {
  id: string;
  name: string;
  category: string;
  dosageForm: string;
  strengths: string[];
  stock: number;
  minimumStock: number;
  unit: string;
  unitPrice: number;
  expiryDate: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const MEDICATIONS = 'medications';

const convertTimestamps = (data: DocumentData) => {
  const result = { ...data };
  if (result.createdAt) {
    result.createdAt = result.createdAt.toDate();
  }
  if (result.updatedAt) {
    result.updatedAt = result.updatedAt.toDate();
  }
  return result;
};

const BUILT_IN_MEDICATIONS: Medication[] = [
  { id: 'paracetamol_500mg', name: 'Paracetamol', category: 'Analgesics', dosageForm: 'Tablet', strengths: ['500mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.5, expiryDate: '' },
  { id: 'paracetamol_1g', name: 'Paracetamol', category: 'Analgesics', dosageForm: 'Tablet', strengths: ['1g'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.8, expiryDate: '' },
  { id: 'ibuprofen_400mg', name: 'Ibuprofen', category: 'Analgesics', dosageForm: 'Tablet', strengths: ['400mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.6, expiryDate: '' },
  { id: 'mefenamic_acid_500mg', name: 'Mefenamic Acid (Ponstan)', category: 'Analgesics', dosageForm: 'Capsule', strengths: ['500mg'], stock: 100, minimumStock: 20, unit: 'capsule', unitPrice: 0.7, expiryDate: '' },
  { id: 'amoxicillin_500mg', name: 'Amoxicillin', category: 'Antibiotics', dosageForm: 'Capsule', strengths: ['500mg'], stock: 100, minimumStock: 20, unit: 'capsule', unitPrice: 1.0, expiryDate: '' },
  { id: 'amoxicillin_clavulanate_625mg', name: 'Amoxicillin-Clavulanate (Augmentin)', category: 'Antibiotics', dosageForm: 'Tablet', strengths: ['625mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 3.0, expiryDate: '' },
  { id: 'azithromycin_500mg', name: 'Azithromycin (Zithromax)', category: 'Antibiotics', dosageForm: 'Tablet', strengths: ['500mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 5.0, expiryDate: '' },
  { id: 'cefuroxime_250mg', name: 'Cefuroxime (Zinnat)', category: 'Antibiotics', dosageForm: 'Tablet', strengths: ['250mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 4.0, expiryDate: '' },
  { id: 'doxycycline_100mg', name: 'Doxycycline', category: 'Antibiotics', dosageForm: 'Capsule', strengths: ['100mg'], stock: 100, minimumStock: 20, unit: 'capsule', unitPrice: 0.8, expiryDate: '' },
  { id: 'omeprazole_20mg', name: 'Omeprazole (Losec)', category: 'Gastrointestinal', dosageForm: 'Capsule', strengths: ['20mg'], stock: 100, minimumStock: 20, unit: 'capsule', unitPrice: 1.5, expiryDate: '' },
  { id: 'domperidone_10mg', name: 'Domperidone (Motilium)', category: 'Gastrointestinal', dosageForm: 'Tablet', strengths: ['10mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.5, expiryDate: '' },
  { id: 'metoclopramide_10mg', name: 'Metoclopramide (Maxolon)', category: 'Gastrointestinal', dosageForm: 'Tablet', strengths: ['10mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.4, expiryDate: '' },
  { id: 'cetirizine_10mg', name: 'Cetirizine (Zyrtec)', category: 'Antihistamines', dosageForm: 'Tablet', strengths: ['10mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.8, expiryDate: '' },
  { id: 'loratadine_10mg', name: 'Loratadine (Clarityne)', category: 'Antihistamines', dosageForm: 'Tablet', strengths: ['10mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 1.0, expiryDate: '' },
  { id: 'chlorpheniramine_4mg', name: 'Chlorpheniramine (Piriton)', category: 'Antihistamines', dosageForm: 'Tablet', strengths: ['4mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.3, expiryDate: '' },
  { id: 'salbutamol_100mcg', name: 'Salbutamol (Ventolin) Inhaler', category: 'Respiratory', dosageForm: 'Inhaler', strengths: ['100mcg'], stock: 50, minimumStock: 10, unit: 'canister', unitPrice: 15.0, expiryDate: '' },
  { id: 'prednisolone_5mg', name: 'Prednisolone', category: 'Respiratory', dosageForm: 'Tablet', strengths: ['5mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.5, expiryDate: '' },
  { id: 'amlodipine_5mg', name: 'Amlodipine (Norvasc)', category: 'Cardiovascular', dosageForm: 'Tablet', strengths: ['5mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.8, expiryDate: '' },
  { id: 'atenolol_50mg', name: 'Atenolol', category: 'Cardiovascular', dosageForm: 'Tablet', strengths: ['50mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.5, expiryDate: '' },
  { id: 'simvastatin_20mg', name: 'Simvastatin', category: 'Cardiovascular', dosageForm: 'Tablet', strengths: ['20mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.6, expiryDate: '' },
  { id: 'metformin_500mg', name: 'Metformin', category: 'Antidiabetic', dosageForm: 'Tablet', strengths: ['500mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.4, expiryDate: '' },
  { id: 'metformin_850mg', name: 'Metformin', category: 'Antidiabetic', dosageForm: 'Tablet', strengths: ['850mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.6, expiryDate: '' },
  { id: 'glibenclamide_5mg', name: 'Glibenclamide (Daonil)', category: 'Antidiabetic', dosageForm: 'Tablet', strengths: ['5mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.3, expiryDate: '' },
  { id: 'vitamin_b_complex', name: 'Vitamin B Complex', category: 'Vitamins & Supplements', dosageForm: 'Tablet', strengths: [], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.2, expiryDate: '' },
  { id: 'vitamin_c_1000mg', name: 'Vitamin C', category: 'Vitamins & Supplements', dosageForm: 'Tablet', strengths: ['1000mg'], stock: 100, minimumStock: 20, unit: 'tablet', unitPrice: 0.5, expiryDate: '' },
];

export async function getMedications(): Promise<Medication[]> {
  try {
    const firestorePromise = getDocs(collection(db, MEDICATIONS)).then(snapshot =>
      snapshot.docs.map(doc => ({
        id: doc.id,
        ...convertTimestamps(doc.data())
      } as Medication))
    );

    const timeoutPromise = new Promise<Medication[]>((resolve) =>
      setTimeout(() => resolve([]), 3000)
    );

    const firestoreMeds = await Promise.race([firestorePromise, timeoutPromise]);

    if (firestoreMeds.length === 0) return BUILT_IN_MEDICATIONS;

    const builtInIds = new Set(BUILT_IN_MEDICATIONS.map(m => m.id));
    const extraFromFirestore = firestoreMeds.filter(m => !builtInIds.has(m.id));
    return [...BUILT_IN_MEDICATIONS, ...extraFromFirestore];
  } catch {
    return BUILT_IN_MEDICATIONS;
  }
}

export function getBuiltInMedicationList(): Medication[] {
  return BUILT_IN_MEDICATIONS;
}

export async function getMedicationById(id: string): Promise<Medication | null> {
  try {
    const docRef = doc(db, MEDICATIONS, id);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      return null;
    }
    
    return {
      id: docSnap.id,
      ...convertTimestamps(docSnap.data())
    } as Medication;
  } catch (error) {
    console.error('Error fetching medication:', error);
    return null;
  }
}

export async function createMedication(data: Omit<Medication, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> {
  try {
    const docRef = await addDoc(collection(db, MEDICATIONS), {
      ...data,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    return docRef.id;
  } catch (error) {
    console.error('Error creating medication:', error);
    return null;
  }
}

export async function updateMedication(id: string, data: Partial<Medication>): Promise<boolean> {
  try {
    const docRef = doc(db, MEDICATIONS, id);
    await updateDoc(docRef, {
      ...data,
      updatedAt: Timestamp.now()
    });
    return true;
  } catch (error) {
    console.error('Error updating medication:', error);
    return false;
  }
}

export async function deleteMedication(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, MEDICATIONS, id));
    return true;
  } catch (error) {
    console.error('Error deleting medication:', error);
    return false;
  }
}
