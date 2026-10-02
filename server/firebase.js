import 'dotenv/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let db = null;

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      return parsed;
    } catch (error) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_INVALID');
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || '';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) return null;

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey
  };
}

export function isFirestoreConfigured() {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY));
}

export function getDb() {
  if (db) return db;

  if (!isFirestoreConfigured()) {
    throw new Error('FIRESTORE_NOT_CONFIGURED');
  }

  const serviceAccount = getServiceAccount();

  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount)
    });
  }

  db = getFirestore();
  return db;
}
