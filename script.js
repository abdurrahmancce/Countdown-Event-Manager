'use strict';

/* ─── Constants ─── */
const STORAGE_KEY = 'countdown_events_v2';
const CATEGORIES = {
  general:   { label: 'General',   emoji: '📌' },
  birthday:  { label: 'Birthday',  emoji: '🎂' },
  work:      { label: 'Work',      emoji: '💼' },
  travel:    { label: 'Travel',    emoji: '✈️' },
  sports:    { label: 'Sports',    emoji: '⚽' },
  music:     { label: 'Music',     emoji: '🎵' },
  holiday:   { label: 'Holiday',   emoji: '🌴' },
  health:    { label: 'Health',    emoji: '💊' },
  finance:   { label: 'Finance',   emoji: '💰' },
  education: { label: 'Education', emoji: '📚' },
};

/* ─── State ─── */
let events = [];
let activeFilter = 'all';
let activeSort   = 'nearest';
let searchQuery  = '';
let tickInterval = null;
let editingId    = null;
let pendingDeleteId = null;
let notifiedEvents  = new Set();
let selectedColor   = '#f59e0b';
let celebrationScheduled = null;

/* ─── DOM References ─── */
const eventsGrid     = document.getElementById('eventsGrid');
const emptyState     = document.getElementById('emptyState');
const emptyTitle     = document.getElementById('emptyTitle');
const emptyMsg       = document.getElementById('emptyMsg');
const eventModal     = document.getElementById('eventModal');
const deleteModal    = document.getElementById('deleteModal');
const modalBackdrop  = document.getElementById('modalBackdrop');
const eventForm      = document.getElementById('eventForm');
const modalTitleEl   = document.getElementById('modalTitle');
const saveBtnEl      = document.getElementById('saveBtn');
const searchInput    = document.getElementById('searchInput');
const sortSelect     = document.getElementById('sortSelect');
const notifyToggle   = document.getElementById('notifyToggle');
const notifyOptions  = document.getElementById('notifyOptions');
const celebrationOverlay = document.getElementById('celebrationOverlay');

/* ═══════════════════════════════
   STORAGE
═══════════════════════════════ */
function loadEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    events = raw ? JSON.parse(raw) : [];
  } catch { events = []; }
}

function saveEvents() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch(e) { console.error('Storage write failed', e); }
}

/* ═══════════════════════════════
   UTILITIES
═══════════════════════════════ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getTargetDate(event) {
  return new Date(`${event.date}T${event.time}`);
}

function isExpired(event) {
  return getTargetDate(event) <= new Date();
}

function parseCountdown(targetDate) {
  const diff = targetDate - new Date();
  if (diff <= 0) return null;
  const days    = Math.floor(diff / 86400000);
  const hours   = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { days, hours, minutes, seconds, diff };
}

function formatTargetDate(event) {
  const d = getTargetDate(event);
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function padTwo(n) { return String(n).padStart(2, '0'); }

function progressPercent(event) {
  const created = event.createdAt;
  const target  = getTargetDate(event).getTime();
  const now     = Date.now();
  if (now >= target) return 100;
  const total   = target - created;
  const elapsed = now - created;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : null;
}

/* ═══════════════════════════════
   RENDER
═══════════════════════════════ */
function getFilteredSortedEvents() {
  let list = [...events];

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(e =>
      e.title.toLowerCase().includes(q) ||
      (e.description || '').toLowerCase().includes(q) ||
      CATEGORIES[e.category]?.label.toLowerCase().includes(q)
    );
  }

  // Filter
  if (activeFilter === 'upcoming') list = list.filter(e => !isExpired(e));
  if (activeFilter === 'expired')  list = list.filter(e => isExpired(e));

  // Sort
  const now = Date.now();
  if (activeSort === 'nearest') {
    list.sort((a, b) => {
      const da = Math.abs(getTargetDate(a) - now);
      const db = Math.abs(getTargetDate(b) - now);
      return da - db;
    });
  } else if (activeSort === 'farthest') {
    list.sort((a, b) => getTargetDate(b) - getTargetDate(a));
  } else if (activeSort === 'created') {
    list.sort((a, b) => b.createdAt - a.createdAt);
  } else if (activeSort === 'name') {
    list.sort((a, b) => a.title.localeCompare(b.title));
  }

  return list;
}

