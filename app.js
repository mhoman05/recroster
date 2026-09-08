/* RecRoster — track recommended books, movies & TV. No build step, no backend. */
'use strict';

const STORE_KEY = 'recroster.v1';
const TYPES = {
  book:      { label: 'Book',      icon: '📖', done: 'read',    active: 'reading',  want: 'want to read' },
  audiobook: { label: 'Audiobook', icon: '🎧', done: 'read',    active: 'reading',  want: 'want to read' },
  movie:     { label: 'Movie',     icon: '🎬', done: 'watched', active: 'watching', want: 'want to watch' },
  tv:        { label: 'TV',        icon: '📺', done: 'watched', active: 'watching', want: 'want to watch' },
};
const STATUSES = ['want', 'active', 'done'];

/* ---------- storage ---------- */
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.items) return s;
  } catch (e) {}
  return { version: 1, items: [], settings: { tmdbKey: '' } };
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
let state = load();

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const now = () => new Date().toISOString();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- providers ---------- */
async function searchBooks(q, wantAudio) {
  const type = wantAudio ? 'audiobook' : 'book';
  // Primary: Open Library (keyless, lenient).
  try {
    const fields = 'key,title,author_name,first_publish_year,cover_i,number_of_pages_median';
    const url = `https://openlibrary.org/search.json?limit=20&fields=${fields}&q=` +
      encodeURIComponent(q);
    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      const rows = (data.docs || []).map(d => ({
        type,
        source: { provider: 'openlibrary', id: d.key },
        title: d.title || 'Untitled',
        creator: (d.author_name || []).slice(0, 2).join(', '),
        year: d.first_publish_year ? String(d.first_publish_year) : '',
        description: '',
        cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
        pageCount: d.number_of_pages_median || null,
        link: 'https://openlibrary.org' + d.key,
      }));
      if (rows.length) return rows;
    }
  } catch (e) {}
  // Fallback: Google Books.
  const r = await fetch('https://www.googleapis.com/books/v1/volumes?maxResults=20&q=' +
    encodeURIComponent(q));
  if (!r.ok) throw new Error('Book search unavailable (try again in a moment).');
  const data = await r.json();
  return (data.items || []).map(v => {
    const vi = v.volumeInfo || {};
    return {
      type,
      source: { provider: 'googlebooks', id: v.id },
      title: vi.title || 'Untitled',
      creator: (vi.authors || []).join(', '),
      year: (vi.publishedDate || '').slice(0, 4),
      description: vi.description || '',
      cover: ((vi.imageLinks && (vi.imageLinks.thumbnail || vi.imageLinks.smallThumbnail)) || '')
        .replace('http://', 'https://'),
      pageCount: vi.pageCount || null,
      link: vi.infoLink || '',
    };
  });
}

/* fetch a book description lazily when the user adds it */
async function enrichBook(item) {
  if (item.source.provider !== 'openlibrary' || item.description) return item;
  try {
    const r = await fetch('https://openlibrary.org' + item.source.id + '.json');
    if (!r.ok) return item;
    const d = await r.json();
    const desc = typeof d.description === 'string' ? d.description : d.description?.value;
    if (desc) item.description = desc.split('\n')[0];
  } catch (e) {}
  return item;
}

async function searchScreen(q, type) {
  const key = state.settings.tmdbKey.trim();
  if (!key) throw new Error('Add your TMDB API key in Settings first.');
  const url = `https://api.themoviedb.org/3/search/${type}?include_adult=false` +
    `&api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  if (r.status === 401) throw new Error('TMDB rejected the API key (401). Check Settings.');
  if (!r.ok) throw new Error('TMDB error ' + r.status);
  const data = await r.json();
  return (data.results || []).map(m => ({
    type,
    source: { provider: 'tmdb', id: String(m.id) },
    title: m.title || m.name || 'Untitled',
    creator: '',
    year: (m.release_date || m.first_air_date || '').slice(0, 4),
    description: m.overview || '',
    cover: m.poster_path ? 'https://image.tmdb.org/t/p/w200' + m.poster_path : '',
    link: `https://www.themoviedb.org/${type}/${m.id}`,
  }));
}

/* enrich screen items with director / creator on add (best effort) */
async function enrichScreen(item) {
  const key = state.settings.tmdbKey.trim();
  if (!key || item.source.provider !== 'tmdb') return item;
  try {
    const base = `https://api.themoviedb.org/3/${item.type}/${item.source.id}`;
    const r = await fetch(`${base}?api_key=${encodeURIComponent(key)}&append_to_response=credits`);
    if (!r.ok) return item;
    const d = await r.json();
    if (item.type === 'movie') {
      const dir = (d.credits?.crew || []).find(c => c.job === 'Director');
      if (dir) item.creator = dir.name;
      if (d.runtime) item.runtime = d.runtime;
    } else {
      item.creator = (d.created_by || []).map(c => c.name).join(', ');
      if (d.number_of_seasons) item.seasons = d.number_of_seasons;
    }
  } catch (e) {}
  return item;
}

