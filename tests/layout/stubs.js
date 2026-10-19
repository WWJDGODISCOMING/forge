// Offline stand-ins for the Firebase SDK files the app loads from gstatic.com, so the real app can boot in a
// headless browser with no network and no account. Data comes from window.__SEED (see seed.js).
const app = 'export const initializeApp = () => ({});';

const auth = `
const user = { uid: 'u1', email: 'test@example.com' };
export const indexedDBLocalPersistence = {}, browserLocalPersistence = {};
export const initializeAuth = () => ({ currentUser: user });
export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb(user), 0); return () => {}; };
export const createUserWithEmailAndPassword = async () => ({}), signInWithEmailAndPassword = async () => ({});
export const sendPasswordResetEmail = async () => {}, signOut = async () => {}, reauthenticateWithCredential = async () => {}, deleteUser = async () => {};
export const EmailAuthProvider = { credential: () => ({}) };
// Two-step sign-in (TOTP) stand-ins; synthetic key. window.__mfaOn says whether the account has an authenticator.
export const multiFactor = () => ({
  enrolledFactors: window.__mfaOn ? [{ factorId: 'totp', uid: 'f1' }] : [],
  getSession: async () => ({}), enroll: async () => { window.__mfaOn = true; }, unenroll: async () => { window.__mfaOn = false; },
});
export const TotpMultiFactorGenerator = { generateSecret: async () => ({ secretKey: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' }), assertionForEnrollment: () => ({}), assertionForSignIn: () => ({}) };
export const getMultiFactorResolver = () => ({ hints: [{ factorId: 'totp', uid: 'f1' }], resolveSignIn: async () => ({}) });
`;

const firestore = `
export const persistentLocalCache = () => ({}), persistentMultipleTabManager = () => ({}), initializeFirestore = () => ({});
export const collection = (db, ...p) => ({ col: p[p.length - 1] });
export const doc = (db, ...p) => ({ col: p[p.length - 2], id: p[p.length - 1] });
export const setDoc = async () => {}, updateDoc = async () => {}, deleteField = () => ({}), terminate = async () => {}, clearIndexedDbPersistence = async () => {};
export const writeBatch = () => ({ set() {}, update() {}, delete() {}, commit: async () => {} });
const rows = (col) => ((window.__SEED || {})[col] || []);
const snap = (col) => ({ metadata: { hasPendingWrites: false }, docChanges: () => [1], docs: rows(col).map((r) => ({ id: r.id, data: () => r })) });
export const getDocs = async (ref) => snap(ref.col);
export const onSnapshot = (ref, ...rest) => { const next = rest.find((x) => typeof x === 'function'); setTimeout(() => next(snap(ref.col)), 0); return () => {}; };
`;

const functions = `
export const getFunctions = () => ({});
export const httpsCallable = () => async () => ({ data: {} });
`;

export const STUBS = {
  'firebase-app.js': app,
  'firebase-auth.js': auth,
  'firebase-firestore.js': firestore,
  'firebase-functions.js': functions,
};
