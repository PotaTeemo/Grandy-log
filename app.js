'use strict';

/* ================= 데이터 ================= */
const KEY = 'carlog-v1';

const DEFAULT_INTERVALS = [
  { item: '엔진오일', km: 10000, months: 12 },
  { item: '에어컨 필터', km: 10000, months: 12 },
  { item: '에어 필터', km: 20000, months: 24 },
  { item: '와이퍼', km: 0, months: 12 },
  { item: '브레이크 패드', km: 40000, months: 0 },
  { item: '냉각수', km: 40000, months: 48 },
  { item: '배터리', km: 0, months: 48 },
  { item: '타이어', km: 50000, months: 60 },
  { item: '미션오일', km: 60000, months: 0 },
];
const EXTRA_ITEMS = ['정기점검', '타이어 위치교환', '세차/광택', '사고 수리', '기타'];
const INS_TYPES = ['자동차보험(종합)', '자동차보험(책임)', '운전자보험', '긴급출동 특약', '기타'];
const TAX_PERIODS = ['1기분 (6월)', '2기분 (12월)', '연납 (1월)', '연납 (3월)', '연납 (6월)', '연납 (9월)', '기타'];

function defaults() {
  return {
    version: 1,
    car: { name: '', plate: '', year: '', fuelType: '휘발유', odo: 0 },
    fuel: [], maint: [], insurance: [], tax: [],
    intervals: DEFAULT_INTERVALS.map(x => ({ ...x })),
  };
}
function normalize(s) {
  const d = defaults();
  const out = { ...d, ...s, car: { ...d.car, ...(s.car || {}) } };
  for (const k of ['fuel', 'maint', 'insurance', 'tax', 'intervals']) if (!Array.isArray(out[k])) out[k] = d[k];
  return out;
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { console.error(e); }
  return defaults();
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { alert('저장에 실패했어요: ' + e.message); }
}
// 기록을 바꾼 뒤 호출: 이 기기에 저장 + (로그인 중이면) 클라우드에 전송
function commit(ops) {
  save();
  if (!ops || !ops.length) return;
  if (window.CarSync) window.CarSync.apply(ops);
  else (window.__carOps = window.__carOps || []).push(...ops);
}
// 새 기록 추가 또는 기존 기록 수정
function upsert(kind, rec, v) {
  v = { ...v, updatedAt: Date.now() }; // 기기끼리 합칠 때 더 최근 것을 고르기 위한 시각
  let cur = rec && S[kind].find(r => r.id === rec.id);
  if (cur) Object.assign(cur, v);
  else { cur = { id: uid(), ...v }; S[kind].push(cur); }
  return [{ t: 'put', kind, rec: cur }];
}
function remove(kind, rec) {
  S[kind] = S[kind].filter(r => r.id !== rec.id);
  return [{ t: 'del', kind, id: rec.id }];
}
// sync.js 와 주고받는 연결부
let remoteDirty = false;
window.CarApp = {
  getState: () => S,
  defaultIntervals: DEFAULT_INTERVALS,
  setRemote(data) {
    S = normalize(data); save();
    if (sheetCtx) remoteDirty = true; else render();
  },
  onSync() {
    updateSyncBadge();
    if (tab === 'settings' && !sheetCtx) render();
  },
};
const SYNC_LABEL = {
  connecting: '🔄 연결 중',
  synced: '✅ 동기화됨',
  saving: '⏳ 저장 중',
  offline: '📴 오프라인 · 연결되면 자동 저장',
  error: '⚠️ 동기화 오류',
};
function updateSyncBadge() {
  const b = document.getElementById('syncBadge'); if (!b) return;
  const c = window.CarSync;
  if (!c || !c.user) { b.hidden = true; return; }
  b.hidden = false;
  b.textContent = { synced: '☁️', saving: '⏳', offline: '📴', error: '⚠️', connecting: '🔄' }[c.status] || '☁️';
  b.title = SYNC_LABEL[c.status] || '';
}
// 홈 화면 앱의 데이터를 오래 보관하도록 요청
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ================= 유틸 ================= */
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
const manwon = n => n >= 10000 ? (Math.round(n / 1000) / 10).toLocaleString('ko-KR') + '만' : Math.round(n).toLocaleString('ko-KR');
const km = n => Math.round(n).toLocaleString('ko-KR') + 'km';
function today() { const d = new Date(); return ymd(d); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseD(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function addMonths(s, m) { const d = parseD(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + m); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return ymd(d); }
function daysUntil(s) { return Math.round((parseD(s) - parseD(today())) / 86400000); }
function fmtDate(s) { if (!s) return ''; const [y, m, d] = s.split('-'); return `${y}.${m}.${d}`; }
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (num(b.odo) - num(a.odo));

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 1800);
}

/* ================= 계산 ================= */
function currentOdo() {
  let m = num(S.car.odo);
  for (const r of S.fuel) m = Math.max(m, num(r.odo));
  for (const r of S.maint) m = Math.max(m, num(r.odo));
  return m;
}

// 가득 주유 사이 구간으로 연비 계산
function fuelStats() {
  const list = S.fuel.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || num(a.odo) - num(b.odo));
  const effById = {};
  let lastFull = null, liters = 0, totKm = 0, totL = 0;
  for (const r of list) {
    // 주행거리나 주유량을 모르는 기록이 끼면 그 구간은 연비를 계산할 수 없어서 새로 시작
    if (!(num(r.odo) > 0) || !(num(r.liters) > 0)) { lastFull = null; liters = 0; continue; }
    if (lastFull) liters += num(r.liters);
    if (r.full) {
      if (lastFull && liters > 0 && num(r.odo) > num(lastFull.odo)) {
        const d = num(r.odo) - num(lastFull.odo);
        effById[r.id] = d / liters;
        totKm += d; totL += liters;
      }
      lastFull = r; liters = 0;
    }
  }
  const sortedEff = list.filter(r => effById[r.id]).map(r => effById[r.id]);
  return {
    effById,
    avg: totL > 0 ? totKm / totL : null,
    recent: sortedEff.length ? sortedEff[sortedEff.length - 1] : null,
  };
}

