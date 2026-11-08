// 클라우드 동기화 (Firebase 로그인 + Firestore 저장소)
// 기록은 Firestore 문서 users/{내 계정 ID} 하나에 저장돼요.
import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const KINDS = ['fuel', 'maint', 'insurance', 'tax'];

const api = {
  ready: false,        // 로그인 상태 확인이 끝났는지
  configured: false,   // firebase-config.js 가 채워졌는지
  user: null,          // { email, uid }
  status: 'off',       // off | connecting | synced | saving | offline | error
  login, logout, resetPassword, apply,
};
window.CarSync = api;

let fb = null;        // Firebase 모듈과 인스턴스
let ref = null;       // 내 문서 참조
let unsub = null;     // 실시간 구독 해제 함수
let pending = (window.__carOps || []).splice(0); // 준비 전에 생긴 변경 사항

const clean = o => JSON.parse(JSON.stringify(o ?? null));
function notify() { window.CarApp && window.CarApp.onSync(api); }

function toRemote(S) {
  const out = { version: 1, car: clean(S.car), intervals: clean(S.intervals) };
  for (const k of KINDS) { out[k] = {}; for (const r of S[k]) out[k][r.id] = clean(r); }
  return out;
}
function fromRemote(d) {
  const out = { version: d.version || 1, car: d.car || {}, intervals: d.intervals };
  for (const k of KINDS) out[k] = Object.values(d[k] || {});
  return out;
}

async function init() {
  if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey) { api.ready = true; pending = []; notify(); return; }
  api.configured = true;
  api.status = 'connecting';
  notify();
  try {
    const [appM, authM, fsM] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-firestore.js'),
    ]);
    const app = appM.initializeApp(FIREBASE_CONFIG);
    const auth = authM.getAuth(app);
    let db;
    try {
      // 인터넷이 없어도 쓸 수 있도록 기기에 사본을 보관
      db = fsM.initializeFirestore(app, { localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }) });
    } catch (e) {
      console.warn('offline cache unavailable', e);
      db = fsM.getFirestore(app);
    }
    fb = { authM, fsM, auth, db };
    authM.onAuthStateChanged(auth, onUser);
  } catch (e) {
    console.error(e);
    api.status = 'error'; api.ready = true; pending = [];
    notify();
  }
}

async function onUser(user) {
  if (unsub) { unsub(); unsub = null; }
  ref = null;
  if (!user) {
    api.user = null; api.status = 'off'; api.ready = true; pending = [];
    notify();
    return;
  }
  const { fsM, db } = fb;
  ref = fsM.doc(db, 'users', user.uid);
  api.user = { email: user.email, uid: user.uid };
  api.status = 'connecting';
  try { await firstMerge(user.uid); } catch (e) { console.warn('첫 병합은 다음에 다시 시도해요', e); }
  api.ready = true;
  const ops = pending.splice(0);
  if (ops.length) apply(ops);
  notify();
  unsub = fsM.onSnapshot(ref, { includeMetadataChanges: true }, snap => {
    api.status = snap.metadata.hasPendingWrites ? 'saving' : snap.metadata.fromCache ? 'offline' : 'synced';
    if (snap.exists()) window.CarApp.setRemote(fromRemote(snap.data()));
    notify();
  }, err => { console.error(err); api.status = 'error'; notify(); });
}

// 이 기기에서 처음 로그인할 때: 이 기기에만 있던 기록을 클라우드에 합쳐요 (지우지 않고 더하기만)
async function firstMerge(uid) {
  const key = 'carlog-merged-' + uid;
  try { if (localStorage.getItem(key)) return; } catch (e) { return; }
  const { fsM } = fb;
  const snap = await fsM.getDoc(ref);
  const local = window.CarApp.getState();
  const fail = e => { console.error(e); api.status = 'error'; notify(); };
  if (!snap.exists()) {
    fsM.setDoc(ref, toRemote(local)).catch(fail);
  } else {
    const r = snap.data();
    const patch = {};
    for (const k of KINDS) {
      const have = r[k] || {};
      for (const rec of local[k]) if (!have[rec.id]) (patch[k] = patch[k] || {})[rec.id] = clean(rec);
    }
    if (!(r.car && r.car.name) && local.car.name) patch.car = clean(local.car);
    if (Object.keys(patch).length) fsM.setDoc(ref, patch, { merge: true }).catch(fail);
  }
  localStorage.setItem(key, '1');
}

// 앱에서 기록이 바뀔 때마다 호출돼요
function apply(ops) {
  if (!api.ready) { pending.push(...ops); return; }
  if (!api.user || !ref) return;
  const { fsM } = fb;
  const S = window.CarApp.getState();
  const fail = e => { console.error(e); api.status = 'error'; notify(); };
  for (const op of ops) {
    let p;
    if (op.t === 'put') p = fsM.setDoc(ref, { [op.kind]: { [op.rec.id]: clean(op.rec) } }, { merge: true });
    else if (op.t === 'del') p = fsM.updateDoc(ref, { [`${op.kind}.${op.id}`]: fsM.deleteField() });
    else if (op.t === 'car') p = fsM.setDoc(ref, { car: clean(S.car) }, { merge: true });
    else if (op.t === 'intervals') p = fsM.setDoc(ref, { intervals: clean(S.intervals) }, { merge: true });
    else if (op.t === 'all') p = fsM.setDoc(ref, toRemote(S));
    if (p) p.catch(fail);
  }
}

const AUTH_ERR = {
  'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않아요.',
  'auth/wrong-password': '이메일 또는 비밀번호가 맞지 않아요.',
  'auth/user-not-found': '이메일 또는 비밀번호가 맞지 않아요.',
  'auth/invalid-email': '이메일 형식이 올바르지 않아요.',
  'auth/too-many-requests': '시도가 너무 많아요. 잠시 후 다시 해 주세요.',
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
  'auth/user-disabled': '사용이 중지된 계정이에요.',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'firebase-config.js 의 설정값이 올바르지 않아요.',
  'auth/operation-not-allowed': 'Firebase에서 이메일/비밀번호 로그인이 켜져 있지 않아요.',
};
const authMsg = e => AUTH_ERR[e && e.code] || ('오류: ' + ((e && (e.code || e.message)) || e));

async function login(email, password) {
  if (!fb) return '클라우드에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.';
  try { await fb.authM.signInWithEmailAndPassword(fb.auth, email, password); return null; }
  catch (e) { return authMsg(e); }
}
async function logout() { if (fb) await fb.authM.signOut(fb.auth); }
async function resetPassword(email) {
  if (!fb) return '클라우드에 연결하지 못했어요.';
  try { await fb.authM.sendPasswordResetEmail(fb.auth, email); return null; }
  catch (e) { return authMsg(e); }
}

init();
