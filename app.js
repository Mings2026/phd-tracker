const STORAGE_KEY = 'phdTrackerV1';
const DEFAULT_CATEGORIES = ['科研', '学习', '会议', '生活', '运动', '娱乐'];
const CATEGORY_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#ea580c', '#db2777', '#4f46e5', '#ca8a04'];

const state = {
  data: loadData(),
  currentPage: 'today',
  selectedDate: toDateKey(new Date()),
  calendarCursor: startOfMonth(new Date()),
  selectedCalendarDate: toDateKey(new Date()),
  editingMemoId: null,
  statsRange: { type: '7', start: null, end: null }
};

const els = {};
document.addEventListener('DOMContentLoaded', init);

function init() {
  cacheElements();
  bindEvents();
  ensureDefaults();
  populateCategorySelect();
  renderAll();
}

function cacheElements() {
  document.querySelectorAll('[id]').forEach(el => { els[el.id] = el; });
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

  els.newMemoBtn.addEventListener('click', newMemo);
  els.saveMemoBtn.addEventListener('click', saveMemo);
  els.deleteMemoBtn.addEventListener('click', deleteMemo);

  els.exportBtn.addEventListener('click', exportData);
  els.importInput.addEventListener('change', importData);
  els.addCategoryBtn.addEventListener('click', addCategory);
  els.newCategoryInput.addEventListener('keydown', e => { if (e.key === 'Enter') addCategory(); });
  els.clearAllBtn.addEventListener('click', clearAllData);

  els.closeActivityModalBtn.addEventListener('click', closeActivityModal);
  els.cancelActivityBtn.addEventListener('click', closeActivityModal);
  els.activityModalBackdrop.addEventListener('click', e => { if (e.target === els.activityModalBackdrop) closeActivityModal(); });
  els.activityForm.addEventListener('submit', saveActivityFromForm);
  els.deleteActivityBtn.addEventListener('click', deleteCurrentActivity);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeActivityModal(); });
}

function ensureDefaults() {
  if (!Array.isArray(state.data.categories) || !state.data.categories.length) state.data.categories = [...DEFAULT_CATEGORIES];
  if (!Array.isArray(state.data.activities)) state.data.activities = [];
  if (!Array.isArray(state.data.memos)) state.data.memos = [];
  if (!state.data.dayMemos) state.data.dayMemos = {};
  saveData();
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { activities: [], categories: [...DEFAULT_CATEGORIES], memos: [], dayMemos: {} };
    return JSON.parse(raw);
  } catch {
    return { activities: [], categories: [...DEFAULT_CATEGORIES], memos: [], dayMemos: {} };
  }
}
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); }

function renderAll() {
  renderToday();
  renderCalendar();
  renderStats();
  renderMemoList();
  renderCategoryManager();
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
    settings: ['设置', '管理类别、备份与本地数据']
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
      <strong>${escapeHtml(a.title)}</strong><span>${a.startTime}–${a.endTime} · ${escapeHtml(a.category)}</span>
    </button>`).join('') : '<div class="empty-state">当天暂无记录</div>';
  els.selectedDayActivities.querySelectorAll('[data-activity-id]').forEach(btn => btn.addEventListener('click', () => openActivityModalById(btn.dataset.activityId)));
  els.selectedDayMemo.value = state.data.dayMemos[key] || '';
}

function saveDayMemo() {
  state.data.dayMemos[state.selectedCalendarDate] = els.selectedDayMemo.value.trim();
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
  saveData(); renderMemoList(); toast('备忘录已保存');
}
function deleteMemo() {
  if (!state.editingMemoId) return;
  const memo = state.data.memos.find(m=>m.id===state.editingMemoId);
  if (!memo || !confirm(`确定删除“${memo.title || '未命名备忘录'}”吗？`)) return;
  state.data.memos = state.data.memos.filter(m=>m.id!==state.editingMemoId);
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
    tags: normalizeTags(els.activityTags.value),
    note: els.activityNote.value.trim(),
    createdAt: id ? (state.data.activities.find(x=>x.id===id)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!item.title) return toast('请填写“做了什么”');
  if (id) state.data.activities = state.data.activities.map(a => a.id===id ? item : a);
  else state.data.activities.push(item);
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
  saveData(); closeActivityModal(); renderAll(); toast('记录已删除');
}

function populateCategorySelect() {
  const current = els.activityCategory?.value;
  els.activityCategory.innerHTML = state.data.categories.map(c=>`<option>${escapeHtml(c)}</option>`).join('');
  if (current && state.data.categories.includes(current)) els.activityCategory.value = current;
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
  saveData(); populateCategorySelect(); renderCategoryManager(); toast('类别已添加');
}
function removeCategory(name) {
  if (state.data.categories.length <= 1) return toast('至少保留一个类别');
  const count = state.data.activities.filter(a=>a.category===name).length;
  if (count && !confirm(`已有 ${count} 条记录使用“${name}”。删除类别不会删除这些历史记录。继续吗？`)) return;
  state.data.categories = state.data.categories.filter(c=>c!==name);
  saveData(); populateCategorySelect(); renderCategoryManager(); toast('类别已删除');
}

function exportData() {
  const payload = {
    app: 'PhD Tracker', version: 1, exportedAt: new Date().toISOString(), data: state.data
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
    const byId = new Map(state.data.activities.map(a=>[a.id,a]));
    incoming.activities.forEach(a=>byId.set(a.id || uid(), a));
    state.data.activities = [...byId.values()];

    const memoMap = new Map(state.data.memos.map(m=>[m.id,m]));
    (incoming.memos || []).forEach(m=>memoMap.set(m.id || uid(),m));
    state.data.memos = [...memoMap.values()];
    state.data.categories = [...new Set([...(state.data.categories||[]), ...(incoming.categories||[])])];
    state.data.dayMemos = { ...(state.data.dayMemos||{}), ...(incoming.dayMemos||{}) };
    saveData(); ensureDefaults(); renderAll(); toast('备份已成功导入并合并');
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
  state.data = { activities: [], categories: [...DEFAULT_CATEGORIES], memos: [], dayMemos: {} };
  state.editingMemoId = null;
  saveData(); renderAll(); toast('全部数据已清空');
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
function formatMinutes(min) { min = Math.round(min); const h=Math.floor(min/60), m=min%60; return h ? `${h}h ${pad(m)}m` : `${m}m`; }
function formatFullDate(date) { return new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(date); }
function formatDateTime(iso) { return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso)); }
function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
function toast(msg) { els.toast.textContent=msg; els.toast.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>els.toast.classList.remove('show'),1800); }