// 마지막 교체: 정비 기록과 직접 입력한 '마지막 교체일' 중 더 최근 것
function lastReplacement(iv) {
  const recs = S.maint.filter(r => r.item === iv.item).sort(byDateDesc);
  let last = recs[0] ? { date: recs[0].date, odo: num(recs[0].odo), src: 'record' } : null;
  if (!iv.lastUnknown && iv.lastDate && (!last || iv.lastDate > last.date)) {
    last = { date: iv.lastDate, odo: num(iv.lastOdo), src: 'manual' };
  }
  return last;
}

function maintStatus() {
  const odo = currentOdo();
  return S.intervals.map(iv => {
    const last = lastReplacement(iv);
    if (!last) return { ...iv, last: null, level: iv.lastUnknown ? 'unknown' : 'none' };
    let kmLeft = null, daysLeft = null, ratio = 0, dueDate = null;
    if (num(iv.km) > 0 && num(last.odo) > 0) {
      kmLeft = num(last.odo) + num(iv.km) - odo;
      ratio = Math.max(ratio, (odo - num(last.odo)) / num(iv.km));
    }
    if (num(iv.months) > 0) {
      dueDate = addMonths(last.date, num(iv.months));
      daysLeft = daysUntil(dueDate);
      const total = Math.max(1, (parseD(dueDate) - parseD(last.date)) / 86400000);
      ratio = Math.max(ratio, 1 - daysLeft / total);
    }
    let level = 'ok';
    if ((kmLeft !== null && kmLeft < 0) || (daysLeft !== null && daysLeft < 0)) level = 'bad';
    else if ((kmLeft !== null && kmLeft <= 1000) || (daysLeft !== null && daysLeft <= 30)) level = 'warn';
    return { ...iv, last, kmLeft, daysLeft, dueDate, ratio: Math.min(1, Math.max(0, ratio)), level };
  });
}

function currentInsurance() {
  const t = today();
  const active = S.insurance.filter(r => r.start <= t && t <= r.end);
  return active;
}

