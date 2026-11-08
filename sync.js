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
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    api.user = null; api.status = 'off'; api.ready = true; pending = [];
    notify();
    return;
  }
  const { fsM, db } = fb;
  ref = fsM.doc(db, 'users', user.uid);
  api.user = { email: user.email, uid: user.uid };
  api.status = 'connecting';
  // 합치기가 끝나기 전에는 클라우드 값으로 이 기기 기록을 덮어쓰지 않아요
  let merged = await mergeOnLogin(user.uid);
  let lastSnap = null;
  api.ready = true;
  const ops = pending.splice(0);
  if (ops.length) apply(ops);
  notify();
  unsub = fsM.onSnapshot(ref, { includeMetadataChanges: true }, snap => {
    lastSnap = snap;
    api.status = snap.metadata.hasPendingWrites ? 'saving' : snap.metadata.fromCache ? 'offline' : 'synced';
    if (merged === true) {
      if (snap.exists()) window.CarApp.setRemote(fromRemote(snap.data()));
    } else if (merged === false && !snap.metadata.fromCache) {
      // 인터넷이 연결됐으니 이제 합치기
      merged = 'running';
      mergeOnLogin(user.uid).then(ok => {
        merged = ok;
        if (ok && lastSnap && lastSnap.exists()) window.CarApp.setRemote(fromRemote(lastSnap.data()));
      });
    }
    notify();
  }, err => { console.error(err); api.status = 'error'; notify(); });
}

// 로그인할 때(로그아웃 상태 → 로그인): 이 기기의 기록을 클라우드와 합쳐요.
// 원칙: 아무것도 지우지 않고, 빈칸은 채우고, 같은 기록이면 더 최근에 고친 쪽을 남겨요.
const SESSION_KEY = 'carlog-session-uid';
const isEmpty = v => v === '' || v === null || v === undefined || v === false || v === 0;

function mergePatch(local, r) {
  const patch = {};
  // 1) 주유·정비·보험·세금 기록: 클라우드에 없거나, 이 기기 쪽이 더 최근에 고친 기록이면 올림
  for (const k of KINDS) {
    const have = (r && r[k]) || {};
    for (const rec of local[k]) {
      const rem = have[rec.id];
      if (!rem || (rec.updatedAt || 0) > (rem.updatedAt || 0)) (patch[k] = patch[k] || {})[rec.id] = clean(rec);
    }
  }
  // 2) 차량 정보: 클라우드에서 비어 있는 칸만 이 기기 값으로 채움
  const rc = (r && r.car) || {};
  const car = {};
  for (const [f, v] of Object.entries(local.car || {})) if (!isEmpty(v) && isEmpty(rc[f])) car[f] = v;
  if (Object.keys(car).length) patch.car = car;
  // 3) 소모품 항목: 클라우드에 없는 항목은 추가, 있는 항목은 빈칸만 채움
  const remoteIv = Array.isArray(r && r.intervals) ? clean(r.intervals) : null;
  if (!remoteIv) patch.intervals = clean(local.intervals);
  else {
    let changed = false;
    for (const li of local.intervals) {
      const ri = remoteIv.find(x => x.item === li.item);
      if (!ri) { remoteIv.push(clean(li)); changed = true; continue; }
      // 클라우드 값이 비어 있거나 처음 기본값 그대로면 이 기기에서 바꾼 값을 씀
      const def = ((window.CarApp && window.CarApp.defaultIntervals) || []).find(d => d.item === li.item);
      for (const [f, v] of Object.entries(li)) {
        if (f === 'lastUnknown' || isEmpty(v) || v === ri[f]) continue;
        if (isEmpty(ri[f]) || (def && f in def && ri[f] === def[f])) { ri[f] = v; changed = true; }
      }
      if (li.lastUnknown && !ri.lastDate && !ri.lastUnknown) { ri.lastUnknown = true; changed = true; }
    }
    if (changed) patch.intervals = remoteIv;
  }
  return patch;
}

async function mergeOnLogin(uid) {
  let prev = null;
  try { prev = localStorage.getItem(SESSION_KEY); } catch (e) {}
  if (prev === uid) return true; // 계속 로그인 상태였던 기기: 이미 클라우드와 같음
  const { fsM } = fb;
  const local = window.CarApp.getState();
  const fail = e => { console.error(e); api.status = 'error'; notify(); };
  let remote = null, known = false;
  try { const snap = await fsM.getDoc(ref); known = true; remote = snap.exists() ? snap.data() : null; }
  catch (e) { console.warn('클라우드를 읽지 못해서 이 기기 기록을 그대로 올려요', e); }
  if (known) {
    const patch = mergePatch(local, remote);
    if (Object.keys(patch).length) fsM.setDoc(ref, patch, { merge: true }).catch(fail);
  } else {
    // 오프라인: 클라우드 내용을 모르니 기록만 안전하게 올리고(지우지 않음), 다음에 다시 합침
    const patch = {};
    for (const k of KINDS) for (const rec of local[k]) (patch[k] = patch[k] || {})[rec.id] = clean(rec);
    if (Object.keys(patch).length) fsM.setDoc(ref, patch, { merge: true }).catch(fail);
    return false;
  }
  try { localStorage.setItem(SESSION_KEY, uid); } catch (e) {}
  return true;
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