/* ---------- mutations ---------- */
function addItem(found, recommendedBy) {
  const dup = state.items.find(i =>
    i.source.provider === found.source.provider && i.source.id === found.source.id);
  if (dup) return { dup };
  const item = {
    id: uid(),
    ...found,
    status: 'want',
    rating: 0,
    recommendedBy: recommendedBy || '',
    notes: '',
    addedAt: now(),
    updatedAt: now(),
  };
  state.items.unshift(item);
  save();
  return { item };
}
function patch(id, fields) {
  const it = state.items.find(i => i.id === id);
  if (!it) return;
  Object.assign(it, fields, { updatedAt: now() });
  save();
}
function remove(id) {
  state.items = state.items.filter(i => i.id !== id);
  save();
}

/* ---------- rendering helpers ---------- */
function starsHtml(rating, id) {
  let h = '<span class="stars" data-rate="' + id + '">';
  for (let i = 1; i <= 5; i++) h += `<span class="${i <= rating ? 'on' : ''}" data-v="${i}">★</span>`;
  return h + '</span>';
}
function coverHtml(it) {
  return it.cover
    ? `<img class="cover" loading="lazy" src="${esc(it.cover)}" alt="">`
    : `<div class="cover">${TYPES[it.type].icon}</div>`;
}
function statusLabel(it) {
  const t = TYPES[it.type];
  return it.status === 'done' ? t.done : it.status === 'active' ? t.active : t.want;
}
function cardHtml(it) {
  const sub = [it.creator, it.year].filter(Boolean).join(' · ');
  return `<article class="card" data-open="${it.id}">
    ${coverHtml(it)}
    <div class="body">
      <div class="title">${esc(it.title)}</div>
      <div class="sub">${esc(sub)}</div>
      <div class="desc">${esc(it.description || 'No description.')}</div>
      <div class="row">
        <span class="pill type">${TYPES[it.type].icon} ${TYPES[it.type].label}</span>
        <span class="pill">${esc(statusLabel(it))}</span>
        ${it.recommendedBy ? `<span class="pill rec">via ${esc(it.recommendedBy)}</span>` : ''}
        ${it.rating ? starsHtml(it.rating, it.id) : ''}
      </div>
    </div>
  </article>`;
}

/* ---------- views ---------- */
const app = document.getElementById('app');
const titleEl = document.getElementById('viewTitle');
let view = 'queue';
let libFilter = 'all';

function render() {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === view));
  ({ queue: renderQueue, library: renderLibrary, add: renderAdd, settings: renderSettings }[view])();
}

function renderQueue() {
  titleEl.textContent = 'Queue';
  const pending = state.items.filter(i => i.status !== 'done');
  if (!pending.length) {
    app.innerHTML = `<div class="empty">Nothing queued yet.<br>Tap <b>Add</b> to find something you were recommended.</div>`;
    return;
  }
  let html = '';
  for (const key of Object.keys(TYPES)) {
    const group = pending.filter(i => i.type === key);
    if (!group.length) continue;
    group.sort((a, b) => (a.status === 'active' ? -1 : 0) - (b.status === 'active' ? -1 : 0));
    html += `<div class="section-h"><h2>${TYPES[key].label}</h2><span class="count">${group.length}</span></div>`;
    html += group.map(cardHtml).join('');
  }
  app.innerHTML = html;
}

function renderLibrary() {
  titleEl.textContent = 'Library';
  const chips = [['all', 'All'], ['book', 'Books'], ['audiobook', 'Audiobooks'],
    ['movie', 'Movies'], ['tv', 'TV'], ['rated', 'Rated'], ['done', 'Finished']];
  let items = state.items.slice();
  if (libFilter === 'rated') items = items.filter(i => i.rating > 0);
  else if (libFilter === 'done') items = items.filter(i => i.status === 'done');
  else if (libFilter !== 'all') items = items.filter(i => i.type === libFilter);
  items.sort((a, b) => (b.rating - a.rating) || (b.updatedAt < a.updatedAt ? -1 : 1));

  app.innerHTML =
    `<div class="filters">${chips.map(([k, l]) =>
      `<button class="chip ${libFilter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>` +
    (items.length ? items.map(cardHtml).join('')
      : `<div class="empty">Nothing here yet.</div>`);
}