// 월별 지출 (보험은 월 보험료를 보장기간 동안 매달 반영)
function monthKey(s) { return s.slice(0, 7); }
function spendByMonth(keys) {
  const res = {};
  for (const k of keys) res[k] = { fuel: 0, maint: 0, ins: 0, tax: 0 };
  for (const r of S.fuel) { const k = monthKey(r.date || ''); if (res[k]) res[k].fuel += num(r.amount); }
  for (const r of S.maint) { const k = monthKey(r.date || ''); if (res[k]) res[k].maint += num(r.cost); }
  for (const r of S.tax) { const k = monthKey(r.date || ''); if (res[k]) res[k].tax += num(r.amount); }
  for (const r of S.insurance) {
    if (!r.start || !r.end) continue;
    const s = monthKey(r.start), e = monthKey(r.end);
    for (const k of keys) if (k >= s && k <= e) res[k].ins += num(r.monthly);
  }
  return res;
}
function lastMonths(n) {
  const d = new Date(); d.setDate(1);
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(ymd(x).slice(0, 7)); }
  return out;
}
function yearMonths(y) { return Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`); }
const sumObj = o => o.fuel + o.maint + o.ins + o.tax;

function taxStatus(year) {
  const recs = S.tax.filter(r => String(r.year) === String(year));
  const has = p => recs.some(r => r.period.startsWith(p));
  const annual = recs.some(r => r.period.startsWith('연납'));
  return { recs, first: annual || has('1기'), second: annual || has('2기'), annual, total: recs.reduce((a, r) => a + num(r.amount), 0) };
}

/* ================= 렌더 ================= */
let tab = 'home';
const TITLES = { home: '내 차 관리', fuel: '주유 기록', maint: '정비 기록', money: '보험 · 자동차세', settings: '설정' };

function render() {
  $('#title').textContent = TITLES[tab];
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#main').innerHTML = VIEWS[tab]();
}

const VIEWS = {
  home() {
    const odo = currentOdo();
    const fs = fuelStats();
    const months = lastMonths(6);
    const sp = spendByMonth(months);
    const thisMonth = sumObj(sp[months[months.length - 1]]);
    const y = new Date().getFullYear();
    const ySp = spendByMonth(yearMonths(y));
    const yTot = { fuel: 0, maint: 0, ins: 0, tax: 0 };
    for (const k in ySp) for (const c in yTot) yTot[c] += ySp[k][c];
    const yearSum = sumObj(yTot);

    // 알림
    const alerts = [];
    if (!S.car.name) alerts.push({ lv: 'ok', t: '차량 정보를 먼저 등록해 주세요', s: '설정 탭에서 차 이름과 주행거리를 입력할 수 있어요', go: 'settings' });
    const unknownN = maintStatus().filter(m => m.level === 'unknown').length;
    if (unknownN) alerts.push({ lv: 'ok', t: `교체 시기를 모르는 항목 ${unknownN}개`, s: '다음 정비 때 확인해서 기록해 두세요', go: 'maint' });
    for (const m of maintStatus()) {
      if (m.level === 'bad' || m.level === 'warn') {
        const parts = [];
        if (m.kmLeft !== null) parts.push(m.kmLeft < 0 ? `${km(-m.kmLeft)} 초과` : `${km(m.kmLeft)} 남음`);
        if (m.daysLeft !== null) parts.push(m.daysLeft < 0 ? `${-m.daysLeft}일 지남` : `${m.daysLeft}일 남음`);
        alerts.push({ lv: m.level, t: `${m.item} 교체 ${m.level === 'bad' ? '시기가 지났어요' : '시기가 다가와요'}`, s: parts.join(' · '), go: 'maint' });
      }
    }
    for (const r of S.insurance) {
      const d = daysUntil(r.end);
      if (d >= 0 && d <= 30 && !S.insurance.some(o => o !== r && o.type === r.type && o.start > r.start)) {
        alerts.push({ lv: d <= 7 ? 'bad' : 'warn', t: `${r.type} 만기 D-${d}`, s: `${r.company || ''} · ${fmtDate(r.end)} 만기`, go: 'money' });
      }
    }
    const now = new Date(); const ts = taxStatus(now.getFullYear()); const mo = now.getMonth() + 1;
    if (mo === 6 && !ts.first) alerts.push({ lv: 'warn', t: '자동차세 1기분 납부 기간이에요', s: '6월 16일 ~ 6월 30일', go: 'money' });
    if (mo === 12 && !ts.second) alerts.push({ lv: 'warn', t: '자동차세 2기분 납부 기간이에요', s: '12월 16일 ~ 12월 31일', go: 'money' });

    const maxM = Math.max(1, ...months.map(k => sumObj(sp[k])));
    const C = { fuel: 'var(--fuel)', maint: 'var(--maint)', ins: 'var(--ins)', tax: 'var(--tax)' };
    const N = { fuel: '주유', maint: '정비', ins: '보험', tax: '자동차세' };

    return `
      <div class="card car-hero">
        <div class="name">${esc(S.car.name || '내 차')}</div>
        <div class="meta">${esc([S.car.plate, S.car.year && S.car.year + '년식', S.car.fuelType].filter(Boolean).join(' · ') || '설정에서 차량 정보를 입력하세요')}</div>
        <div class="odo">${Math.round(odo).toLocaleString('ko-KR')} <small>km</small></div>
      </div>

      ${alerts.length ? `<div class="section-title">알림</div>` + alerts.map(a => `
        <div class="alert ${a.lv}" data-go="${a.go}"><div>${a.lv === 'bad' ? '🚨' : a.lv === 'warn' ? '⚠️' : '👋'}</div>
        <div><b>${esc(a.t)}</b><span class="muted">${esc(a.s)}</span></div></div>`).join('') : ''}

      <div class="grid2">
        <div class="card stat"><div class="label">이번 달 지출</div><div class="value">${manwon(thisMonth)}<small>원</small></div></div>
        <div class="card stat"><div class="label">${y}년 누적 지출</div><div class="value">${manwon(yearSum)}<small>원</small></div></div>
        <div class="card stat"><div class="label">평균 연비</div><div class="value">${fs.avg ? fs.avg.toFixed(1) : '-'}<small> km/L</small></div></div>
        <div class="card stat"><div class="label">최근 연비</div><div class="value">${fs.recent ? fs.recent.toFixed(1) : '-'}<small> km/L</small></div></div>
      </div>

      <div class="card">
        <h2>월별 지출 <span class="right">최근 6개월</span></h2>
        <div class="chart">
          ${months.map(k => {
            const o = sp[k], tot = sumObj(o);
            return `<div class="col">
              <div class="amt">${tot ? manwon(tot) : ''}</div>
              <div class="stack" style="height:${Math.max(2, tot / maxM * 100)}%">
                ${['fuel', 'maint', 'ins', 'tax'].map(c => o[c] ? `<i style="height:${o[c] / (tot || 1) * 100}%;background:${C[c]}"></i>` : '').join('')}
              </div>
              <div class="lbl">${Number(k.slice(5))}월</div></div>`;
          }).join('')}
        </div>
        <div class="legend">${Object.keys(N).map(c => `<span style="--c:${C[c]}">${N[c]}</span>`).join('')}</div>
      </div>

      <div class="card">
        <h2>${y}년 항목별 지출</h2>
        ${Object.keys(N).map(c => `
          <div class="cat-row" style="--c:${C[c]}">
            <span class="n">${N[c]}</span>
            <span class="bar"><i style="width:${yearSum ? yTot[c] / yearSum * 100 : 0}%"></i></span>
            <span class="v">${won(yTot[c])}</span>
          </div>`).join('')}
        <p class="muted" style="margin:8px 0 0">보험은 월 보험료를 보장 기간 동안 매달 나눠 계산해요.</p>
      </div>
    `;
  },

  fuel() {
    const fs = fuelStats();
    const list = S.fuel.slice().sort(byDateDesc);
    const y = String(new Date().getFullYear());
    const yr = S.fuel.filter(r => (r.date || '').startsWith(y));
    const yAmt = yr.reduce((a, r) => a + num(r.amount), 0);
    const yL = yr.reduce((a, r) => a + num(r.liters), 0);
    return `
      <div class="grid2">
        <div class="card stat"><div class="label">평균 연비</div><div class="value">${fs.avg ? fs.avg.toFixed(1) : '-'}<small> km/L</small></div></div>
        <div class="card stat"><div class="label">올해 주유비</div><div class="value">${manwon(yAmt)}<small>원 · ${yL.toFixed(0)}L</small></div></div>
      </div>
      <div class="section-title">주유 내역 <button class="add-btn" data-act="add-fuel">+ 주유 추가</button></div>
      ${list.length ? `<div class="list">${list.map(r => {
        const eff = fs.effById[r.id];
        const unit = num(r.unitPrice) || (num(r.liters) > 0 ? num(r.amount) / num(r.liters) : 0);
        const info = [
          num(r.odo) > 0 ? km(num(r.odo)) : '',
          num(r.liters) > 0 ? num(r.liters).toFixed(2) + 'L' : '',
          unit ? Math.round(unit).toLocaleString() + '원/L' : '',
          r.station ? esc(r.station) : '',
        ].filter(Boolean).join(' · ');
        return `<button class="row" data-act="edit-fuel" data-id="${r.id}">
          <div class="main"><div class="t">${fmtDate(r.date)} ${r.full ? '' : '<span class="badge gray">부분</span>'}</div>
          <div class="s">${info || '&nbsp;'}</div></div>
          <div class="r"><div class="t">${won(num(r.amount))}</div><div class="s">${eff ? eff.toFixed(1) + ' km/L' : ''}</div></div>
        </button>`;
      }).join('')}</div>` : `<div class="card empty">아직 주유 기록이 없어요.<br>가득 주유를 두 번 이상 기록하면 연비가 계산돼요.</div>`}
      <p class="muted">연비는 '가득 주유'와 다음 '가득 주유' 사이에 넣은 기름 양으로 계산해요. 주행거리나 리터당 가격을 비워둔 기록이 끼어 있으면 그 구간은 연비를 계산하지 않아요.</p>
    `;
  },

  maint() {
    const st = maintStatus();
    const list = S.maint.slice().sort(byDateDesc);
    const yAmt = S.maint.filter(r => (r.date || '').startsWith(String(new Date().getFullYear()))).reduce((a, r) => a + num(r.cost), 0);
    return `
      <div class="section-title">소모품 교체 주기 <button class="add-btn" data-act="add-interval">+ 항목 추가</button></div>
      <div class="list">${st.map((m, i) => {
        let sub = '마지막 교체: 미입력 · 눌러서 입력해 주세요';
        let next = '';
        let badge = '<span class="badge gray">미입력</span>';
        if (m.level === 'unknown') {
          sub = '마지막 교체: 모름';
          next = '다음 정비 때 상태를 확인해 보세요';
          badge = '<span class="badge warn">모름</span>';
        }
        if (m.last) {
          const parts = [];
          if (m.kmLeft !== null) parts.push(m.kmLeft < 0 ? `${km(-m.kmLeft)} 초과` : `${km(m.kmLeft)} 남음`);
          if (m.dueDate) parts.push(m.daysLeft < 0 ? `${fmtDate(m.dueDate)} (지남)` : `${fmtDate(m.dueDate)}까지`);
          sub = `마지막 교체: ${fmtDate(m.last.date)}${m.last.odo ? ' · ' + km(m.last.odo) : ''}${m.last.src === 'manual' ? ' (직접 입력)' : ''}`;
          next = parts.length ? '다음 교체: ' + parts.join(' · ') : '';
          badge = m.level === 'bad' ? '<span class="badge bad">교체 필요</span>' : m.level === 'warn' ? '<span class="badge warn">곧 교체</span>' : '<span class="badge ok">양호</span>';
        }
        const cycle = [num(m.km) ? km(m.km) : '', num(m.months) ? m.months + '개월' : ''].filter(Boolean).join(' / ');
        return `<button class="row" data-act="edit-interval" data-idx="${i}">
          <div class="main"><div class="t">${esc(m.item)} <span class="muted" style="font-weight:400">${cycle}</span></div>
          <div class="s">${sub}</div>${next ? `<div class="s">${next}</div>` : ''}
          ${m.product || m.spec ? `<div class="s">📝 ${esc([m.product, m.spec].filter(Boolean).join(' · '))}</div>` : ''}
          ${m.last ? `<div class="progress ${m.level === 'ok' ? '' : m.level}"><i style="width:${(m.ratio * 100).toFixed(0)}%"></i></div>` : ''}</div>
          <div class="r">${badge}</div>
        </button>`;
      }).join('')}</div>
      <p class="muted" style="margin-top:-4px">항목을 누르면 교체 주기와 마지막 교체 시기를 입력하거나, 교체 기록을 바로 남길 수 있어요.</p>

      <div class="section-title"><span>정비 내역 <span style="font-weight:400">· 올해 ${won(yAmt)}</span></span> <button class="add-btn" data-act="add-maint">+ 정비 추가</button></div>
      ${list.length ? `<div class="list">${list.map(r => `
        <button class="row" data-act="edit-maint" data-id="${r.id}">
          <div class="main"><div class="t">${esc(r.item)}</div>
          <div class="s">${fmtDate(r.date)}${num(r.odo) ? ' · ' + km(num(r.odo)) : ''}${r.shop ? ' · ' + esc(r.shop) : ''}${r.memo ? ' · ' + esc(r.memo) : ''}</div></div>
          <div class="r"><div class="t">${won(num(r.cost))}</div></div>
        </button>`).join('')}</div>` : `<div class="card empty">아직 정비 기록이 없어요.</div>`}
    `;
  },

  money() {
    const active = currentInsurance();
    const insList = S.insurance.slice().sort((a, b) => (b.start || '').localeCompare(a.start || ''));
    const monthlyTotal = active.reduce((a, r) => a + num(r.monthly), 0);
    const y = new Date().getFullYear();
    const ts = taxStatus(y);
    const taxList = S.tax.slice().sort(byDateDesc);
    const chip = (ok, label) => `<span class="badge ${ok ? 'ok' : 'gray'}">${label} ${ok ? '납부 ✓' : '미납'}</span>`;
    return `
      <div class="section-title">보험 <button class="add-btn" data-act="add-ins">+ 보험 추가</button></div>
      <div class="card">
        <h2>현재 가입 중 <span class="right">월 ${won(monthlyTotal)} · 연 ${won(monthlyTotal * 12)}</span></h2>
        ${active.length ? active.map(r => {
          const d = daysUntil(r.end);
          return `<div class="kv"><span>${esc(r.type)}</span><span><b>${won(num(r.monthly))}</b>/월 · <span class="badge ${d <= 7 ? 'bad' : d <= 30 ? 'warn' : ''}">D-${d}</span></span></div>`;
        }).join('') : '<div class="muted">현재 보장 기간 안에 있는 보험이 없어요.</div>'}
      </div>
      ${insList.length ? `<div class="list">${insList.map(r => {
        const t = today(); const on = r.start <= t && t <= r.end;
        return `<button class="row" data-act="edit-ins" data-id="${r.id}">
          <div class="main"><div class="t">${esc(r.type)} ${on ? '<span class="badge ok">가입중</span>' : (r.end < t ? '<span class="badge gray">만료</span>' : '<span class="badge">예정</span>')}</div>
          <div class="s">${esc(r.company || '')} · ${fmtDate(r.start)} ~ ${fmtDate(r.end)}</div></div>
          <div class="r"><div class="t">${won(num(r.monthly))}</div><div class="s">월 보험료</div></div>
        </button>`;
      }).join('')}</div>` : ''}

      <div class="section-title">자동차세 <button class="add-btn" data-act="add-tax">+ 납부 추가</button></div>
      <div class="card">
        <h2>${y}년 납부 현황 <span class="right">합계 ${won(ts.total)}</span></h2>
        <div class="chips">${ts.annual ? '<span class="badge ok">연납 완료 ✓</span>' : chip(ts.first, '1기(6월)') + chip(ts.second, '2기(12월)')}</div>
        <p class="muted" style="margin:10px 0 0">1월에 연납하면 할인돼요. 1기 6/16~6/30, 2기 12/16~12/31.</p>
      </div>
      ${taxList.length ? `<div class="list">${taxList.map(r => `
        <button class="row" data-act="edit-tax" data-id="${r.id}">
          <div class="main"><div class="t">${esc(r.year)}년 ${esc(r.period)}</div>
          <div class="s">${fmtDate(r.date)} 납부${r.memo ? ' · ' + esc(r.memo) : ''}</div></div>
          <div class="r"><div class="t">${won(num(r.amount))}</div></div>
        </button>`).join('')}</div>` : `<div class="card empty">아직 자동차세 납부 기록이 없어요.</div>`}
    `;
  },

  settings() {
    return `
      <div class="section-title">차량 정보</div>
      <div class="list"><button class="row" data-act="edit-car">
        <div class="main"><div class="t">${esc(S.car.name || '차량 정보 입력')}</div>
        <div class="s">${esc([S.car.plate, S.car.year && S.car.year + '년식', S.car.fuelType].filter(Boolean).join(' · '))} · 현재 ${km(currentOdo())}</div></div>
        <div class="r muted">수정 ›</div></button></div>

      <div class="section-title">소모품 교체 주기 <button class="add-btn" data-act="add-interval">+ 항목 추가</button></div>
      <div class="list">${S.intervals.map((iv, i) => `
        <button class="row" data-act="edit-interval" data-idx="${i}">
          <div class="main"><div class="t">${esc(iv.item)}</div></div>
          <div class="r muted">${[num(iv.km) ? km(iv.km) : '', num(iv.months) ? iv.months + '개월' : ''].filter(Boolean).join(' / ') || '주기 없음'} ›</div>
        </button>`).join('')}</div>

      <div class="section-title">클라우드 동기화</div>
      ${syncCardHtml()}

      <div class="section-title">백업</div>
      <div class="card">
        <p class="muted" style="margin-top:0">${window.CarSync && window.CarSync.user ? '기록은 클라우드에 저장되고 있어요. 그래도 가끔 백업 파일을 저장해 두면 더 안전해요.' : '로그인하지 않으면 기록은 이 기기 안에만 저장돼요. 휴대폰을 바꾸거나 앱을 지우기 전에 꼭 백업 파일을 저장해 두세요.'} (파일 앱 · iCloud Drive에 저장 가능)</p>
        <button class="btn" data-act="export">백업 파일 저장</button>
        <button class="btn secondary" data-act="import">백업 파일 불러오기</button>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
      </div>
      <div class="card">
        <button class="btn danger" data-act="reset">모든 기록 지우기</button>
      </div>
      <p class="muted" style="text-align:center">기록 ${S.fuel.length + S.maint.length + S.insurance.length + S.tax.length}건 · v1.7</p>
    `;
  },
};

/* ================= 입력 시트 ================= */
let sheetCtx = null;
function openSheet({ title, fields, values = {}, onSave, onDelete, saveLabel = '저장', doneMsg = '저장했어요', extraHtml = '' }) {
  sheetCtx = { fields, onSave, onDelete, doneMsg };
  const f = fields.map(fd => {
    if (fd.row) return `<div class="field-row">${fd.row.map(x => fieldHtml(x, values)).join('')}</div>`;
    return fieldHtml(fd, values);
  }).join('');
  $('#sheet').innerHTML = `
    <div class="sheet-head"><button data-sheet="close">취소</button><h3>${esc(title)}</h3><button data-sheet="save"><b>${saveLabel}</b></button></div>
    <form id="sheetForm" autocomplete="off">${f}
      <button class="btn" type="submit">${saveLabel}</button>
      ${extraHtml}
      ${onDelete ? '<button class="btn danger" type="button" data-sheet="delete">삭제</button>' : ''}
    </form>`;
  $('#backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  sheetCtx.initial = JSON.stringify(readForm()); // 처음 값 (바뀌었는지 비교용)
}
function sheetDirty() {
  return !!sheetCtx && !!$('#sheetForm') && JSON.stringify(readForm()) !== sheetCtx.initial;
}
// 취소·바깥 누르기로 닫을 때: 입력한 게 있으면 한 번 물어봄
function requestClose() {
  if (sheetDirty() && !confirm('입력하던 내용이 사라져요. 닫을까요?')) return;
  closeSheet();
}
function fieldHtml(fd, values) {
  const v = values[fd.name] ?? fd.value ?? '';
  const id = 'f_' + fd.name;
  const req = fd.required ? 'required' : '';
  const hint = fd.hint ? `<div class="hint">${esc(fd.hint)}</div>` : '';
  if (fd.type === 'check') return `<div class="field check"><label><input type="checkbox" name="${fd.name}" ${v ? 'checked' : ''}> ${esc(fd.label)}</label>${hint}</div>`;
  let input;
  if (fd.type === 'select') input = `<select id="${id}" name="${fd.name}" ${req}>${fd.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (fd.type === 'textarea') input = `<textarea id="${id}" name="${fd.name}" placeholder="${esc(fd.ph || '')}">${esc(v)}</textarea>`;
  else if (fd.type === 'num') input = `<input id="${id}" name="${fd.name}" type="text" inputmode="${fd.decimal ? 'decimal' : 'numeric'}" value="${esc(v)}" placeholder="${esc(fd.ph || '')}" ${req}>`;
  else if (fd.type === 'list') input = `<input id="${id}" name="${fd.name}" list="${id}_dl" value="${esc(v)}" placeholder="${esc(fd.ph || '')}" ${req}><datalist id="${id}_dl">${fd.options.map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
  else input = `<input id="${id}" name="${fd.name}" type="${fd.type || 'text'}" value="${esc(v)}" placeholder="${esc(fd.ph || '')}" ${fd.ac ? `autocomplete="${fd.ac}" autocapitalize="none"` : ''} ${req}>`;
  return `<div class="field"><label for="${id}">${esc(fd.label)}</label>${input}${hint}</div>`;
}
function closeSheet() {
  $('#backdrop').hidden = true; $('#sheet').innerHTML = ''; sheetCtx = null; document.body.style.overflow = '';
  if (remoteDirty) { remoteDirty = false; render(); }
}
function readForm() {
  const form = $('#sheetForm'); const out = {};
  const all = sheetCtx.fields.flatMap(f => f.row || [f]);
  for (const fd of all) {
    const el = form.querySelector(`[name="${fd.name}"]`);
    if (!el) continue;
    if (fd.type === 'check') out[fd.name] = el.checked;
    else if (fd.type === 'num') out[fd.name] = String(el.value).trim() === '' ? '' : num(el.value);
    else out[fd.name] = el.value.trim();
  }
  return out;
}
// onSave 는 오류 문구(문자열) 또는 변경 목록(배열)을 돌려줘요. 로그인처럼 기다려야 하면 Promise.
let sheetBusy = false;
async function submitSheet() {
  if (sheetBusy || !sheetCtx) return;
  const form = $('#sheetForm');
  if (!form.reportValidity()) return;
  const ctx = sheetCtx;
  let r = ctx.onSave(readForm());
  if (r && typeof r.then === 'function') {
    sheetBusy = true;
    $('#sheet').querySelectorAll('button').forEach(b => (b.disabled = true));
    try { r = await r; } finally {
      sheetBusy = false;
      $('#sheet').querySelectorAll('button').forEach(b => (b.disabled = false));
    }
    if (sheetCtx !== ctx) return;
  }
  if (typeof r === 'string') { alert(r); return; }
  commit(r); closeSheet(); render(); toast(ctx.doneMsg);
}

/* --- 각 기록 폼 --- */
function fuelForm(rec) {
  const isNew = !rec;
  // 예전 기록(주유량만 있는 기록)은 리터당 가격을 계산해서 보여줌
  const prefillPrice = rec ? (rec.unitPrice || (num(rec.liters) > 0 ? Math.round(num(rec.amount) / num(rec.liters)) : '')) : '';
  openSheet({
    title: isNew ? '주유 기록' : '주유 수정',
    values: rec ? { ...rec, unitPrice: prefillPrice } : { date: today(), full: true, odo: '' },
    fields: [
      { name: 'date', label: '날짜', type: 'date', required: true },
      { row: [
        { name: 'amount', label: '금액 (원)', type: 'num', required: true, ph: '50000' },
        { name: 'unitPrice', label: '리터당 가격 (원, 선택)', type: 'num', ph: '1650' },
      ] },
      { name: 'odo', label: '주행거리 (km, 선택)', type: 'num', ph: `현재 ${Math.round(currentOdo()).toLocaleString()}`, hint: '계기판의 누적 주행거리(ODO)예요. 주행거리와 리터당 가격을 넣고 가득 주유하면 연비가 계산돼요' },
      { name: 'full', label: '가득 주유 (연비 계산에 사용)', type: 'check' },
      { name: 'station', label: '주유소 (선택)', ph: 'OO주유소' },
      { name: 'memo', label: '메모 (선택)', type: 'textarea' },
    ],
    onSave(v) {
      if (!(v.amount > 0)) return '금액을 입력해 주세요';
      // 주유량 = 금액 ÷ 리터당 가격 (예전 기록을 그대로 저장하면 원래 주유량 유지)
      const unchanged = rec && !rec.unitPrice && v.unitPrice === prefillPrice && v.amount === num(rec.amount);
      v.liters = unchanged ? rec.liters : v.unitPrice > 0 ? Math.round(v.amount / v.unitPrice * 100) / 100 : '';
      return upsert('fuel', rec, v);
    },
    onDelete: isNew ? null : () => remove('fuel', rec),
  });
}
function maintForm(rec, presetItem) {
  const isNew = !rec;
  const items = [...S.intervals.map(i => i.item), ...EXTRA_ITEMS];
  openSheet({
    title: isNew ? '정비 기록' : '정비 수정',
    values: rec || { date: today(), item: presetItem || '', odo: currentOdo() || '' },
    fields: [
      { name: 'item', label: '정비 항목', type: 'list', options: items, required: true, ph: '목록에서 선택하거나 직접 입력', hint: '교체 주기에 있는 이름과 똑같이 입력하면 다음 교체 시기가 계산돼요' },
      { name: 'date', label: '날짜', type: 'date', required: true },
      { row: [
        { name: 'odo', label: '주행거리 (km)', type: 'num' },
        { name: 'cost', label: '비용 (원)', type: 'num', ph: '0' },
      ] },
      { name: 'shop', label: '정비소 (선택)' },
      { name: 'memo', label: '메모 (선택)', type: 'textarea', ph: '부품명, 다음 점검 내용 등' },
    ],
    onSave(v) { return upsert('maint', rec, v); },
    onDelete: isNew ? null : () => remove('maint', rec),
  });
}
function insForm(rec) {
  const isNew = !rec;
  const start = today();
  openSheet({
    title: isNew ? '보험 추가' : '보험 수정',
    values: rec || { type: INS_TYPES[0], start, end: addMonths(start, 12) },
    fields: [
      { name: 'type', label: '보험 종류', type: 'select', options: INS_TYPES },
      { name: 'company', label: '보험사', ph: '예: OO화재' },
      { name: 'monthly', label: '월 보험료 (원)', type: 'num', required: true, hint: '연납이라면 연 보험료 ÷ 12 를 입력하세요' },
      { row: [
        { name: 'start', label: '보장 시작일', type: 'date', required: true },
        { name: 'end', label: '만기일', type: 'date', required: true },
      ] },
      { name: 'memo', label: '메모 (선택)', type: 'textarea', ph: '특약, 증권번호, 긴급출동 번호 등' },
    ],
    onSave(v) {
      if (v.end < v.start) return '만기일이 시작일보다 빨라요';
      return upsert('insurance', rec, v);
    },
    onDelete: isNew ? null : () => remove('insurance', rec),
  });
}
function taxForm(rec) {
  const isNew = !rec;
  const now = new Date();
  const defPeriod = now.getMonth() + 1 <= 3 ? TAX_PERIODS[2] : now.getMonth() + 1 <= 6 ? TAX_PERIODS[0] : TAX_PERIODS[1];
  openSheet({
    title: isNew ? '자동차세 납부' : '자동차세 수정',
    values: rec || { year: now.getFullYear(), period: defPeriod, date: today() },
    fields: [
      { row: [
        { name: 'year', label: '과세 연도', type: 'num', required: true },
        { name: 'period', label: '구분', type: 'select', options: TAX_PERIODS },
      ] },
      { name: 'date', label: '납부일', type: 'date', required: true },
      { name: 'amount', label: '납부 금액 (원)', type: 'num', required: true },
      { name: 'memo', label: '메모 (선택)', ph: '예: 연납 할인 적용' },
    ],
    onSave(v) { return upsert('tax', rec, v); },
    onDelete: isNew ? null : () => remove('tax', rec),
  });
}
function carForm() {
  openSheet({
    title: '차량 정보',
    values: S.car,
    fields: [
      { name: 'name', label: '차 이름', required: true, ph: '예: 아반떼 CN7' },
      { row: [
        { name: 'plate', label: '차량 번호', ph: '12가 3456' },
        { name: 'year', label: '연식', type: 'num', ph: '2022' },
      ] },
      { name: 'fuelType', label: '연료', type: 'select', options: ['휘발유', '경유', 'LPG', '하이브리드', '전기'] },
      { name: 'odo', label: '현재 주행거리 (km)', type: 'num', hint: '주유·정비 기록 중 가장 큰 주행거리가 자동으로 반영돼요' },
    ],
    onSave(v) { Object.assign(S.car, v); return [{ t: 'car' }]; },
  });
}
function intervalForm(idx) {
  const isNew = idx == null;
  const iv = isNew ? null : S.intervals[idx];
  openSheet({
    title: isNew ? '교체 항목 추가' : iv.item,
    values: iv || { km: '', months: '' },
    fields: [
      { name: 'item', label: '항목 이름', required: true },
      { row: [
        { name: 'km', label: '교체 주기 (km)', type: 'num', ph: '0 = 사용 안 함' },
        { name: 'months', label: '교체 주기 (개월)', type: 'num', ph: '0 = 사용 안 함' },
      ] },
      { row: [
        { name: 'lastDate', label: '마지막 교체일', type: 'date' },
        { name: 'lastOdo', label: '그때 주행거리 (km)', type: 'num', ph: '모르면 비워두기' },
      ] },
      { name: 'lastUnknown', label: '언제 교체했는지 모름', type: 'check', hint: '정비 내역에 이 항목 기록이 있으면, 더 최근 날짜가 자동으로 쓰여요' },
      { name: 'product', label: '제품명 (선택)', ph: '예: 모빌1 5W-30' },
      { name: 'spec', label: '스펙 (선택)', ph: '예: 5W-30, 6L / 245/45R18' },
    ],
    extraHtml: isNew ? '' : `<button class="btn secondary" type="button" data-sheet="quick-maint" data-item="${esc(iv.item)}">오늘 교체했어요 · 정비 기록 추가</button>`,
    onSave(v) {
      v.km = num(v.km); v.months = num(v.months);
      if (v.lastUnknown) { v.lastDate = ''; v.lastOdo = ''; }
      if (v.lastDate && v.lastDate > today()) return '마지막 교체일이 오늘보다 뒤예요';
      if (S.intervals.some(x => x.item === v.item && (isNew || x.item !== iv.item))) return `'${v.item}' 항목이 이미 있어요`;
      const ops = [{ t: 'intervals' }];
      if (isNew) S.intervals.push(v);
      else {
        const cur = S.intervals.find(x => x.item === iv.item) || iv;
        // 이름을 바꾸면 기존 정비 기록의 항목 이름도 같이 변경
        if (cur.item !== v.item) S.maint.forEach(r => { if (r.item === cur.item) { r.item = v.item; ops.push({ t: 'put', kind: 'maint', rec: r }); } });
        Object.assign(cur, v);
      }
      return ops;
    },
    onDelete: isNew ? null : () => { S.intervals = S.intervals.filter(x => x.item !== iv.item); return [{ t: 'intervals' }]; },
  });
}

function loginForm() {
  openSheet({
    title: '로그인',
    saveLabel: '로그인',
    doneMsg: '로그인했어요',
    fields: [
      { name: 'email', label: '이메일', type: 'email', ac: 'username', required: true },
      { name: 'password', label: '비밀번호', type: 'password', ac: 'current-password', required: true },
    ],
    extraHtml: '<button class="btn secondary" type="button" data-sheet="reset-pw">비밀번호를 잊었어요</button>',
    onSave(v) { return window.CarSync.login(v.email, v.password).then(err => err || []); },
  });
}

function syncCardHtml() {
  const c = window.CarSync;
  if (!c || !c.ready) {
    return `<div class="card"><div class="muted">클라우드 상태를 확인하는 중…</div></div>`;
  }
  if (!c.configured) {
    return `<div class="card"><div class="muted">클라우드 동기화가 아직 설정되지 않았어요. <b>firebase-config.js</b>에 Firebase 설정값을 넣으면 PC와 아이폰 기록을 자동으로 맞출 수 있어요.</div></div>`;
  }
  if (!c.user) {
    return `<div class="card">
      <p class="muted" style="margin-top:0">로그인하면 PC와 아이폰의 기록이 자동으로 같아져요. 이 기기에 있던 기록은 클라우드에 합쳐져요.</p>
      ${c.status === 'error' ? '<p class="muted">⚠️ 클라우드에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 앱을 다시 열어 주세요.</p>' : ''}
      <button class="btn" data-act="login">로그인</button></div>`;
  }
  return `<div class="card">
    <div class="kv"><span>계정</span><span>${esc(c.user.email)}</span></div>
    <div class="kv"><span>상태</span><span>${SYNC_LABEL[c.status] || ''}</span></div>
    <button class="btn secondary" style="margin-top:12px" data-act="logout">로그아웃</button></div>`;
}

/* ================= 백업 ================= */
async function exportData() {
  const name = `차량관리_백업_${today()}.json`;
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || typeof d !== 'object' || !('car' in d)) throw new Error('형식 오류');
      if (!confirm('지금 기록을 백업 파일 내용으로 바꿀까요? 현재 기록은 사라져요.')) return;
      S = normalize(d); commit([{ t: 'all' }]); render(); toast('불러왔어요');
    } catch (e) { alert('백업 파일을 읽을 수 없어요.'); }
  };
  r.readAsText(file);
}

/* ================= 이벤트 ================= */
$('#tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  tab = b.dataset.tab; render(); window.scrollTo(0, 0);
});
$('#main').addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) { tab = go.dataset.go; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const id = el.dataset.id;
  const find = (arr) => arr.find(r => r.id === id);
  switch (el.dataset.act) {
    case 'add-fuel': return fuelForm();
    case 'edit-fuel': return fuelForm(find(S.fuel));
    case 'add-maint': return maintForm(null, el.dataset.item);
    case 'edit-maint': return maintForm(find(S.maint));
    case 'add-ins': return insForm();
    case 'edit-ins': return insForm(find(S.insurance));
    case 'add-tax': return taxForm();
    case 'edit-tax': return taxForm(find(S.tax));
    case 'edit-car': return carForm();
    case 'add-interval': return intervalForm();
    case 'edit-interval': return intervalForm(Number(el.dataset.idx));
    case 'export': return exportData();
    case 'import': { const f = $('#importFile'); f.value = ''; f.onchange = () => f.files[0] && importData(f.files[0]); f.click(); return; }
    case 'reset':
      if (confirm('정말 모든 기록을 지울까요? 되돌릴 수 없어요.' + (window.CarSync && window.CarSync.user ? '\n로그인 중이라 클라우드 기록과 다른 기기의 기록도 같이 지워져요.' : '')) && confirm('한 번 더 확인할게요. 백업은 해두셨나요? 모두 지웁니다.')) {
        S = defaults(); commit([{ t: 'all' }]); render(); toast('모두 지웠어요');
      }
      return;
    case 'login': return loginForm();
    case 'logout':
      if (confirm('로그아웃할까요? 이 기기에 있는 기록은 그대로 남지만, 다른 기기와 동기화는 멈춰요.')) window.CarSync.logout();
      return;
  }
});
// 입력 화면 바깥(어두운 배경)을 눌러도 닫히지 않음. '저장' 또는 '취소'로만 닫힘
$('#backdrop').addEventListener('click', e => {
  const b = e.target.closest('[data-sheet]'); if (!b) return;
  if (b.dataset.sheet === 'close') requestClose();
  else if (b.dataset.sheet === 'save') submitSheet();
  else if (b.dataset.sheet === 'delete') {
    if (confirm('이 기록을 삭제할까요?')) { commit(sheetCtx.onDelete()); closeSheet(); render(); toast('삭제했어요'); }
  }
  else if (b.dataset.sheet === 'quick-maint') {
    const item = b.dataset.item; closeSheet(); maintForm(null, item);
  }
  else if (b.dataset.sheet === 'reset-pw') {
    const email = ($('#f_email') || {}).value || '';
    if (!email.trim()) { alert('위 칸에 이메일을 먼저 입력해 주세요.'); return; }
    window.CarSync.resetPassword(email.trim()).then(err => alert(err || '비밀번호 재설정 메일을 보냈어요. 메일함(스팸함 포함)을 확인해 주세요.'));
  }
});
$('#backdrop').addEventListener('submit', e => { e.preventDefault(); submitSheet(); });
// 입력 중에 뒤로가기·새로고침·탭 닫기를 하면 브라우저가 한 번 확인해 줌
window.addEventListener('beforeunload', e => { if (sheetDirty()) { e.preventDefault(); e.returnValue = ''; } });

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
