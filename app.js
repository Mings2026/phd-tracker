const STORAGE_KEY = 'phdTrackerV1';
const APP_VERSION = '1.3.2';
const CLOUD_CONFIG_KEY = 'phdTrackerSupabaseConfigV1';
const CLOUD_TABLE = 'phd_tracker_state';
const CLOUD_SYNC_DELAY_MS = 900;
const CLOUD_AUTH_TIMEOUT_MS = 15000;
const CLOUD_SESSION_TIMEOUT_MS = 8000;
const CLOUD_SYNC_TIMEOUT_MS = 20000;
const DEFAULT_CATEGORIES = ['科研', '学习', '会议', '生活', '运动', '娱乐'];
const CATEGORY_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#ea580c', '#db2777', '#4f46e5', '#ca8a04'];

const state = {
  data: loadData(),
  currentPage: 'today',
  selectedDate: toDateKey(new Date()),
  calendarCursor: startOfMonth(new Date()),
  selectedCalendarDate: toDateKey(new Date()),
  editingMemoId: null,
  statsRange: { type: '7', start: null, end: null },
  heatmapYear: new Date().getFullYear(),
  timerInterval: null,
  cloud: {
    client: null,
    user: null,
    syncTimer: null,
    syncing: false,
    lastRemoteUpdatedAt: null,
    authSubscription: null,
    pollInterval: null,
    authBusy: false
  }
};

const els = {};
document.addEventListener('DOMContentLoaded', init);

function init() {
  cacheElements();
  initAutofillGuard();
  bindEvents();
  ensureDefaults();
  populateCategorySelect();
  populateTimerCategorySelect();
  populateProjectDatalist();
  renderAll();
  scheduleAutofillSweep();
  startTimerTicker();
  initCloud().catch(err => { console.error(err); setCloudMessage('云同步初始化失败，当前继续使用本地模式。', 'error'); });
}

function cacheElements() {
  document.querySelectorAll('[id]').forEach(el => { els[el.id] = el; });
}


const EMAIL_LIKE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HIGH_RISK_AUTOFILL_IDS = new Set([
  'timerTitle', 'timerProject', 'timerTags',
  'newCategoryInput', 'newProjectInput',
  'activityTitle', 'activityProject', 'activityTags'
]);

function initAutofillGuard() {
  const protectedFields = document.querySelectorAll('[data-phd-no-autofill="true"]');
  protectedFields.forEach((field, index) => {
    field.setAttribute('autocomplete', 'off');
    field.setAttribute('data-lpignore', 'true');
    field.setAttribute('data-1p-ignore', 'true');
    field.setAttribute('data-bwignore', 'true');
    if (!field.getAttribute('name') && field.id) field.setAttribute('name', `phd_${field.id}_${APP_VERSION.replaceAll('.', '_')}_${index}`);
  });

  // WebKit/Chrome expose :-webkit-autofill when a browser or password manager
  // inserts a value. Clear only clearly misplaced email values in non-auth fields.
  document.addEventListener('animationstart', event => {
    if (event.animationName === 'phdAutofillStart') clearMisplacedAccountAutofill(event.target);
  }, true);

  document.addEventListener('focusin', event => {
    const field = event.target;
    if (field?.matches?.('[data-phd-no-autofill="true"]')) {
      setTimeout(() => clearMisplacedAccountAutofill(field), 0);
    }
  }, true);

  window.addEventListener('pageshow', () => scheduleAutofillSweep());
}

function scheduleAutofillSweep() {
  [40, 250, 900, 1800].forEach(delay => setTimeout(sweepMisplacedAccountAutofill, delay));
}

function sweepMisplacedAccountAutofill() {
  document.querySelectorAll('[data-phd-no-autofill="true"]').forEach(clearMisplacedAccountAutofill);
}

function clearMisplacedAccountAutofill(field) {
  if (!field || field.id === 'cloudEmailInput' || field.id === 'cloudPasswordInput') return;
  if (!('value' in field)) return;
  const value = String(field.value || '').trim();
  if (!EMAIL_LIKE_RE.test(value)) return;

  let browserAutofilled = false;
  try { browserAutofilled = field.matches(':-webkit-autofill'); } catch {}
  const authEmail = String(els.cloudEmailInput?.value || '').trim().toLowerCase();
  const sameAsAuthEmail = !!authEmail && value.toLowerCase() === authEmail;
  const highRiskField = HIGH_RISK_AUTOFILL_IDS.has(field.id);

  if (browserAutofilled || (sameAsAuthEmail && highRiskField)) {
    field.value = '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => switchPage(btn.dataset.page)));
  els.addActivityBtn.addEventListener('click', () => openActivityModal({ date: state.selectedDate }));
  els.jumpTodayBtn.addEventListener('click', jumpToToday);
  els.quickExportBtn.addEventListener('click', exportData);
  els.prevDayBtn.addEventListener('click', () => shiftSelectedDay(-1));
  els.nextDayBtn.addEventListener('click', () => shiftSelectedDay(1));
  els.todayDatePicker.addEventListener('change', e => { state.selectedDate = e.target.value; renderToday(); });
  document.querySelectorAll('.quick-chip').forEach(btn => btn.addEventListener('click', () => {
    openActivityModal({ title: btn.dataset.quickTitle, category: btn.dataset.quickCategory, date: state.selectedDate });
  }));

  els.timerStartBtn.addEventListener('click', startTimer);
  els.timerPauseBtn.addEventListener('click', pauseTimer);
  els.timerResumeBtn.addEventListener('click', resumeTimer);
  els.timerStopBtn.addEventListener('click', stopTimerAndSave);
  els.timerCancelBtn.addEventListener('click', cancelTimer);

  els.prevMonthBtn.addEventListener('click', () => { state.calendarCursor = addMonths(state.calendarCursor, -1); renderCalendar(); });
  els.nextMonthBtn.addEventListener('click', () => { state.calendarCursor = addMonths(state.calendarCursor, 1); renderCalendar(); });
  els.calendarTodayBtn.addEventListener('click', () => {
    state.calendarCursor = startOfMonth(new Date());
    state.selectedCalendarDate = toDateKey(new Date());
    renderCalendar();
  });
  els.addForSelectedDayBtn.addEventListener('click', () => openActivityModal({ date: state.selectedCalendarDate }));
  els.saveDayMemoBtn.addEventListener('click', saveDayMemo);

  document.querySelectorAll('.range-btn').forEach(btn => btn.addEventListener('click', () => setStatsRange(btn.dataset.range)));
  els.applyCustomRangeBtn.addEventListener('click', applyCustomStatsRange);

  els.heatmapPrevYearBtn.addEventListener('click', () => { state.heatmapYear -= 1; renderResearchHeatmap(); });
  els.heatmapNextYearBtn.addEventListener('click', () => {
    if (state.heatmapYear < new Date().getFullYear()) { state.heatmapYear += 1; renderResearchHeatmap(); }
  });

  els.newMemoBtn.addEventListener('click', newMemo);
  els.saveMemoBtn.addEventListener('click', saveMemo);
  els.deleteMemoBtn.addEventListener('click', deleteMemo);

  els.exportBtn.addEventListener('click', exportData);
  els.importInput.addEventListener('change', importData);
  els.addCategoryBtn.addEventListener('click', addCategory);
  els.newCategoryInput.addEventListener('keydown', e => { if (e.key === 'Enter') addCategory(); });
  els.addProjectBtn.addEventListener('click', addProject);
  els.newProjectInput.addEventListener('keydown', e => { if (e.key === 'Enter') addProject(); });
  els.clearAllBtn.addEventListener('click', clearAllData);

  // V1.3.2 Supabase cloud sync + non-auth autofill guard
  els.saveCloudConfigBtn?.addEventListener('click', saveCloudConfigFromUI);
  els.testCloudConfigBtn?.addEventListener('click', testCloudConnection);
  els.cloudLoginBtn?.addEventListener('click', cloudLogin);
  els.cloudSignupBtn?.addEventListener('click', cloudSignup);
  els.cloudLogoutBtn?.addEventListener('click', cloudLogout);
  els.cloudSyncNowBtn?.addEventListener('click', () => syncCloudBidirectional({ manual: true }));
  els.cloudUploadBtn?.addEventListener('click', forceUploadLocalToCloud);
  els.cloudDownloadBtn?.addEventListener('click', forceDownloadCloudToLocal);
  window.addEventListener('online', () => { renderCloudUI(); if (state.cloud.user) syncCloudBidirectional({ silent: true }); });
  window.addEventListener('offline', renderCloudUI);
  window.addEventListener('focus', () => { if (state.cloud.user) pullCloudIfNewer(); });
  // iOS Safari may restore a page from the back/forward cache. Refresh the auth state
  // instead of leaving a stale mobile session UI behind.
  window.addEventListener('pageshow', () => {
    if (state.cloud.client && navigator.onLine) refreshCloudSessionNonBlocking();
  });

  els.closeActivityModalBtn.addEventListener('click', closeActivityModal);
  els.cancelActivityBtn.addEventListener('click', closeActivityModal);
  els.activityModalBackdrop.addEventListener('click', e => { if (e.target === els.activityModalBackdrop) closeActivityModal(); });
  els.activityForm.addEventListener('submit', saveActivityFromForm);
  els.deleteActivityBtn.addEventListener('click', deleteCurrentActivity);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeActivityModal(); });
}