function renderEvents() {
  const list = getFilteredSortedEvents();

  // Stats
  document.getElementById('statTotal').textContent    = events.length;
  document.getElementById('statUpcoming').textContent = events.filter(e => !isExpired(e)).length;
  document.getElementById('statExpired').textContent  = events.filter(e => isExpired(e)).length;

  if (list.length === 0) {
    eventsGrid.innerHTML = '';
    emptyState.classList.remove('hidden');
    if (searchQuery) {
      emptyTitle.textContent = 'No results found';
      emptyMsg.textContent   = `No events match "${searchQuery}".`;
      document.getElementById('emptyAddBtn').classList.add('hidden');
    } else if (activeFilter !== 'all') {
      emptyTitle.textContent = activeFilter === 'expired' ? 'No expired events' : 'No upcoming events';
      emptyMsg.textContent   = 'Try a different filter.';
      document.getElementById('emptyAddBtn').classList.add('hidden');
    } else {
      emptyTitle.textContent = 'No events yet';
      emptyMsg.textContent   = 'Create your first countdown event to get started.';
      document.getElementById('emptyAddBtn').classList.remove('hidden');
    }
    return;
  }
  emptyState.classList.add('hidden');

  // Build cards
  const fragment = document.createDocumentFragment();
  list.forEach(event => {
    const card = buildCard(event);
    fragment.appendChild(card);
  });
  eventsGrid.innerHTML = '';
  eventsGrid.appendChild(fragment);
}