let addType = 'book';
let addResults = [];
function renderAdd() {
  titleEl.textContent = 'Add';
  app.innerHTML = `
    <div class="seg" id="addSeg">
      ${['book', 'audiobook', 'movie', 'tv'].map(t =>
        `<button data-t="${t}" class="${addType === t ? 'on' : ''}">${TYPES[t].icon} ${TYPES[t].label}</button>`).join('')}
    </div>
    <div class="field">
      <input id="q" placeholder="Search title…" autocomplete="off" enterkeyhint="search">
    </div>
    <button class="btn" id="goSearch">Search</button>
    <div id="results" style="margin-top:16px"></div>`;
  app.querySelector('#results').innerHTML = addResults.map(resultHtml).join('');
}
function resultHtml(r, i) {
  const sub = [r.creator, r.year].filter(Boolean).join(' · ');
  return `<article class="card">
    ${coverHtml(r)}
    <div class="body">
      <div class="title">${esc(r.title)}</div>
      <div class="sub">${esc(sub)}</div>
      <div class="desc">${esc(r.description || 'No description.')}</div>
      <div class="row"><button class="btn sm" data-add="${i}">Add to queue</button></div>
    </div>
  </article>`;
}

function renderSettings() {
  titleEl.textContent = 'Settings';
  const counts = state.items.length;
  app.innerHTML = `
    <div class="field">
      <label>TMDB API key <span class="muted">(for movies & TV)</span></label>
      <input id="tmdbKey" value="${esc(state.settings.tmdbKey)}" placeholder="v3 API key" autocomplete="off">
      <p class="muted">Get a free key at themoviedb.org → Settings → API. Stored only on this device.</p>
    </div>
    <button class="btn" id="saveKey">Save key</button>

    <div class="section-h"><h2>Backup</h2></div>
    <p class="muted">${counts} item${counts === 1 ? '' : 's'} stored in this browser. Export before switching phones.</p>
    <div class="row">
      <button class="btn secondary sm" id="exportBtn">Export JSON</button>
      <button class="btn secondary sm" id="importBtn">Import JSON</button>
    </div>
    <input type="file" id="importFile" accept="application/json" hidden>

    <div class="section-h"><h2>About</h2></div>
    <p class="muted">RecRoster — a static PWA. Book data from Google Books, screen data from TMDB.
    This product uses the TMDB API but is not endorsed or certified by TMDB.</p>`;
}

/* ---------- detail sheet ---------- */
const modal = document.getElementById('modal');
const modalSheet = document.getElementById('modalSheet');
function openSheet(html) { modalSheet.innerHTML = html; modal.hidden = false; }
function closeSheet() { modal.hidden = true; modalSheet.innerHTML = ''; }
modal.addEventListener('click', e => { if (e.target === modal) closeSheet(); });

function openDetail(id) {
  const it = state.items.find(i => i.id === id);
  if (!it) return;
  const t = TYPES[it.type];
  const segBtn = (s, label) =>
    `<button data-status="${s}" class="${it.status === s ? 'on' : ''}">${label}</button>`;
  openSheet(`
    <h2>${esc(it.title)}</h2>
    <p class="muted">${esc([it.creator, it.year].filter(Boolean).join(' · '))}
      ${it.pageCount ? ' · ' + it.pageCount + ' pp' : ''}
      ${it.runtime ? ' · ' + it.runtime + ' min' : ''}
      ${it.seasons ? ' · ' + it.seasons + ' seasons' : ''}</p>
    <p style="margin:10px 0 16px">${esc(it.description || 'No description.')}</p>

    <div class="field"><label>Status</label>
      <div class="seg" id="dStatus">
        ${segBtn('want', t.want)}${segBtn('active', t.active)}${segBtn('done', t.done)}
      </div>
    </div>
    <div class="field"><label>Your rating</label>${starsHtml(it.rating, it.id)}</div>
    <div class="field"><label>Recommended by</label>
      <input id="dRec" value="${esc(it.recommendedBy)}" placeholder="Who suggested this?"></div>
    <div class="field"><label>Notes</label>
      <textarea id="dNotes" rows="3" placeholder="Thoughts, quotes, where you heard about it…">${esc(it.notes)}</textarea></div>

    <button class="btn" id="dSave">Save</button>
    <div class="row" style="margin-top:10px">
      ${it.link ? `<a class="btn secondary sm" href="${esc(it.link)}" target="_blank" rel="noopener">Open source page</a>` : ''}
      <button class="btn danger sm" id="dDelete">Delete</button>
    </div>`);

  modalSheet.querySelector('#dStatus').addEventListener('click', e => {
    const b = e.target.closest('[data-status]'); if (!b) return;
    patch(id, { status: b.dataset.status });
    openDetail(id); refreshBg();
  });
  wireStars(modalSheet, id, () => { openDetail(id); refreshBg(); });
  modalSheet.querySelector('#dSave').onclick = () => {
    patch(id, {
      recommendedBy: modalSheet.querySelector('#dRec').value.trim(),
      notes: modalSheet.querySelector('#dNotes').value,
    });
    closeSheet(); render();
  };
  modalSheet.querySelector('#dDelete').onclick = () => {
    if (confirm('Delete this item?')) { remove(id); closeSheet(); render(); }
  };
}
function refreshBg() { if (view === 'queue' || view === 'library') render(); }