function ensureDefaults() {
  // V1.3: tolerate older/local data shapes and always keep category selectors usable.
  const rawCategories = Array.isArray(state.data.categories) ? state.data.categories : [];
  const normalizedCategories = rawCategories
    .map(c => typeof c === 'string' ? c.trim() : (c && typeof c.name === 'string' ? c.name.trim() : ''))
    .filter(Boolean);
  state.data.categories = [...new Set(normalizedCategories.length ? normalizedCategories : DEFAULT_CATEGORIES)];
  if (!state.data.categories.includes('科研')) state.data.categories.unshift('科研');

  if (!Array.isArray(state.data.activities)) state.data.activities = [];
  if (!Array.isArray(state.data.memos)) state.data.memos = [];
  if (!state.data.dayMemos || typeof state.data.dayMemos !== 'object') state.data.dayMemos = {};
  if (!Array.isArray(state.data.projects)) state.data.projects = [];
  state.data.activities.forEach(a => {
    if (!a || typeof a !== 'object') return;
    if (!a.category || typeof a.category !== 'string') a.category = '科研';
    if (a.project && !state.data.projects.includes(a.project)) state.data.projects.push(a.project);
  });
  if (!state.data.timer || typeof state.data.timer !== 'object') state.data.timer = { active: false };
  if (!state.data.meta || typeof state.data.meta !== 'object') state.data.meta = {};
  if (!state.data.meta.updatedAt) state.data.meta.updatedAt = new Date().toISOString();
  if (!Array.isArray(state.data.deletedActivities)) state.data.deletedActivities = [];
  if (!Array.isArray(state.data.deletedMemos)) state.data.deletedMemos = [];
  if (!state.data.dayMemoUpdatedAt || typeof state.data.dayMemoUpdatedAt !== 'object') state.data.dayMemoUpdatedAt = {};
  persistLocal(false, false);
}

function emptyData() {
  return {
    activities: [], categories: [...DEFAULT_CATEGORIES], memos: [], dayMemos: {}, projects: [],
    timer: { active: false }, meta: { updatedAt: new Date().toISOString() },
    deletedActivities: [], deletedMemos: [], dayMemoUpdatedAt: {}
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    return JSON.parse(raw);
  } catch {
    return emptyData();
  }
}
function persistLocal(touch = true, sync = true) {
  if (!state.data.meta || typeof state.data.meta !== 'object') state.data.meta = {};
  if (touch) state.data.meta.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  if (sync) scheduleCloudSync();
  renderCloudUI();
}
function saveData() { persistLocal(true, true); }

function renderAll() {
  renderToday();
  renderCalendar();
  renderStats();
  renderMemoList();
  renderCategoryManager();
  renderProjectManager();
  populateProjectDatalist();
  populateTimerCategorySelect();
  renderTimer();
  renderCloudUI();
  renderPageMeta();
}

function switchPage(page) {
  state.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  renderPageMeta();
  if (page === 'calendar') renderCalendar();
  if (page === 'stats') renderStats();
  if (page === 'memo') renderMemoList();
}

function renderPageMeta() {
  const map = {
    today: ['今天', formatFullDate(parseDateKey(state.selectedDate))],
    calendar: ['日历', '按天查看你的时间投入与备忘'],
    stats: ['统计', '看看时间真正花在了哪里'],
    memo: ['备忘录', '记录科研想法、待办与灵感'],
    settings: ['设置', '管理云同步、类别与数据备份']
  };
  els.pageTitle.textContent = map[state.currentPage][0];
  els.pageSubtitle.textContent = map[state.currentPage][1];
}

function renderToday() {
  const date = parseDateKey(state.selectedDate);
  els.todayDateHeading.textContent = formatFullDate(date);
  els.todayDatePicker.value = state.selectedDate;
  els.pageSubtitle.textContent = state.currentPage === 'today' ? formatFullDate(date) : els.pageSubtitle.textContent;
  const activities = getActivitiesForDate(state.selectedDate);
  const total = activities.reduce((s, a) => s + durationMinutes(a), 0);
  els.todayTotalTime.textContent = formatMinutes(total);

  const grouped = groupByCategory(activities);
  els.todayCategorySummary.innerHTML = grouped.length
    ? grouped.map((g, i) => `<div class="summary-row"><span class="color-dot" style="background:${categoryColor(g.name)}"></span><span class="summary-name">${escapeHtml(g.name)}</span><span class="summary-time">${formatMinutes(g.minutes)}</span></div>`).join('')
    : '<div class="empty-state">今天还没有记录。点击“添加记录”开始。</div>';

  if (!activities.length) {
    els.timeline.innerHTML = '<div class="empty-state">暂无时间记录。你可以点击上方快捷按钮，或者“＋ 添加记录”。</div>';
    return;
  }

  els.timeline.innerHTML = activities.sort(compareByStart).map(a => `
    <button class="timeline-item" data-activity-id="${a.id}">
      <div class="timeline-time">${a.startTime}–${a.endTime}</div>
      <div class="timeline-main">
        <h4>${escapeHtml(a.title)}</h4>
        <div class="timeline-meta">
          <span class="category-pill">${escapeHtml(a.category)}</span>
          ${a.project ? `<span class="project-pill">📄 ${escapeHtml(a.project)}</span>` : ''}
          ${(a.tags || []).map(t => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join('')}
        </div>
        ${a.note ? `<div class="timeline-note">${escapeHtml(a.note)}</div>` : ''}
      </div>
      <div class="timeline-duration">${formatMinutes(durationMinutes(a))}</div>
    </button>`).join('');
  els.timeline.querySelectorAll('[data-activity-id]').forEach(btn => btn.addEventListener('click', () => openActivityModalById(btn.dataset.activityId)));
}

function renderCalendar() {
  const cursor = state.calendarCursor;
  els.calendarMonthLabel.textContent = `${cursor.getFullYear()}年 ${cursor.getMonth()+1}月`;
  const first = startOfMonth(cursor);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -mondayOffset);
  const todayKey = toDateKey(new Date());
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const key = toDateKey(d);
    const acts = getActivitiesForDate(key);
    const total = acts.reduce((s,a) => s + durationMinutes(a), 0);
    const pct = Math.min(100, total / 480 * 100);
    const outside = d.getMonth() !== cursor.getMonth();
    html += `<button class="calendar-day ${outside?'outside':''} ${key===todayKey?'today':''} ${key===state.selectedCalendarDate?'selected':''}" data-date="${key}">
      <span class="day-number">${d.getDate()}</span>
      <div class="day-total">${total ? formatMinutes(total) : '—'}</div>
      <div class="day-heat"><span style="width:${pct}%"></span></div>
    </button>`;
  }
  els.calendarGrid.innerHTML = html;
  els.calendarGrid.querySelectorAll('[data-date]').forEach(btn => btn.addEventListener('click', () => {
    state.selectedCalendarDate = btn.dataset.date;
    const d = parseDateKey(btn.dataset.date);
    if (d.getMonth() !== state.calendarCursor.getMonth()) state.calendarCursor = startOfMonth(d);
    renderCalendar();
  }));
  renderSelectedDayPanel();
}

function renderSelectedDayPanel() {
  const key = state.selectedCalendarDate;
  const acts = getActivitiesForDate(key).sort(compareByStart);
  const total = acts.reduce((s,a) => s + durationMinutes(a), 0);
  els.selectedDayLabel.textContent = formatFullDate(parseDateKey(key));
  els.selectedDayStats.innerHTML = `
    <div class="mini-stat"><span>总时间</span><strong>${formatMinutes(total)}</strong></div>
    <div class="mini-stat"><span>记录数</span><strong>${acts.length}</strong></div>`;
  els.selectedDayActivities.innerHTML = acts.length ? acts.map(a => `
    <button class="compact-item" data-activity-id="${a.id}">
      <strong>${escapeHtml(a.title)}</strong><span>${a.startTime}–${a.endTime} · ${escapeHtml(a.category)}${a.project ? ` · ${escapeHtml(a.project)}` : ''}</span>
    </button>`).join('') : '<div class="empty-state">当天暂无记录</div>';
  els.selectedDayActivities.querySelectorAll('[data-activity-id]').forEach(btn => btn.addEventListener('click', () => openActivityModalById(btn.dataset.activityId)));
  els.selectedDayMemo.value = state.data.dayMemos[key] || '';
}

function saveDayMemo() {
  state.data.dayMemos[state.selectedCalendarDate] = els.selectedDayMemo.value.trim();
  state.data.dayMemoUpdatedAt[state.selectedCalendarDate] = new Date().toISOString();
  saveData();
  toast('当天备忘已保存');
}