function buildCard(event) {
  const expired   = isExpired(event);
  const cat       = CATEGORIES[event.category] || CATEGORIES.general;
  const color     = event.color || '#f59e0b';
  const rgb       = hexToRgb(color);
  const colorRgba = rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)` : 'rgba(245,158,11,0.15)';

  const card = document.createElement('div');
  card.className = `event-card${expired ? ' expired' : ''}`;
  card.dataset.id = event.id;
  card.style.setProperty('--unit-color', color);

  const pct     = progressPercent(event);
  const pctLeft = (100 - pct).toFixed(1);

  let countdownHTML = '';
  if (expired) {
    countdownHTML = `
      <div class="expired-badge">
        <span class="badge-icon">⏰</span>
        <span>${event.expiredMsg || 'Event Started'}</span>
      </div>`;
  } else {
    const cd = parseCountdown(getTargetDate(event));
    const d  = cd ? padTwo(cd.days)    : '00';
    const h  = cd ? padTwo(cd.hours)   : '00';
    const m  = cd ? padTwo(cd.minutes) : '00';
    const s  = cd ? padTwo(cd.seconds) : '00';
    countdownHTML = `
      <div class="countdown-display">
        <div class="countdown-unit"><span class="countdown-num" data-unit="days">${d}</span><span class="countdown-label">Days</span></div>
        <div class="countdown-unit"><span class="countdown-num" data-unit="hours">${h}</span><span class="countdown-label">Hours</span></div>
        <div class="countdown-unit"><span class="countdown-num" data-unit="mins">${m}</span><span class="countdown-label">Mins</span></div>
        <div class="countdown-unit"><span class="countdown-num" data-unit="secs">${s}</span><span class="countdown-label">Secs</span></div>
      </div>`;
  }

  const progressHTML = !expired ? `
    <div class="progress-wrap">
      <div class="progress-header">
        <span>Progress</span>
        <span>${pctLeft}% remaining</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" data-progress style="width:${pct.toFixed(1)}%; background:${color}"></div>
      </div>
    </div>` : '';

  const descHTML = event.description
    ? `<p class="card-desc">${escapeHtml(event.description)}</p>` : '';

  const notifyHTML = event.notify
    ? `<span class="notify-pill">🔔 ${getNotifyLabel(event.notifyMinutes)}</span>` : '';

  card.innerHTML = `
    <div class="card-accent-strip" style="background:${color}"></div>
    <div class="card-header">
      <div class="card-meta">
        <span class="card-category" style="color:${color};background:${colorRgba};">
          ${cat.emoji} ${cat.label}
        </span>
        <span class="card-title" title="${escapeHtml(event.title)}">${escapeHtml(event.title)}</span>
      </div>
      <div class="card-actions">
        <button class="card-btn edit" data-id="${event.id}" title="Edit event" aria-label="Edit">
          <svg viewBox="0 0 20 20" fill="none"><path d="M4 14.5L14 4.5l1.5 1.5-10 10H4v-1.5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 6l1.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        </button>
        <button class="card-btn delete" data-id="${event.id}" title="Delete event" aria-label="Delete">
          <svg viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>
    ${countdownHTML}
    ${progressHTML}
    ${descHTML}
    <div class="card-footer">
      <span class="card-date">
        <svg viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M5 2v2M11 2v2M2 7h12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        ${formatTargetDate(event)}
      </span>
      ${notifyHTML}
    </div>`;

  // Bind buttons
  card.querySelector('.edit').addEventListener('click', () => openEditModal(event.id));
  card.querySelector('.delete').addEventListener('click', () => openDeleteModal(event.id));

  return card;
}

function getNotifyLabel(mins) {
  if (!mins) return '1 hr before';
  if (mins < 60) return `${mins} min before`;
  if (mins === 60) return '1 hr before';
  if (mins === 1440) return '1 day before';
  return `${Math.floor(mins/60)} hrs before`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* ═══════════════════════════════
   LIVE TICK
═══════════════════════════════ */
function startTick() {
  stopTick();
  tickInterval = setInterval(tick, 1000);
}

function stopTick() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

function tick() {
  const cards = eventsGrid.querySelectorAll('.event-card:not(.expired)');
  let needsRebuild = false;

  cards.forEach(card => {
    const id    = card.dataset.id;
    const event = events.find(e => e.id === id);
    if (!event) return;

    if (isExpired(event)) {
      needsRebuild = true;
      triggerCelebration(event);
      return;
    }

    const cd = parseCountdown(getTargetDate(event));
    if (!cd) { needsRebuild = true; return; }

    updateNum(card, 'days',  padTwo(cd.days));
    updateNum(card, 'hours', padTwo(cd.hours));
    updateNum(card, 'mins',  padTwo(cd.minutes));
    updateNum(card, 'secs',  padTwo(cd.seconds));

    // Update progress
    const fill = card.querySelector('[data-progress]');
    if (fill) {
      const pct = progressPercent(event);
      fill.style.width = pct.toFixed(1) + '%';
      const pctLeft = (100 - pct).toFixed(1);
      const header = card.querySelector('.progress-header');
      if (header) header.children[1].textContent = `${pctLeft}% remaining`;
    }

    // Check notification
    checkNotification(event, cd.diff);
  });

  if (needsRebuild) renderEvents();
}

function updateNum(card, unit, val) {
  const el = card.querySelector(`[data-unit="${unit}"]`);
  if (el && el.textContent !== val) {
    el.textContent = val;
    el.classList.remove('tick');
    void el.offsetWidth; // reflow
    el.classList.add('tick');
  }
}

/* ═══════════════════════════════
   NOTIFICATIONS
═══════════════════════════════ */
function checkNotification(event, diffMs) {
  if (!event.notify || notifiedEvents.has(event.id)) return;
  const mins = event.notifyMinutes || 60;
  const threshold = mins * 60 * 1000;
  if (diffMs <= threshold) {
    notifiedEvents.add(event.id);
    showToast(`🔔 "${event.title}" starts in ${getNotifyLabel(mins)}!`);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`Countdown: ${event.title}`, {
        body: `Starts in ${getNotifyLabel(mins)}`,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" stroke="%23f59e0b" stroke-width="1.5" fill="none"/><path d="M14 7v7l4.5 4.5" stroke="%23f59e0b" stroke-width="2" stroke-linecap="round" fill="none"/></svg>'
      });
    }
  }
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

/* ═══════════════════════════════
   TOAST
═══════════════════════════════ */
let toastEl = null;
function showToast(msg, duration = 4000) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.style.cssText = `
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      background:var(--bg-elevated); color:var(--text-primary);
      border:1px solid var(--border-medium); border-radius:99px;
      padding:10px 20px; font-family:var(--font-ui); font-size:0.88rem;
      box-shadow:0 8px 32px rgba(0,0,0,0.4);
      z-index:400; white-space:nowrap;
      transition: opacity 0.3s ease, transform 0.3s ease;
    `;
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  toastEl.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateX(-50%) translateY(8px)';
  }, duration);
}

/* ═══════════════════════════════
   CELEBRATION
═══════════════════════════════ */
function triggerCelebration(event) {
  if (celebrationScheduled === event.id) return;
  celebrationScheduled = event.id;

  document.getElementById('celebrationTitle').textContent = `"${event.title}" has begun!`;
  document.getElementById('celebrationSub').textContent   = 'Your countdown reached zero. 🚀';
  spawnConfetti();
  celebrationOverlay.classList.remove('hidden');
}

function closeCelebration() {
  celebrationOverlay.classList.add('hidden');
  document.getElementById('confettiContainer').innerHTML = '';
  celebrationScheduled = null;
}

function spawnConfetti() {
  const container = document.getElementById('confettiContainer');
  container.innerHTML = '';
  const colors = ['#f59e0b','#3b82f6','#10b981','#ef4444','#8b5cf6','#ec4899','#06b6d4'];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.cssText = `
      left: ${Math.random() * 100}%;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      width: ${6 + Math.random() * 8}px;
      height: ${6 + Math.random() * 8}px;
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      animation-duration: ${1.5 + Math.random() * 2}s;
      animation-delay: ${Math.random() * 0.8}s;
    `;
    container.appendChild(piece);
  }
}

window.closeCelebration = closeCelebration;

/* ═══════════════════════════════
   MODAL — ADD / EDIT
═══════════════════════════════ */
function openAddModal() {
  editingId = null;
  eventForm.reset();
  document.getElementById('editingId').value = '';
  modalTitleEl.textContent = 'New Event';
  saveBtnEl.textContent    = 'Create Event';
  clearFormErrors();
  setDefaultDateTime();
  setColorSwatch('#f59e0b');
  selectedColor = '#f59e0b';
  notifyOptions.classList.add('hidden');
  showModal(eventModal);
  document.getElementById('eventTitle').focus();
}

function openEditModal(id) {
  const event = events.find(e => e.id === id);
  if (!event) return;
  editingId = id;
  document.getElementById('editingId').value = id;
  modalTitleEl.textContent = 'Edit Event';
  saveBtnEl.textContent    = 'Save Changes';

  document.getElementById('eventTitle').value    = event.title;
  document.getElementById('eventDate').value     = event.date;
  document.getElementById('eventTime').value     = event.time;
  document.getElementById('eventCategory').value = event.category || 'general';
  document.getElementById('eventDesc').value     = event.description || '';
  document.getElementById('notifyToggle').checked = !!event.notify;
  document.getElementById('notifyMinutes').value  = event.notifyMinutes || 60;
  notifyOptions.classList.toggle('hidden', !event.notify);
  updateCharCount(event.description || '');
  setColorSwatch(event.color || '#f59e0b');
  selectedColor = event.color || '#f59e0b';
  clearFormErrors();
  showModal(eventModal);
  document.getElementById('eventTitle').focus();
}

function setDefaultDateTime() {
  const now = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  document.getElementById('eventDate').value = now.toISOString().slice(0, 10);
  document.getElementById('eventTime').value = '12:00';
}

function showModal(modal) {
  modal.classList.remove('hidden');
  modalBackdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function hideModals() {
  eventModal.classList.add('hidden');
  deleteModal.classList.add('hidden');
  modalBackdrop.classList.add('hidden');
  document.body.style.overflow = '';
}

/* ─── Form Submission ─── */
eventForm.addEventListener('submit', e => {
  e.preventDefault();
  if (!validateForm()) return;

  const title       = document.getElementById('eventTitle').value.trim();
  const date        = document.getElementById('eventDate').value;
  const time        = document.getElementById('eventTime').value;
  const category    = document.getElementById('eventCategory').value;
  const description = document.getElementById('eventDesc').value.trim();
  const notify      = document.getElementById('notifyToggle').checked;
  const notifyMins  = parseInt(document.getElementById('notifyMinutes').value, 10);
  const color       = selectedColor;

  if (editingId) {
    const idx = events.findIndex(e => e.id === editingId);
    if (idx !== -1) {
      events[idx] = { ...events[idx], title, date, time, category, description, notify, notifyMinutes: notifyMins, color };
      notifiedEvents.delete(editingId); // reset notification flag
    }
    showToast(`✏️ "${title}" updated`);
  } else {
    const newEvent = {
      id: uid(), title, date, time, category, description,
      notify, notifyMinutes: notifyMins, color,
      createdAt: Date.now()
    };
    events.unshift(newEvent);
    showToast(`✅ "${title}" created`);
    requestNotificationPermission();
  }

  saveEvents();
  hideModals();
  renderEvents();
});

function validateForm() {
  let valid = true;
  clearFormErrors();

  const title = document.getElementById('eventTitle').value.trim();
  if (!title) {
    document.getElementById('titleError').textContent = 'Event title is required.';
    valid = false;
  }

  const date = document.getElementById('eventDate').value;
  if (!date) {
    document.getElementById('dateError').textContent = 'Please select a date.';
    valid = false;
  }

  const time = document.getElementById('eventTime').value;
  if (!time) {
    document.getElementById('timeError').textContent = 'Please select a time.';
    valid = false;
  }

  return valid;
}

function clearFormErrors() {
  ['titleError','dateError','timeError'].forEach(id => {
    document.getElementById(id).textContent = '';
  });
  document.querySelectorAll('.form-input').forEach(el => el.classList.remove('error'));
}

/* ─── Color Picker ─── */
document.getElementById('colorPicker').addEventListener('click', e => {
  const swatch = e.target.closest('.color-swatch');
  if (!swatch) return;
  setColorSwatch(swatch.dataset.color);
  selectedColor = swatch.dataset.color;
});

function setColorSwatch(color) {
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === color);
  });
  document.getElementById('eventColor').value = color;
  selectedColor = color;
}

/* ─── Char Counter ─── */
document.getElementById('eventDesc').addEventListener('input', function() {
  updateCharCount(this.value);
});
function updateCharCount(val) {
  document.getElementById('descCount').textContent = `${val.length} / 280`;
}

/* ─── Notify Toggle ─── */
notifyToggle.addEventListener('change', function() {
  notifyOptions.classList.toggle('hidden', !this.checked);
});

/* ═══════════════════════════════
   DELETE MODAL
═══════════════════════════════ */
function openDeleteModal(id) {
  const event = events.find(e => e.id === id);
  if (!event) return;
  pendingDeleteId = id;
  document.getElementById('deleteEventName').textContent = event.title;
  showModal(deleteModal);
}

document.getElementById('deleteConfirmBtn').addEventListener('click', () => {
  if (!pendingDeleteId) return;
  const event = events.find(e => e.id === pendingDeleteId);
  events = events.filter(e => e.id !== pendingDeleteId);
  notifiedEvents.delete(pendingDeleteId);
  pendingDeleteId = null;
  saveEvents();
  hideModals();
  renderEvents();
  if (event) showToast(`🗑️ "${event.title}" deleted`);
});

['deleteCancelBtn','deleteCancelX'].forEach(id => {
  document.getElementById(id).addEventListener('click', hideModals);
});

/* ═══════════════════════════════
   HEADER CONTROLS
═══════════════════════════════ */
document.getElementById('addEventBtn').addEventListener('click', openAddModal);
document.getElementById('emptyAddBtn').addEventListener('click', openAddModal);
document.getElementById('modalClose').addEventListener('click', hideModals);
document.getElementById('cancelBtn').addEventListener('click', hideModals);
modalBackdrop.addEventListener('click', hideModals);

// Prevent modal clicks from closing
[eventModal, deleteModal].forEach(m => m.addEventListener('click', e => e.stopPropagation()));

// Filter buttons
document.querySelectorAll('.nav-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderEvents();
  });
});

// Sort
sortSelect.addEventListener('change', () => {
  activeSort = sortSelect.value;
  renderEvents();
});

// Search
searchInput.addEventListener('input', function() {
  searchQuery = this.value.trim();
  renderEvents();
});

// Theme Toggle
document.getElementById('themeToggle').addEventListener('click', () => {
  const html = document.documentElement;
  const newTheme = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('countdown_theme', newTheme);
});

/* ═══════════════════════════════
   EXPORT / IMPORT
═══════════════════════════════ */
document.getElementById('exportBtn').addEventListener('click', () => {
  if (events.length === 0) { showToast('⚠️ No events to export'); return; }
  const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `countdown-events-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`📤 Exported ${events.length} event(s)`);
});