function wireStars(root, id, after) {
  const s = root.querySelector(`.stars[data-rate="${id}"]`);
  if (!s) return;
  s.addEventListener('click', e => {
    const star = e.target.closest('[data-v]'); if (!star) return;
    const v = +star.dataset.v;
    const it = state.items.find(i => i.id === id);
    patch(id, { rating: it && it.rating === v ? 0 : v });
    if (after) after();
  });
}

/* ---------- add flow ---------- */
async function runSearch() {
  const q = app.querySelector('#q').value.trim();
  if (!q) return;
  const box = app.querySelector('#results');
  box.innerHTML = '<div class="spinner">Searching…</div>';
  try {
    addResults = (addType === 'book' || addType === 'audiobook')
      ? await searchBooks(q, addType === 'audiobook')
      : await searchScreen(q, addType);
    box.innerHTML = addResults.length
      ? addResults.map(resultHtml).join('')
      : '<div class="empty">No matches.</div>';
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

function promptAdd(idx) {
  const found = addResults[idx];
  if (!found) return;
  openSheet(`
    <h2>Add “${esc(found.title)}”</h2>
    <div class="field"><label>Recommended by <span class="muted">(optional)</span></label>
      <input id="recBy" placeholder="Friend, podcast, article…"></div>
    <button class="btn" id="confirmAdd">Add to queue</button>`);
  modalSheet.querySelector('#recBy').focus();
  modalSheet.querySelector('#confirmAdd').onclick = async () => {
    const btn = modalSheet.querySelector('#confirmAdd');
    btn.textContent = 'Adding…'; btn.disabled = true;
    await enrichScreen(found);
    await enrichBook(found);
    const res = addItem(found, modalSheet.querySelector('#recBy').value.trim());
    closeSheet();
    if (res.dup) alert('Already in your list.');
    view = 'queue'; render();
  };
}

/* ---------- backup ---------- */
function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `recroster-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = JSON.parse(reader.result);
      if (!incoming || !Array.isArray(incoming.items)) throw new Error('bad file');
      const mode = confirm('OK = merge with current data. Cancel = replace everything.');
      if (mode) {
        const byKey = new Map(state.items.map(i => [i.source.provider + i.source.id, i]));
        for (const it of incoming.items) byKey.set(it.source.provider + it.source.id, it);
        state.items = [...byKey.values()];
      } else {
        state = incoming;
      }
      if (!state.settings) state.settings = { tmdbKey: '' };
      save(); render();
      alert('Imported.');
    } catch (e) { alert('Could not import that file.'); }
  };
  reader.readAsText(file);
}

/* ---------- events ---------- */
document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('.tab'); if (!b) return;
  view = b.dataset.view; addResults = []; render();
});
document.getElementById('btnAdd').onclick = () => { view = 'add'; render(); };

app.addEventListener('click', e => {
  const open = e.target.closest('[data-open]');
  if (open && !e.target.closest('.stars')) { openDetail(open.dataset.open); return; }

  const filter = e.target.closest('[data-filter]');
  if (filter) { libFilter = filter.dataset.filter; render(); return; }

  const seg = e.target.closest('#addSeg [data-t]');
  if (seg) { addType = seg.dataset.t; addResults = []; render(); return; }

  if (e.target.id === 'goSearch') { runSearch(); return; }

  const add = e.target.closest('[data-add]');
  if (add) { promptAdd(+add.dataset.add); return; }

  if (e.target.id === 'saveKey') {
    state.settings.tmdbKey = app.querySelector('#tmdbKey').value.trim();
    save(); alert('Saved.'); return;
  }
  if (e.target.id === 'exportBtn') { exportJson(); return; }
  if (e.target.id === 'importBtn') { app.querySelector('#importFile').click(); return; }
});
app.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'q') { e.preventDefault(); runSearch(); }
});
app.addEventListener('change', e => {
  if (e.target.id === 'importFile' && e.target.files[0]) importJson(e.target.files[0]);
});
app.addEventListener('click', e => {
  const s = e.target.closest('.stars');
  if (s && view === 'library') {
    const star = e.target.closest('[data-v]'); if (!star) return;
    const id = s.dataset.rate, v = +star.dataset.v;
    const it = state.items.find(i => i.id === id);
    patch(id, { rating: it && it.rating === v ? 0 : v });
    render();
  }
});

/* ---------- service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

render();