function setStatsRange(range) {
  state.statsRange.type = range;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  els.customRangeWrap.classList.toggle('show', range === 'custom');
  if (range !== 'custom') renderStats();
}

function applyCustomStatsRange() {
  if (!els.statsStartDate.value || !els.statsEndDate.value) return toast('请选择开始和结束日期');
  if (els.statsStartDate.value > els.statsEndDate.value) return toast('开始日期不能晚于结束日期');
  state.statsRange.start = els.statsStartDate.value;
  state.statsRange.end = els.statsEndDate.value;
  renderStats();
}

function getStatsDateRange() {
  const end = new Date();
  end.setHours(0,0,0,0);
  if (state.statsRange.type === 'custom' && state.statsRange.start && state.statsRange.end) {
    return [parseDateKey(state.statsRange.start), parseDateKey(state.statsRange.end)];
  }
  const days = Number(state.statsRange.type || 7);
  return [addDays(end, -(days - 1)), end];
}

function renderStats() {
  const [start, end] = getStatsDateRange();
  if (!els.statsStartDate.value) els.statsStartDate.value = toDateKey(start);
  if (!els.statsEndDate.value) els.statsEndDate.value = toDateKey(end);
  const activities = state.data.activities.filter(a => {
    const d = parseDateKey(a.date);
    return d >= start && d <= end;
  });
  const total = activities.reduce((s,a) => s + durationMinutes(a), 0);
  const dayCount = Math.max(1, Math.round((end - start) / 86400000) + 1);
  els.statsTotalTime.textContent = formatMinutes(total);
  els.statsRecordCount.textContent = activities.length;
  els.statsDailyAvg.textContent = formatMinutes(Math.round(total / dayCount));

  const daily = buildDailySeries(start, end, activities);
  const best = [...daily].sort((a,b)=>b.minutes-a.minutes)[0];
  els.statsBestDay.textContent = best && best.minutes ? `${best.date.slice(5)} · ${formatMinutes(best.minutes)}` : '—';

  const categories = groupByCategory(activities);
  const maxCat = Math.max(1, ...categories.map(c=>c.minutes));
  els.categoryStats.innerHTML = categories.length ? categories.map(c => `
    <div>
      <div class="bar-row-top"><span>${escapeHtml(c.name)}</span><span>${formatMinutes(c.minutes)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(c.minutes/maxCat)*100}%"></div></div>
    </div>`).join('') : '<div class="empty-state">这个时间段还没有记录</div>';

  const tags = groupByTag(activities).slice(0, 30);
  els.tagStats.innerHTML = tags.length ? tags.map(t => `<div class="tag-stat"><strong>#${escapeHtml(t.name)}</strong><span>${formatMinutes(t.minutes)}</span></div>`).join('') : '<div class="empty-state">暂无标签数据</div>';

  renderProjectStats(activities);
  renderResearchHeatmap();

  const visibleSeries = daily.length > 60 ? aggregateSeries(daily, 7) : daily;
  const max = Math.max(1, ...visibleSeries.map(d=>d.minutes));
  els.trendChart.innerHTML = visibleSeries.map(d => `
    <div class="trend-bar-wrap" title="${d.date}: ${formatMinutes(d.minutes)}">
      <div class="trend-value">${d.minutes ? Math.round(d.minutes/60*10)/10+'h' : ''}</div>
      <div class="trend-bar" style="height:${Math.max(3, (d.minutes/max)*190)}px"></div>
      <div class="trend-label">${d.label || d.date.slice(5)}</div>
    </div>`).join('');
}

function buildDailySeries(start, end, activities) {
  const map = {};
  activities.forEach(a => map[a.date] = (map[a.date] || 0) + durationMinutes(a));
  const result = [];
  for (let d = new Date(start); d <= end; d = addDays(d,1)) {
    const key = toDateKey(d);
    result.push({ date: key, minutes: map[key] || 0 });
  }
  return result;
}

function aggregateSeries(series, size) {
  const out = [];
  for (let i=0; i<series.length; i+=size) {
    const chunk = series.slice(i, i+size);
    out.push({ date: chunk[0].date, label: `${chunk[0].date.slice(5)}~`, minutes: chunk.reduce((s,x)=>s+x.minutes,0) });
  }
  return out;
}

function renderMemoList() {
  const sorted = [...state.data.memos].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
  if (!sorted.length) {
    els.memoList.innerHTML = '<div class="empty-state">还没有备忘录。点击“＋ 新建”。</div>';
    if (!state.editingMemoId) {
      els.memoTitleInput.value = '';
      els.memoContentInput.value = '';
    }
    return;
  }
  if (!state.editingMemoId || !state.data.memos.find(m=>m.id===state.editingMemoId)) state.editingMemoId = sorted[0].id;
  els.memoList.innerHTML = sorted.map(m => `<button class="memo-card ${m.id===state.editingMemoId?'active':''}" data-memo-id="${m.id}"><strong>${escapeHtml(m.title || '未命名备忘录')}</strong><span>${formatDateTime(m.updatedAt)}</span></button>`).join('');
  els.memoList.querySelectorAll('[data-memo-id]').forEach(btn => btn.addEventListener('click', () => { state.editingMemoId = btn.dataset.memoId; renderMemoList(); }));
  const memo = state.data.memos.find(m=>m.id===state.editingMemoId);
  if (memo) { els.memoTitleInput.value = memo.title; els.memoContentInput.value = memo.content; }
}

function newMemo() {
  const now = new Date().toISOString();
  const memo = { id: uid(), title: '新备忘录', content: '', createdAt: now, updatedAt: now };
  state.data.memos.push(memo);
  state.editingMemoId = memo.id;
  saveData(); renderMemoList();
  setTimeout(() => els.memoTitleInput.focus(), 0);
}
function saveMemo() {
  if (!state.editingMemoId) return newMemo();
  const memo = state.data.memos.find(m=>m.id===state.editingMemoId);
  if (!memo) return;
  memo.title = els.memoTitleInput.value.trim() || '未命名备忘录';
  memo.content = els.memoContentInput.value;
  memo.updatedAt = new Date().toISOString();
  state.data.deletedMemos = (state.data.deletedMemos || []).filter(t => t.id !== memo.id);
  saveData(); renderMemoList(); toast('备忘录已保存');
}
function deleteMemo() {
  if (!state.editingMemoId) return;
  const memo = state.data.memos.find(m=>m.id===state.editingMemoId);
  if (!memo || !confirm(`确定删除“${memo.title || '未命名备忘录'}”吗？`)) return;
  state.data.memos = state.data.memos.filter(m=>m.id!==state.editingMemoId);
  state.data.deletedMemos = upsertTombstone(state.data.deletedMemos, state.editingMemoId);
  state.editingMemoId = null;
  saveData(); renderMemoList(); toast('备忘录已删除');
}

function openActivityModal(prefill={}) {
  els.activityForm.reset();
  els.activityId.value = '';
  els.activityModalTitle.textContent = '添加时间记录';
  els.deleteActivityBtn.classList.add('hidden');
  populateCategorySelect();

  const date = prefill.date || toDateKey(new Date());
  const now = new Date();
  const end = roundTime(now, 5);
  const start = new Date(end.getTime() - 60*60*1000);
  els.activityTitle.value = prefill.title || '';
  els.activityDate.value = date;
  els.activityCategory.value = prefill.category || state.data.categories[0] || '科研';
  els.activityProject.value = prefill.project || '';
  els.activityStartTime.value = toTimeValue(start);
  els.activityEndTime.value = toTimeValue(end);
  els.activityTags.value = prefill.tags || '';
  els.activityNote.value = '';
  els.activityModalBackdrop.classList.add('show');
  setTimeout(() => els.activityTitle.focus(), 0);
}

function openActivityModalById(id) {
  const a = state.data.activities.find(x=>x.id===id);
  if (!a) return;
  populateCategorySelect();
  els.activityId.value = a.id;
  els.activityModalTitle.textContent = '编辑时间记录';
  els.deleteActivityBtn.classList.remove('hidden');
  els.activityTitle.value = a.title;
  els.activityDate.value = a.date;
  els.activityCategory.value = a.category;
  els.activityProject.value = a.project || '';
  els.activityStartTime.value = a.startTime;
  els.activityEndTime.value = a.endTime;
  els.activityTags.value = (a.tags || []).join(', ');
  els.activityNote.value = a.note || '';
  els.activityModalBackdrop.classList.add('show');
}
function closeActivityModal() { els.activityModalBackdrop.classList.remove('show'); }