document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      const valid = imported.filter(ev =>
        ev.id && ev.title && ev.date && ev.time
      );
      // Merge (no duplicates)
      const existingIds = new Set(events.map(e => e.id));
      const newOnes = valid.filter(ev => !existingIds.has(ev.id));
      events = [...events, ...newOnes];
      saveEvents();
      renderEvents();
      showToast(`📥 Imported ${newOnes.length} new event(s)`);
    } catch {
      showToast('❌ Invalid JSON file');
    }
  };
  reader.readAsText(file);
  this.value = ''; // reset so same file can be re-imported
});

/* ═══════════════════════════════
   KEYBOARD
═══════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!celebrationOverlay.classList.contains('hidden')) {
      closeCelebration(); return;
    }
    hideModals();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    openAddModal();
  }
});

/* ═══════════════════════════════
   SEED DATA (first run only)
═══════════════════════════════ */
function seedSampleEvents() {
  const now = Date.now();
  const day = 86400000;
  events = [
    {
      id: uid(), title: 'New Year 2026',
      date: '2026-01-01', time: '00:00',
      category: 'holiday', color: '#f59e0b',
      description: 'Welcome the new year with fireworks and celebrations!',
      notify: false, notifyMinutes: 60,
      createdAt: now - 10 * day
    },
    {
      id: uid(), title: 'Product Launch v3.0',
      date: new Date(now + 14 * day).toISOString().slice(0,10), time: '10:00',
      category: 'work', color: '#3b82f6',
      description: 'Major release with new features and improved performance.',
      notify: true, notifyMinutes: 1440,
      createdAt: now - 3 * day
    },
    {
      id: uid(), title: 'Team Hiking Trip',
      date: new Date(now + 3 * day).toISOString().slice(0,10), time: '07:30',
      category: 'travel', color: '#10b981',
      description: 'Annual team retreat — mountain trail, 12km round trip.',
      notify: true, notifyMinutes: 60,
      createdAt: now - 1 * day
    },
    {
      id: uid(), title: 'Annual Conference',
      date: new Date(now + 45 * day).toISOString().slice(0,10), time: '09:00',
      category: 'education', color: '#8b5cf6',
      description: 'Industry summit — keynotes, workshops & networking.',
      notify: false, notifyMinutes: 60,
      createdAt: now - 5 * day
    },
    {
      id: uid(), title: 'Birthday Celebration',
      date: new Date(now + 7 * day).toISOString().slice(0,10), time: '19:00',
      category: 'birthday', color: '#ec4899',
      description: 'Surprise party — remember to keep it secret!',
      notify: true, notifyMinutes: 30,
      createdAt: now - 2 * day
    }
  ];
  saveEvents();
}

/* ═══════════════════════════════
   INIT
═══════════════════════════════ */
function init() {
  // Restore theme
  const savedTheme = localStorage.getItem('countdown_theme');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

  // Load data
  loadEvents();
  if (events.length === 0) seedSampleEvents();

  renderEvents();
  startTick();
}

document.addEventListener('DOMContentLoaded', init);