function saveActivityFromForm(e) {
  e.preventDefault();
  const start = els.activityStartTime.value;
  const end = els.activityEndTime.value;
  if (!start || !end) return toast('请填写开始和结束时间');
  if (timeToMinutes(end) <= timeToMinutes(start)) return toast('结束时间必须晚于开始时间');
  const id = els.activityId.value;
  const item = {
    id: id || uid(),
    title: els.activityTitle.value.trim(),
    date: els.activityDate.value,
    startTime: start,
    endTime: end,
    category: els.activityCategory.value,
    project: els.activityProject.value.trim(),
    tags: normalizeTags(els.activityTags.value),
    note: els.activityNote.value.trim(),
    createdAt: id ? (state.data.activities.find(x=>x.id===id)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!item.title) return toast('请填写“做了什么”');
  if (id) state.data.activities = state.data.activities.map(a => a.id===id ? item : a);
  else state.data.activities.push(item);
  state.data.deletedActivities = (state.data.deletedActivities || []).filter(t => t.id !== item.id);
  if (item.project) ensureProject(item.project);
  saveData();
  state.selectedDate = item.date;
  state.selectedCalendarDate = item.date;
  closeActivityModal(); renderAll(); toast(id ? '记录已更新' : '记录已添加');
}

function deleteCurrentActivity() {
  const id = els.activityId.value;
  const a = state.data.activities.find(x=>x.id===id);
  if (!a || !confirm(`确定删除“${a.title}”吗？`)) return;
  state.data.activities = state.data.activities.filter(x=>x.id!==id);
  state.data.deletedActivities = upsertTombstone(state.data.deletedActivities, id);
  saveData(); closeActivityModal(); renderAll(); toast('记录已删除');
}

function populateCategorySelect() {
  const current = els.activityCategory?.value;
  els.activityCategory.innerHTML = state.data.categories.map(c=>`<option>${escapeHtml(c)}</option>`).join('');
  if (current && state.data.categories.includes(current)) els.activityCategory.value = current;
}

function populateTimerCategorySelect() {
  if (!els.timerCategory) return;
  const categories = Array.isArray(state.data.categories)
    ? state.data.categories.filter(c => typeof c === 'string' && c.trim())
    : [];
  const safeCategories = categories.length ? categories : [...DEFAULT_CATEGORIES];
  const current = els.timerCategory.value;
  els.timerCategory.innerHTML = safeCategories
    .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (current && safeCategories.includes(current)) els.timerCategory.value = current;
  else if (safeCategories.includes('科研')) els.timerCategory.value = '科研';
  else els.timerCategory.selectedIndex = 0;
}

function populateProjectDatalist() {
  if (!els.projectDatalist) return;
  els.projectDatalist.innerHTML = (state.data.projects || []).map(p=>`<option value="${escapeHtml(p)}"></option>`).join('');
}

function renderCategoryManager() {
  els.categoryManager.innerHTML = state.data.categories.map(c=>`<span class="category-token">${escapeHtml(c)}<button data-remove-category="${escapeHtml(c)}" title="删除">×</button></span>`).join('');
  els.categoryManager.querySelectorAll('[data-remove-category]').forEach(btn => btn.addEventListener('click', () => removeCategory(btn.dataset.removeCategory)));
}
function addCategory() {
  const name = els.newCategoryInput.value.trim();
  if (!name) return;
  if (state.data.categories.includes(name)) return toast('这个类别已经存在');
  state.data.categories.push(name);
  els.newCategoryInput.value = '';
  saveData(); populateCategorySelect(); populateTimerCategorySelect(); renderCategoryManager(); toast('类别已添加');
}
function removeCategory(name) {
  if (state.data.categories.length <= 1) return toast('至少保留一个类别');
  const count = state.data.activities.filter(a=>a.category===name).length;
  if (count && !confirm(`已有 ${count} 条记录使用“${name}”。删除类别不会删除这些历史记录。继续吗？`)) return;
  state.data.categories = state.data.categories.filter(c=>c!==name);
  saveData(); populateCategorySelect(); populateTimerCategorySelect(); renderCategoryManager(); toast('类别已删除');
}

function renderProjectManager() {
  if (!els.projectManager) return;
  const projects = state.data.projects || [];
  els.projectManager.innerHTML = projects.length
    ? projects.map(p=>`<span class="category-token">${escapeHtml(p)}<button data-remove-project="${escapeHtml(p)}" title="删除">×</button></span>`).join('')
    : '<span class="muted">还没有项目。添加后可在时间记录和计时器中直接选择。</span>';
  els.projectManager.querySelectorAll('[data-remove-project]').forEach(btn => btn.addEventListener('click', () => removeProject(btn.dataset.removeProject)));
}

function addProject() {
  const name = els.newProjectInput.value.trim();
  if (!name) return;
  if ((state.data.projects || []).includes(name)) return toast('这个项目已经存在');
  state.data.projects.push(name);
  els.newProjectInput.value = '';
  saveData(); renderProjectManager(); populateProjectDatalist(); toast('项目已添加');
}

function ensureProject(name) {
  name = (name || '').trim();
  if (!name) return;
  if (!state.data.projects.includes(name)) state.data.projects.push(name);
}

function removeProject(name) {
  const count = state.data.activities.filter(a=>a.project===name).length;
  if (count && !confirm(`已有 ${count} 条记录归属于“${name}”。从项目列表移除不会修改这些历史记录。继续吗？`)) return;
  state.data.projects = state.data.projects.filter(p=>p!==name);
  saveData(); renderProjectManager(); populateProjectDatalist(); toast('项目已从列表移除');
}

function exportData() {
  const payload = {
    app: 'PhD Tracker', version: APP_VERSION, exportedAt: new Date().toISOString(), data: state.data
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `phd-tracker-backup-${toDateKey(new Date())}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('备份文件已导出');
}

async function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = parsed.data || parsed;
    if (!incoming || !Array.isArray(incoming.activities)) throw new Error('invalid');
    state.data = mergeDataStates(state.data, incoming);
    ensureDefaults();
    saveData(); renderAll(); toast('备份已成功导入并合并');
  } catch {
    alert('导入失败：文件格式不正确。请使用 PhD Tracker 导出的 JSON 备份文件。');
  } finally {
    e.target.value = '';
  }
}

function clearAllData() {
  if (!confirm('确定清空全部本地数据吗？此操作无法撤销。')) return;
  if (!confirm('最后确认一次：所有时间记录、备忘录和设置都会被清空。')) return;
  localStorage.removeItem(STORAGE_KEY);
  state.data = emptyData();
  state.editingMemoId = null;
  saveData(); renderAll(); toast(state.cloud.user ? '全部数据已清空，并将同步到云端' : '全部本地数据已清空');
}

function startTimerTicker() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    if (state.data.timer?.active && state.data.timer.running) updateTimerClockOnly();
  }, 1000);
}

function getTimerElapsedSeconds(timer = state.data.timer) {
  if (!timer?.active) return 0;
  let seconds = Number(timer.accumulatedSeconds || 0);
  if (timer.running && timer.segmentStartedAt) {
    seconds += Math.max(0, (Date.now() - new Date(timer.segmentStartedAt).getTime()) / 1000);
  }
  return Math.floor(seconds);
}

function renderTimer() {
  if (!els.timerDisplay) return;
  const timer = state.data.timer || { active: false };
  const active = !!timer.active;
  const running = active && !!timer.running;
  const paused = active && !timer.running;

  els.timerDisplay.textContent = formatClock(getTimerElapsedSeconds(timer));
  els.timerStatus.textContent = running ? '计时中' : paused ? '已暂停' : '未开始';
  els.timerStatus.className = `timer-status ${running ? 'running' : paused ? 'paused' : ''}`;

  if (active) {
    els.timerTitle.value = timer.title || '';
    els.timerCategory.value = timer.category || state.data.categories[0] || '科研';
    els.timerProject.value = timer.project || '';
    els.timerTags.value = (timer.tags || []).join(', ');
    const start = timer.originalStartAt ? new Date(timer.originalStartAt) : null;
    els.timerStartedAt.textContent = start ? `开始于 ${formatDateTime(timer.originalStartAt)} · 停止后自动写入时间轴` : '计时进行中';
  } else {
    els.timerStartedAt.textContent = '填写任务后点击开始，停止时会自动保存为时间记录。';
  }

  [els.timerTitle, els.timerCategory, els.timerProject, els.timerTags].forEach(el => { if (el) el.disabled = active; });
  els.timerStartBtn.classList.toggle('hidden', active);
  els.timerPauseBtn.classList.toggle('hidden', !running);
  els.timerResumeBtn.classList.toggle('hidden', !paused);
  els.timerStopBtn.classList.toggle('hidden', !active);
  els.timerCancelBtn.classList.toggle('hidden', !active);
}

function updateTimerClockOnly() {
  if (!els.timerDisplay) return;
  els.timerDisplay.textContent = formatClock(getTimerElapsedSeconds());
}

function startTimer() {
  // V1.3: the button must always be actionable. If the task title is blank,
  // use the selected category as a sensible temporary title instead of blocking.
  populateTimerCategorySelect();
  const category = (els.timerCategory?.value || '科研').trim() || '科研';
  const title = els.timerTitle.value.trim() || category;
  const now = new Date();
  const project = els.timerProject.value.trim();
  if (project) ensureProject(project);
  state.data.timer = {
    active: true,
    running: true,
    title,
    category,
    project,
    tags: normalizeTags(els.timerTags.value),
    originalStartAt: now.toISOString(),
    segmentStartedAt: now.toISOString(),
    accumulatedSeconds: 0
  };
  saveData();
  populateProjectDatalist();
  renderTimer();
  toast(`计时已开始：${title}`);
}

function pauseTimer() {
  const timer = state.data.timer;
  if (!timer?.active || !timer.running) return;
  timer.accumulatedSeconds = getTimerElapsedSeconds(timer);
  timer.running = false;
  timer.segmentStartedAt = null;
  saveData(); renderTimer(); toast('计时已暂停');
}

function resumeTimer() {
  const timer = state.data.timer;
  if (!timer?.active || timer.running) return;
  timer.running = true;
  timer.segmentStartedAt = new Date().toISOString();
  saveData(); renderTimer(); toast('继续计时');
}

function stopTimerAndSave() {
  const timer = state.data.timer;
  if (!timer?.active) return;
  const elapsedSeconds = getTimerElapsedSeconds(timer);
  const minutes = Math.max(1, Math.round(elapsedSeconds / 60));
  if (elapsedSeconds < 30 && !confirm('本次计时不足 30 秒，仍然按 1 分钟保存吗？')) return;

  const startDate = timer.originalStartAt ? new Date(timer.originalStartAt) : new Date();
  const startMinute = startDate.getHours() * 60 + startDate.getMinutes();
  let endMinute = startMinute + minutes;
  let dateKey = toDateKey(startDate);
  let note = '由实时计时器自动生成';
  if (endMinute >= 24 * 60) {
    endMinute = 23 * 60 + 59;
    note += '；本次计时跨越午夜，时间轴显示已截到当天 23:59';
  }
  const item = {
    id: uid(),
    title: timer.title || '计时任务',
    date: dateKey,
    startTime: minutesToTime(startMinute),
    endTime: minutesToTime(endMinute),
    category: timer.category || '科研',
    project: timer.project || '',
    tags: timer.tags || [],
    note,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.data.activities.push(item);
  if (item.project) ensureProject(item.project);
  state.data.timer = { active: false };
  state.selectedDate = item.date;
  state.selectedCalendarDate = item.date;
  saveData();
  clearTimerInputs();
  renderAll();
  toast(`已保存 ${formatMinutes(minutes)}`);
}

function cancelTimer() {
  if (!state.data.timer?.active) return;
  if (!confirm('确定放弃当前计时吗？这段时间不会保存到记录中。')) return;
  state.data.timer = { active: false };
  saveData(); clearTimerInputs(); renderTimer(); toast('本次计时已放弃');
}

function clearTimerInputs() {
  if (!els.timerTitle) return;
  els.timerTitle.value = '';
  els.timerProject.value = '';
  els.timerTags.value = '';
  populateTimerCategorySelect();
}


// ------------------------------
// V1.3.2 Supabase cloud sync - mobile auth hardened
// ------------------------------
class CloudTimeoutError extends Error {
  constructor(label, ms) {
    super(`${label}等待超过 ${Math.round(ms / 1000)} 秒`);
    this.name = 'CloudTimeoutError';
    this.isCloudTimeout = true;
  }
}

function withCloudTimeout(promise, ms, label) {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new CloudTimeoutError(label, ms)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeoutPromise])
    .finally(() => clearTimeout(timerId));
}

function setCloudAuthBusy(busy, action = '') {
  state.cloud.authBusy = !!busy;
  const loginBtn = els.cloudLoginBtn;
  const signupBtn = els.cloudSignupBtn;
  if (loginBtn) {
    if (!loginBtn.dataset.defaultText) loginBtn.dataset.defaultText = loginBtn.textContent;
    loginBtn.disabled = !!busy;
    loginBtn.textContent = busy && action === 'login' ? '正在验证…' : loginBtn.dataset.defaultText;
  }
  if (signupBtn) {
    if (!signupBtn.dataset.defaultText) signupBtn.dataset.defaultText = signupBtn.textContent;
    signupBtn.disabled = !!busy;
    signupBtn.textContent = busy && action === 'signup' ? '正在注册…' : signupBtn.dataset.defaultText;
  }
}

function cleanupCloudClientRuntime() {
  try { state.cloud.authSubscription?.unsubscribe?.(); } catch {}
  state.cloud.authSubscription = null;
  if (state.cloud.pollInterval) clearInterval(state.cloud.pollInterval);
  state.cloud.pollInterval = null;
  try { state.cloud.client?.auth?.stopAutoRefresh?.(); } catch {}
}

function newSupabaseClient(config) {
  if (!window.supabase?.createClient) throw new Error('Supabase 客户端脚本加载失败，请检查网络后刷新页面');
  // V1.3.2 continues to pin the lockless Supabase JS release. No custom navigator lock is used.
  return window.supabase.createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}

async function rebuildCloudClientAfterTimeout(config) {
  cleanupCloudClientRuntime();
  state.cloud.client = null;
  state.cloud.user = null;
  renderCloudUI();
  // Give a suspended mobile tab a brief moment to release pending browser work.
  await new Promise(resolve => setTimeout(resolve, 180));
  state.cloud.client = newSupabaseClient(config);
  attachCloudAuthListener();
  startCloudPolling();
  renderCloudUI();
  return state.cloud.client;
}

function attachCloudAuthListener() {
  if (!state.cloud.client) return;
  try { state.cloud.authSubscription?.unsubscribe?.(); } catch {}
  const sub = state.cloud.client.auth.onAuthStateChange((event, session) => {
    state.cloud.user = session?.user || null;
    renderCloudUI();
    if (event === 'SIGNED_IN' && state.cloud.user) {
      setTimeout(() => syncCloudBidirectional({ silent: true }), 0);
    }
    if (event === 'SIGNED_OUT') {
      setCloudMessage('已退出云端账号。当前数据仍保存在本机。');
    }
  });
  state.cloud.authSubscription = sub.data?.subscription || null;
}

function startCloudPolling() {
  if (state.cloud.pollInterval) clearInterval(state.cloud.pollInterval);
  state.cloud.pollInterval = setInterval(() => {
    if (state.cloud.user && navigator.onLine && !document.hidden) pullCloudIfNewer();
  }, 60000);
}

async function refreshCloudSessionNonBlocking() {
  if (!state.cloud.client) return;
  try {
    const { data, error } = await withCloudTimeout(
      state.cloud.client.auth.getSession(),
      CLOUD_SESSION_TIMEOUT_MS,
      '检查登录状态'
    );
    if (error) throw error;
    state.cloud.user = data.session?.user || null;
    renderCloudUI();
  } catch (err) {
    // A restored mobile tab should never freeze the UI because auth state probing got stuck.
    console.warn('refreshCloudSessionNonBlocking:', err);
  }
}

function validCloudConfig(config) {
  return !!(config && typeof config.url === 'string' && /^https:\/\//.test(config.url.trim()) && typeof config.key === 'string' && config.key.trim().length > 20);
}

function getCloudConfig() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY) || 'null'); } catch {}
  const bundled = window.PHD_TRACKER_SUPABASE || null;
  if (validCloudConfig(stored)) return { url: stored.url.trim(), key: stored.key.trim(), source: 'browser' };
  if (validCloudConfig(bundled)) return { url: bundled.url.trim(), key: bundled.key.trim(), source: 'file' };
  return { url: stored?.url || bundled?.url || '', key: stored?.key || bundled?.key || '', source: 'none' };
}

function setCloudMessage(message, type = '') {
  if (!els.cloudMessage) return;
  els.cloudMessage.textContent = message;
  els.cloudMessage.className = `cloud-message ${type}`;
}

function cloudStatusLabel() {
  if (!navigator.onLine) return ['离线 · 本地缓存', 'offline'];
  if (!state.cloud.client) return ['本地模式', 'local'];
  if (state.cloud.syncing) return ['正在同步…', 'syncing'];
  if (state.cloud.user) return ['云端已连接', 'online'];
  return ['云端未登录', 'ready'];
}

function renderCloudUI() {
  const [label, mode] = cloudStatusLabel();
  if (els.cloudStatusBadge) {
    els.cloudStatusBadge.textContent = label;
    els.cloudStatusBadge.className = `cloud-badge ${mode}`;
  }
  if (els.cloudMiniStatus) {
    els.cloudMiniStatus.innerHTML = `<span class="cloud-dot ${mode}"></span><span>${escapeHtml(label)}</span>`;
  }
  if (els.cloudLoggedOutPanel) els.cloudLoggedOutPanel.classList.toggle('hidden', !!state.cloud.user);
  if (els.cloudLoggedInPanel) els.cloudLoggedInPanel.classList.toggle('hidden', !state.cloud.user);
  if (els.cloudUserEmail) els.cloudUserEmail.textContent = state.cloud.user?.email || '—';
  if (els.cloudLastSyncText) {
    const iso = state.data?.meta?.lastCloudSyncedAt;
    els.cloudLastSyncText.textContent = iso ? `上次同步：${formatDateTime(iso)}` : '尚未完成云端同步';
  }
}

function fillCloudConfigInputs() {
  const config = getCloudConfig();
  if (els.supabaseUrlInput && !els.supabaseUrlInput.value) els.supabaseUrlInput.value = config.url || '';
  if (els.supabaseKeyInput && !els.supabaseKeyInput.value) els.supabaseKeyInput.value = config.key || '';
}

async function initCloud() {
  fillCloudConfigInputs();
  const config = getCloudConfig();
  if (!validCloudConfig(config)) {
    renderCloudUI();
    setCloudMessage('尚未配置 Supabase。进入“设置 → Supabase 多设备同步”填入 Project URL 和 Publishable key 即可启用。');
    return;
  }
  await createCloudClient(config);
}

async function createCloudClient(config) {
  if (!validCloudConfig(config)) throw new Error('Supabase 配置不完整');
  cleanupCloudClientRuntime();

  state.cloud.client = newSupabaseClient(config);
  state.cloud.user = null;
  attachCloudAuthListener();
  startCloudPolling();
  renderCloudUI();
  setCloudMessage('Supabase 已配置。正在检查登录状态…');

  try {
    const { data, error } = await withCloudTimeout(
      state.cloud.client.auth.getSession(),
      CLOUD_SESSION_TIMEOUT_MS,
      '检查登录状态'
    );
    if (error) throw error;
    state.cloud.user = data.session?.user || null;
  } catch (err) {
    console.warn('Supabase getSession timeout/error:', err);
    if (err?.isCloudTimeout) {
      // Crucially, do not block the whole app on mobile if getSession never resolves.
      state.cloud.user = null;
      renderCloudUI();
      setCloudMessage('登录状态检查超时，但网页仍可使用。请直接输入账号密码登录；V1.3.2 会自动重试。', 'error');
      return;
    }
    throw err;
  }

  if (state.cloud.user) {
    renderCloudUI();
    setCloudMessage(`账号已登录：${state.cloud.user.email || ''}。正在读取云端数据…`);
    try {
      await withCloudTimeout(syncCloudBidirectional({ silent: true }), CLOUD_SYNC_TIMEOUT_MS, '首次云端同步');
      setCloudMessage('账号已登录，云端同步正常。', 'success');
    } catch (err) {
      console.warn('Initial sync timeout/error:', err);
      setCloudMessage(`账号已登录，但首次同步未完成：${friendlyCloudError(err)}。可点击“立即双向同步”重试。`, 'error');
    }
  } else {
    setCloudMessage('Supabase 连接正常。登录或注册后即可在不同设备共享数据。', 'success');
  }
  renderCloudUI();
}

async function saveCloudConfigFromUI() {
  const config = {
    url: (els.supabaseUrlInput?.value || '').trim(),
    key: (els.supabaseKeyInput?.value || '').trim()
  };
  if (!validCloudConfig(config)) return toast('请填写正确的 Project URL 和 Publishable key');
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));
  try {
    await createCloudClient(config);
    toast('Supabase 连接已保存');
  } catch (err) {
    console.error(err);
    state.cloud.client = null;
    state.cloud.user = null;
    renderCloudUI();
    setCloudMessage(`连接失败：${friendlyCloudError(err)}`, 'error');
  }
}

async function testCloudConnection() {
  const config = {
    url: (els.supabaseUrlInput?.value || '').trim(),
    key: (els.supabaseKeyInput?.value || '').trim()
  };
  if (!validCloudConfig(config)) return toast('请先填写 Supabase Project URL 和 Publishable key');
  try {
    setCloudMessage('正在测试 Supabase 连接…');
    const response = await withCloudTimeout(fetch(`${config.url.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: config.key }
    }), 10000, '连接测试');
    if (!response.ok) throw new Error(`Supabase 返回 HTTP ${response.status}`);
    setCloudMessage('连接测试成功。保存连接后即可登录。', 'success');
    toast('Supabase 连接正常');
  } catch (err) {
    setCloudMessage(`连接测试失败：${friendlyCloudError(err)}`, 'error');
  }
}

async function ensureCloudClient() {
  if (state.cloud.client) return true;
  const config = getCloudConfig();
  if (!validCloudConfig(config)) {
    setCloudMessage('请先填写并保存 Supabase Project URL 和 Publishable key。', 'error');
    return false;
  }
  try { await createCloudClient(config); return !!state.cloud.client; }
  catch (err) { setCloudMessage(`连接失败：${friendlyCloudError(err)}`, 'error'); return false; }
}

async function cloudSignup() {
  if (state.cloud.authBusy) return;
  if (!await ensureCloudClient()) return;
  const email = (els.cloudEmailInput?.value || '').trim();
  const password = els.cloudPasswordInput?.value || '';
  if (!email || password.length < 6) return toast('请输入邮箱和至少 6 位密码');
  setCloudAuthBusy(true, 'signup');
  try {
    setCloudMessage('正在创建账号…');
    const { data, error } = await withCloudTimeout(
      state.cloud.client.auth.signUp({
        email, password,
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
      }),
      CLOUD_AUTH_TIMEOUT_MS,
      '注册请求'
    );
    if (error) throw error;
    if (data.session) {
      state.cloud.user = data.user;
      renderCloudUI();
      setCloudMessage('账号已创建并登录。正在同步云端数据…');
      try {
        await withCloudTimeout(syncCloudBidirectional({ silent: true }), CLOUD_SYNC_TIMEOUT_MS, '首次云端同步');
        setCloudMessage('注册并登录成功，云端同步正常。', 'success');
      } catch (syncErr) {
        setCloudMessage(`账号已注册并登录，但首次同步未完成：${friendlyCloudError(syncErr)}。可稍后点击“立即双向同步”。`, 'error');
      }
    } else {
      setCloudMessage('注册成功。请到邮箱点击 Supabase 的确认链接，然后回到本页登录。', 'success');
    }
  } catch (err) {
    if (err?.isCloudTimeout) {
      const config = getCloudConfig();
      try { await rebuildCloudClientAfterTimeout(config); } catch {}
      setCloudMessage('注册请求超时，客户端已自动重置。请检查手机网络后再点一次“注册账号”。', 'error');
    } else {
      setCloudMessage(`注册失败：${friendlyCloudError(err)}`, 'error');
    }
  } finally {
    setCloudAuthBusy(false);
  }
}

async function cloudLogin() {
  if (state.cloud.authBusy) return;
  if (!await ensureCloudClient()) return;
  const email = (els.cloudEmailInput?.value || '').trim();
  const password = els.cloudPasswordInput?.value || '';
  if (!email || !password) return toast('请输入邮箱和密码');
  setCloudAuthBusy(true, 'login');
  let retried = false;
  try {
    let result;
    while (true) {
      try {
        setCloudMessage(retried ? '手机端首次响应超时，正在自动重试账号验证…' : '正在验证账号…');
        result = await withCloudTimeout(
          state.cloud.client.auth.signInWithPassword({ email, password }),
          CLOUD_AUTH_TIMEOUT_MS,
          '账号验证'
        );
        break;
      } catch (err) {
        if (!err?.isCloudTimeout || retried) throw err;
        retried = true;
        const config = getCloudConfig();
        await rebuildCloudClientAfterTimeout(config);
      }
    }

    const { data, error } = result;
    if (error) throw error;
    state.cloud.user = data.user || data.session?.user || null;
    if (!state.cloud.user) throw new Error('登录响应中未返回用户信息');
    renderCloudUI();

    // Authentication and data synchronization are deliberately separated so a
    // slow database request can never make a successful login look permanently stuck.
    setCloudMessage(`账号登录成功：${state.cloud.user.email || email}。正在读取云端数据…`, 'success');
    try {
      await withCloudTimeout(
        syncCloudBidirectional({ manual: false, silent: true }),
        CLOUD_SYNC_TIMEOUT_MS,
        '云端同步'
      );
      setCloudMessage('账号登录成功，云端数据已同步。', 'success');
      toast('登录并同步成功');
    } catch (syncErr) {
      console.warn('Login succeeded but sync did not finish:', syncErr);
      setCloudMessage(`账号已经登录，但同步暂未完成：${friendlyCloudError(syncErr)}。你的本地数据仍安全，可点击“立即双向同步”重试。`, 'error');
      toast('账号已登录');
    }
  } catch (err) {
    console.error('cloudLogin:', err);
    if (err?.isCloudTimeout) {
      const config = getCloudConfig();
      try { await rebuildCloudClientAfterTimeout(config); } catch {}
      setCloudMessage('登录请求两次均超时。客户端已自动恢复，不会一直卡在“正在登录”。请切换手机网络或稍后重试。', 'error');
    } else {
      setCloudMessage(`登录失败：${friendlyCloudError(err)}`, 'error');
    }
  } finally {
    setCloudAuthBusy(false);
    renderCloudUI();
  }
}

async function cloudLogout() {
  if (!state.cloud.client) return;
  try {
    await withCloudTimeout(state.cloud.client.auth.signOut(), CLOUD_AUTH_TIMEOUT_MS, '退出登录');
    state.cloud.user = null;
    renderCloudUI();
    setCloudMessage('已退出登录。当前设备仍保留一份本地缓存。');
  } catch (err) {
    state.cloud.user = null;
    renderCloudUI();
    setCloudMessage(`退出操作未完整返回：${friendlyCloudError(err)}。本机已结束当前登录显示。`, 'error');
  }
}

function scheduleCloudSync() {
  if (!state?.cloud?.user || !state.cloud.client || !navigator.onLine) return;
  clearTimeout(state.cloud.syncTimer);
  state.cloud.syncTimer = setTimeout(() => pushLocalToCloud({ silent: true }), CLOUD_SYNC_DELAY_MS);
}

async function getCloudRow() {
  if (!state.cloud.client || !state.cloud.user) return null;
  const { data, error } = await state.cloud.client
    .from(CLOUD_TABLE)
    .select('data,updated_at')
    .eq('user_id', state.cloud.user.id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function pushLocalToCloud({ silent = false } = {}) {
  if (!state.cloud.client || !state.cloud.user || !navigator.onLine) return false;
  if (state.cloud.syncing) return false;
  state.cloud.syncing = true;
  renderCloudUI();
  try {
    const now = new Date().toISOString();
    if (!state.data.meta) state.data.meta = {};
    if (!state.data.meta.updatedAt) state.data.meta.updatedAt = now;
    const { data, error } = await state.cloud.client
      .from(CLOUD_TABLE)
      .upsert({ user_id: state.cloud.user.id, data: state.data, updated_at: now }, { onConflict: 'user_id' })
      .select('updated_at')
      .single();
    if (error) throw error;
    state.cloud.lastRemoteUpdatedAt = data.updated_at;
    state.data.meta.lastCloudSyncedAt = new Date().toISOString();
    persistLocal(false, false);
    if (!silent) toast('已同步到 Supabase');
    setCloudMessage('云端同步正常。之后的记录会自动同步。', 'success');
    return true;
  } catch (err) {
    console.error(err);
    setCloudMessage(`同步失败：${friendlyCloudError(err)}。本地数据仍安全保留。`, 'error');
    return false;
  } finally {
    state.cloud.syncing = false;
    renderCloudUI();
  }
}

async function syncCloudBidirectional({ manual = false, silent = false } = {}) {
  if (!state.cloud.client || !state.cloud.user || !navigator.onLine) {
    if (manual) toast('当前未连接云端或网络离线');
    return;
  }
  if (state.cloud.syncing) return;
  state.cloud.syncing = true;
  renderCloudUI();
  try {
    const row = await getCloudRow();
    if (!row) {
      state.cloud.syncing = false;
      await pushLocalToCloud({ silent });
      setCloudMessage('云端首次初始化完成：已上传当前设备数据。', 'success');
      return;
    }
    const remote = (row.data && typeof row.data === 'object') ? row.data : emptyData();
    if (!remote.meta || typeof remote.meta !== 'object') remote.meta = {};
    if (!remote.meta.updatedAt) remote.meta.updatedAt = row.updated_at;
    state.data = mergeDataStates(state.data, remote);
    ensureDefaults();
    state.data.meta.updatedAt = new Date().toISOString();
    persistLocal(false, false);
    renderAll();
    state.cloud.lastRemoteUpdatedAt = row.updated_at;
    state.cloud.syncing = false;
    await pushLocalToCloud({ silent: true });
    if (manual && !silent) toast('双向同步完成');
    setCloudMessage('双向同步完成。此设备与云端数据已合并。', 'success');
  } catch (err) {
    console.error(err);
    setCloudMessage(`同步失败：${friendlyCloudError(err)}。本地数据未丢失。`, 'error');
  } finally {
    state.cloud.syncing = false;
    renderCloudUI();
  }
}

async function pullCloudIfNewer() {
  if (!state.cloud.client || !state.cloud.user || !navigator.onLine || state.cloud.syncing) return;
  try {
    const row = await getCloudRow();
    if (!row) return;
    const known = state.cloud.lastRemoteUpdatedAt ? new Date(state.cloud.lastRemoteUpdatedAt).getTime() : 0;
    const remoteTime = new Date(row.updated_at).getTime();
    if (remoteTime > known + 1000) await syncCloudBidirectional({ silent: true });
  } catch (err) { console.warn('Cloud refresh skipped:', err); }
}

async function forceUploadLocalToCloud() {
  if (!state.cloud.user) return toast('请先登录云端账号');
  if (!confirm('确定用当前设备的数据覆盖云端数据吗？其他设备下次同步后会以这份数据为准。')) return;
  await pushLocalToCloud({ silent: false });
}

async function forceDownloadCloudToLocal() {
  if (!state.cloud.user) return toast('请先登录云端账号');
  if (!confirm('确定用云端数据覆盖当前设备的本地数据吗？建议先导出 JSON 备份。')) return;
  try {
    state.cloud.syncing = true; renderCloudUI();
    const row = await getCloudRow();
    if (!row) throw new Error('云端还没有数据');
    state.data = deepClone(row.data || emptyData());
    ensureDefaults();
    state.cloud.lastRemoteUpdatedAt = row.updated_at;
    state.data.meta.lastCloudSyncedAt = new Date().toISOString();
    persistLocal(false, false);
    renderAll();
    toast('已下载云端数据');
    setCloudMessage('已使用云端数据覆盖本机缓存。', 'success');
  } catch (err) {
    setCloudMessage(`下载失败：${friendlyCloudError(err)}`, 'error');
  } finally { state.cloud.syncing = false; renderCloudUI(); }
}

function mergeDataStates(localData, remoteData) {
  const local = deepClone(localData || emptyData());
  const remote = deepClone(remoteData || emptyData());
  const lMeta = local.meta || {};
  const rMeta = remote.meta || {};
  const lTime = isoTime(lMeta.updatedAt);
  const rTime = isoTime(rMeta.updatedAt);
  const newer = lTime >= rTime ? local : remote;

  const deletedActivities = mergeTombstones(local.deletedActivities, remote.deletedActivities);
  const deletedMemos = mergeTombstones(local.deletedMemos, remote.deletedMemos);
  const activities = mergeEntities(local.activities, remote.activities, deletedActivities);
  const memos = mergeEntities(local.memos, remote.memos, deletedMemos);
  const dayMemoMerged = mergeDayMemos(local, remote);

  const projectsUsed = activities.map(a => a.project).filter(Boolean);
  const categoriesUsed = activities.map(a => a.category).filter(Boolean);
  return {
    activities,
    memos,
    categories: [...new Set([...(newer.categories || DEFAULT_CATEGORIES), ...categoriesUsed])],
    projects: [...new Set([...(newer.projects || []), ...projectsUsed])],
    dayMemos: dayMemoMerged.values,
    dayMemoUpdatedAt: dayMemoMerged.timestamps,
    timer: deepClone(newer.timer || { active: false }),
    deletedActivities,
    deletedMemos,
    meta: {
      ...deepClone(newer.meta || {}),
      updatedAt: new Date(Math.max(lTime || 0, rTime || 0, Date.now())).toISOString()
    }
  };
}

function mergeEntities(a = [], b = [], tombstones = []) {
  const map = new Map();
  [...(a || []), ...(b || [])].forEach(item => {
    if (!item || !item.id) return;
    const prev = map.get(item.id);
    if (!prev || isoTime(item.updatedAt || item.createdAt) >= isoTime(prev.updatedAt || prev.createdAt)) map.set(item.id, item);
  });
  const tombMap = new Map((tombstones || []).map(t => [t.id, isoTime(t.deletedAt)]));
  return [...map.values()].filter(item => (tombMap.get(item.id) || 0) < isoTime(item.updatedAt || item.createdAt));
}

function upsertTombstone(list = [], id) {
  if (!id) return list || [];
  const now = new Date().toISOString();
  const map = new Map((list || []).filter(Boolean).map(t => [t.id, t]));
  map.set(id, { id, deletedAt: now });
  return [...map.values()];
}

function mergeTombstones(a = [], b = []) {
  const map = new Map();
  [...(a || []), ...(b || [])].forEach(t => {
    if (!t?.id) return;
    const prev = map.get(t.id);
    if (!prev || isoTime(t.deletedAt) > isoTime(prev.deletedAt)) map.set(t.id, t);
  });
  return [...map.values()];
}

function mergeDayMemos(local, remote) {
  const keys = new Set([
    ...Object.keys(local.dayMemos || {}), ...Object.keys(remote.dayMemos || {}),
    ...Object.keys(local.dayMemoUpdatedAt || {}), ...Object.keys(remote.dayMemoUpdatedAt || {})
  ]);
  const values = {}, timestamps = {};
  keys.forEach(key => {
    const lt = isoTime(local.dayMemoUpdatedAt?.[key] || local.meta?.updatedAt);
    const rt = isoTime(remote.dayMemoUpdatedAt?.[key] || remote.meta?.updatedAt);
    if (lt >= rt) {
      values[key] = local.dayMemos?.[key] || '';
      timestamps[key] = local.dayMemoUpdatedAt?.[key] || local.meta?.updatedAt || new Date(0).toISOString();
    } else {
      values[key] = remote.dayMemos?.[key] || '';
      timestamps[key] = remote.dayMemoUpdatedAt?.[key] || remote.meta?.updatedAt || new Date(0).toISOString();
    }
  });
  return { values, timestamps };
}

function deepClone(obj) {
  try { return structuredClone(obj); } catch { return JSON.parse(JSON.stringify(obj)); }
}
function isoTime(value) {
  const n = value ? new Date(value).getTime() : 0;
  return Number.isFinite(n) ? n : 0;
}
function friendlyCloudError(err) {
  const msg = String(err?.message || err || '未知错误');
  if (/Invalid login credentials/i.test(msg)) return '邮箱或密码不正确';
  if (/Email not confirmed/i.test(msg)) return '邮箱尚未确认，请先点击确认邮件中的链接';
  if (/relation .*phd_tracker_state.* does not exist/i.test(msg)) return '云端数据表尚未创建，请先运行 supabase_setup.sql';
  if (/row-level security/i.test(msg)) return '数据库权限策略未正确配置，请重新运行 supabase_setup.sql';
  if (err?.isCloudTimeout || /等待超过|超时|timeout/i.test(msg)) return '请求超时；请检查手机网络后重试';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return '网络连接失败或 Project URL 不正确';
  return msg;
}

function groupByProject(activities) {
  const map = new Map();
  activities.forEach(a => {
    const project = (a.project || '').trim();
    if (!project) return;
    const current = map.get(project) || { name: project, minutes: 0, count: 0, lastDate: '' };
    current.minutes += durationMinutes(a);
    current.count += 1;
    if (!current.lastDate || a.date > current.lastDate) current.lastDate = a.date;
    map.set(project, current);
  });
  return [...map.values()].sort((a,b)=>b.minutes-a.minutes);
}

function renderProjectStats(activities) {
  if (!els.projectStats) return;
  const projects = groupByProject(activities);
  const total = activities.reduce((s,a)=>s+durationMinutes(a),0) || 1;
  if (!projects.length) {
    els.projectStats.innerHTML = '<div class="empty-state project-empty">暂无项目/论文归属数据。编辑一条时间记录并填写“项目 / 论文”即可开始统计。</div>';
    return;
  }
  els.projectStats.innerHTML = projects.slice(0, 20).map((p, index) => {
    const pct = Math.round(p.minutes / total * 100);
    return `<div class="project-stat-card">
      <div class="project-stat-rank">${String(index+1).padStart(2,'0')}</div>
      <div class="project-stat-main">
        <strong>${escapeHtml(p.name)}</strong>
        <span>${p.count} 条记录 · 最近 ${p.lastDate.slice(5)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,p.minutes/Math.max(...projects.map(x=>x.minutes))*100)}%"></div></div>
      </div>
      <div class="project-stat-time"><strong>${formatMinutes(p.minutes)}</strong><span>${pct}%</span></div>
    </div>`;
  }).join('');
}

function renderResearchHeatmap() {
  if (!els.researchHeatmap) return;
  const year = state.heatmapYear;
  const currentYear = new Date().getFullYear();
  els.heatmapYearLabel.textContent = `${year} 年`;
  els.heatmapNextYearBtn.disabled = year >= currentYear;

  const jan1 = new Date(year,0,1);
  const dec31 = new Date(year,11,31);
  const start = addDays(jan1, -((jan1.getDay()+6)%7));
  const end = addDays(dec31, 6-((dec31.getDay()+6)%7));
  const daily = new Map();
  state.data.activities
    .filter(a => a.category === '科研' && a.date.startsWith(`${year}-`))
    .forEach(a => daily.set(a.date, (daily.get(a.date)||0) + durationMinutes(a)));

  let html = '';
  let totalMinutes = 0;
  let activeDays = 0;
  let streak = 0;
  let longestStreak = 0;
  const cells = [];
  for (let d = new Date(start); d <= end; d = addDays(d,1)) {
    const key = toDateKey(d);
    const inYear = d.getFullYear() === year;
    const minutes = inYear ? (daily.get(key) || 0) : 0;
    if (inYear) {
      totalMinutes += minutes;
      if (minutes > 0) { activeDays += 1; streak += 1; longestStreak = Math.max(longestStreak, streak); }
      else streak = 0;
    }
    const level = heatLevel(minutes);
    const title = `${key} · ${minutes ? formatMinutes(minutes) : '无科研记录'}`;
    cells.push(`<div class="heat-cell heat-${level} ${inYear?'':'heat-outside'}" title="${title}" aria-label="${title}"></div>`);
  }
  html = cells.join('');
  els.researchHeatmap.innerHTML = html;

  const weeks = Math.ceil(cells.length / 7);
  els.researchHeatmap.style.gridTemplateColumns = `repeat(${weeks}, 12px)`;
  const labels = Array(weeks).fill('');
  for (let month=0; month<12; month++) {
    const date = new Date(year, month, 1);
    const weekIndex = Math.floor((date - start) / 86400000 / 7);
    if (weekIndex >= 0 && weekIndex < weeks) labels[weekIndex] = `${month+1}月`;
  }
  els.heatmapMonths.style.gridTemplateColumns = `repeat(${weeks}, 12px)`;
  els.heatmapMonths.innerHTML = labels.map(x=>`<span>${x}</span>`).join('');
  els.heatmapSummary.innerHTML = `
    <div class="heatmap-stat"><span>全年科研</span><strong>${formatMinutes(totalMinutes)}</strong></div>
    <div class="heatmap-stat"><span>科研活跃天数</span><strong>${activeDays} 天</strong></div>
    <div class="heatmap-stat"><span>最长连续投入</span><strong>${longestStreak} 天</strong></div>`;
}

function heatLevel(minutes) {
  if (!minutes) return 0;
  if (minutes < 60) return 1;
  if (minutes < 180) return 2;
  if (minutes < 360) return 3;
  return 4;
}

function jumpToToday() {
  const key = toDateKey(new Date());
  state.selectedDate = key;
  state.selectedCalendarDate = key;
  state.calendarCursor = startOfMonth(new Date());
  renderAll();
}
function shiftSelectedDay(delta) { state.selectedDate = toDateKey(addDays(parseDateKey(state.selectedDate), delta)); renderToday(); renderPageMeta(); }

function getActivitiesForDate(key) { return state.data.activities.filter(a=>a.date===key); }
function groupByCategory(activities) {
  const map = new Map();
  activities.forEach(a=>map.set(a.category || '未分类', (map.get(a.category || '未分类')||0)+durationMinutes(a)));
  return [...map.entries()].map(([name,minutes])=>({name,minutes})).sort((a,b)=>b.minutes-a.minutes);
}
function groupByTag(activities) {
  const map = new Map();
  activities.forEach(a=>{
    const d = durationMinutes(a);
    (a.tags||[]).forEach(tag=>map.set(tag,(map.get(tag)||0)+d));
  });
  return [...map.entries()].map(([name,minutes])=>({name,minutes})).sort((a,b)=>b.minutes-a.minutes);
}
function categoryColor(name) {
  const idx = Math.abs(hashString(name)) % CATEGORY_COLORS.length;
  return CATEGORY_COLORS[idx];
}
function hashString(str='') { let h=0; for (let i=0;i<str.length;i++) h=((h<<5)-h)+str.charCodeAt(i)|0; return h; }
function durationMinutes(a) { return Math.max(0,timeToMinutes(a.endTime)-timeToMinutes(a.startTime)); }
function timeToMinutes(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
function compareByStart(a,b) { return a.startTime.localeCompare(b.startTime); }
function normalizeTags(value) { return [...new Set(value.split(/[,，#]/).map(x=>x.trim()).filter(Boolean))]; }

function uid() { return (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`); }
function pad(n) { return String(n).padStart(2,'0'); }
function toDateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
function parseDateKey(key) { const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d); }
function startOfMonth(date) { return new Date(date.getFullYear(),date.getMonth(),1); }
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate()+n); return d; }
function addMonths(date, n) { return new Date(date.getFullYear(),date.getMonth()+n,1); }
function roundTime(date, step=5) { const d=new Date(date); d.setSeconds(0,0); d.setMinutes(Math.round(d.getMinutes()/step)*step); return d; }
function toTimeValue(date) { return `${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function formatClock(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function minutesToTime(min) { min = Math.max(0, Math.min(1439, Math.round(min))); return `${pad(Math.floor(min/60))}:${pad(min%60)}`; }
function formatMinutes(min) { min = Math.round(min); const h=Math.floor(min/60), m=min%60; return h ? `${h}h ${pad(m)}m` : `${m}m`; }
function formatFullDate(date) { return new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(date); }
function formatDateTime(iso) { return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso)); }
function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
function toast(msg) { els.toast.textContent=msg; els.toast.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>els.toast.classList.remove('show'),1800); }
