import { createClient } from '@supabase/supabase-js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as esri from 'esri-leaflet'
import './style.css'

/* ---------- Config ---------- */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ucjicbvlctzrauahzvgf.supabase.co'
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_pYaBkCJkb5RpPyFhPwkibw_8gZ7TukF'
const PARCELS_URL = 'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0'
const HOME = [27.3364, -82.5307] // Sarasota
const TYPES = ['Owner', 'Seller', 'Buyer', 'Leasing', 'Other']
const CADENCE = { A: { days: 14, label: 'Every 2 weeks' }, B: { months: 1, label: 'Monthly' }, C: { months: 3, label: 'Quarterly' } }

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

/* ---------- State ---------- */
const S = {
  session: null, allowed: true,
  contacts: [], convos: [], buyers: [], pins: [],
  tab: localStorage.getItem('tab') || 'today',
  q: '', pri: new Set(), type: '',
  calMonth: firstOfMonth(new Date()),
  live: false, loaded: false,
}

/* ---------- Helpers ---------- */
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag)
  if (attrs) for (const k in attrs) {
    const v = attrs[k]
    if (v == null || v === false) continue
    if (k === 'class') n.className = v
    else if (k === 'text') n.textContent = v
    else if (k === 'html') n.innerHTML = v
    else if (k === 'value') n.value = v
    else if (k === 'checked') n.checked = !!v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else n.setAttribute(k, v === true ? '' : v)
  }
  for (const k of kids.flat()) { if (k == null || k === false) continue; n.append(k.nodeType ? k : document.createTextNode(k)) }
  return n
}
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = s => { if (!s) return null; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return y ? new Date(y, m - 1, d) : null }
function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
const fmt = (s, o = { month: 'short', day: 'numeric' }) => { const d = parse(s); return d ? d.toLocaleDateString(undefined, o) : '—' }
const LONG = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
const daysBetween = (a, b) => Math.round((b - a) / 864e5)
function addCadence(from, p) {
  const d = new Date(from), c = CADENCE[p] || CADENCE.C
  if (c.days) d.setDate(d.getDate() + c.days)
  else { const day = d.getDate(); d.setMonth(d.getMonth() + c.months); if (d.getDate() !== day) d.setDate(0) }
  return d
}
const telHref = p => { const d = String(p || '').replace(/\D/g, ''); return d ? 'tel:+' + (d.length === 10 ? '1' + d : d) : null }
const mapsHref = q => q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : null
const addrOf = c => c.address_query || [c.address, c.city, 'FL'].filter(Boolean).join(', ')
const slug = s => String(s).toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'contact'
const money = n => n == null || n === '' ? '—' : '$' + Math.round(Number(n)).toLocaleString()
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))

function toast(msg) {
  const t = el('div', { class: 'toast', text: msg }); document.body.append(t)
  setTimeout(() => t.remove(), 2600)
}
const convosFor = id => S.convos.filter(v => v.contact_id === id).sort((a, b) => String(b.talked_on).localeCompare(String(a.talked_on)) || b.id - a.id)
const contactById = id => S.contacts.find(c => c.id === id)

/* ---------- Data ---------- */
async function loadTable(t) {
  const order = { contacts: 'name', conversations: 'talked_on', buyers: 'name', pins: 'created_at' }[t]
  const { data, error } = await sb.from(t).select('*').order(order)
  if (error) throw error
  const key = { contacts: 'contacts', conversations: 'convos', buyers: 'buyers', pins: 'pins' }[t]
  S[key] = data || []
}
async function loadAll() {
  await Promise.all(['contacts', 'conversations', 'buyers', 'pins'].map(loadTable))
  S.loaded = true
}
let reloadTimers = {}
function subscribe() {
  sb.channel('crm-live')
    .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
      const t = payload.table
      clearTimeout(reloadTimers[t])
      reloadTimers[t] = setTimeout(async () => { try { await loadTable(t); render({ soft: true }) } catch (e) { console.warn(e) } }, 300)
    })
    .subscribe(status => { S.live = status === 'SUBSCRIBED'; paintLive() })
}
function paintLive() {
  const n = document.querySelector('.live'); if (!n) return
  n.className = 'live' + (S.live ? ' on' : '')
  n.title = S.live ? 'Live — changes show up automatically' : 'Connecting…'
}

/* ---------- Auth ---------- */
async function boot() {
  const { data } = await sb.auth.getSession()
  S.session = data.session
  sb.auth.onAuthStateChange((_e, session) => {
    const was = !!S.session; S.session = session
    if (!!session !== was) start()
  })
  start()
}
async function start() {
  const app = document.getElementById('app')
  if (!S.session) { app.replaceChildren(loginView()); return }
  app.replaceChildren(el('div', { class: 'login' }, el('div', { class: 'card' }, el('p', { class: 'muted', text: 'Loading your CRM…' }))))
  try {
    const { data: me } = await sb.from('app_users').select('email').limit(1)
    if (!me || !me.length) { S.allowed = false; app.replaceChildren(deniedView()); return }
    await loadAll()
    subscribe()
    render()
    geocodeMissing()
  } catch (e) {
    app.replaceChildren(el('div', { class: 'login' }, el('div', { class: 'card stack' },
      el('h1', { text: 'Couldn’t load the CRM' }), el('p', { class: 'err', text: e.message || String(e) }),
      el('button', { class: 'btn', onclick: () => start() }, 'Try again'))))
  }
}
function loginView() {
  let mode = 'in'
  const email = el('input', { type: 'email', autocomplete: 'email', required: true, value: 'rogersreconsultingllc@gmail.com' })
  const pw = el('input', { type: 'password', autocomplete: 'current-password', required: true, minlength: 8 })
  const err = el('div', { class: 'err' }), note = el('div', { class: 'ok' })
  const title = el('h1', { text: 'Cole CRM' })
  const sub = el('p', { class: 'muted', text: 'Sign in to your contacts, calendar and map.' })
  const go = el('button', { class: 'btn primary', type: 'submit' }, 'Sign in')
  const toggle = el('button', { class: 'btn ghost small', type: 'button' }, 'First time here? Create your password')
  const forgot = el('button', { class: 'btn ghost small', type: 'button' }, 'Forgot password')
  toggle.onclick = () => {
    mode = mode === 'in' ? 'up' : 'in'
    go.textContent = mode === 'in' ? 'Sign in' : 'Create account'
    toggle.textContent = mode === 'in' ? 'First time here? Create your password' : 'Have a password? Sign in'
    pw.autocomplete = mode === 'in' ? 'current-password' : 'new-password'
    err.textContent = ''; note.textContent = ''
  }
  forgot.onclick = async () => {
    err.textContent = ''; note.textContent = ''
    const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin })
    if (error) err.textContent = error.message; else note.textContent = 'Check your email for a reset link.'
  }
  const form = el('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault(); err.textContent = ''; note.textContent = ''; go.disabled = true
    try {
      if (mode === 'in') {
        const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value })
        if (error) throw error
      } else {
        const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: pw.value, options: { emailRedirectTo: location.origin } })
        if (error) throw error
        if (!data.session) note.textContent = 'Account created. Click the confirmation link in your email, then come back and sign in.'
      }
    } catch (x) { err.textContent = x.message || String(x) } finally { go.disabled = false }
  } },
    el('label', { class: 'f' }, 'Email', email),
    el('label', { class: 'f' }, 'Password', pw),
    err, note, go, el('div', { class: 'actions' }, toggle, forgot))
  return el('div', { class: 'login' }, el('div', { class: 'card stack' }, el('div', null, title, sub), form))
}
function deniedView() {
  return el('div', { class: 'login' }, el('div', { class: 'card stack' },
    el('h1', { text: 'No access' }),
    el('p', { class: 'muted', text: `${S.session?.user?.email} isn’t on the CRM’s allowed list.` }),
    el('button', { class: 'btn', onclick: () => sb.auth.signOut() }, 'Sign out')))
}

/* ---------- Shell ---------- */
const TABS = [['today', 'Today'], ['contacts', 'Contacts'], ['calendar', 'Calendar'], ['map', 'Map'], ['buyers', 'Buyers']]
function dueCount() { const T = ymd(today()); return S.contacts.filter(c => c.next_follow_up && c.next_follow_up <= T).length }

function render({ soft } = {}) {
  const app = document.getElementById('app')
  const due = dueCount()
  const top = el('header', { class: 'top' },
    el('div', { class: 'logo' }, el('i'), 'Cole CRM'),
    el('nav', { class: 'tabs' }, TABS.map(([k, label]) => el('button', { class: S.tab === k ? 'on' : '', onclick: () => go(k) }, label,
      k === 'today' && due ? el('span', { class: 'count', text: due }) : null))),
    el('div', { class: 'right' },
      el('div', { class: 'live' }, el('i'), el('span', { text: 'Live' })),
      el('button', { class: 'btn small primary', onclick: () => openContactForm() }, '+ Contact'),
      el('button', { class: 'btn small ghost', style: 'color:#b9c4cf;border-color:#3a4a5a', onclick: () => sb.auth.signOut() }, 'Sign out')))
  const main = el('main', { class: S.tab === 'map' ? 'full' : '' })
  const view = { today: todayView, contacts: contactsView, calendar: calendarView, map: mapView, buyers: buyersView }[S.tab] || todayView
  // Keep typing focus in the search box across live refreshes
  const focused = soft && document.activeElement && document.activeElement.dataset.keep
  const caret = focused ? document.activeElement.selectionStart : null
  main.append(view())
  app.replaceChildren(top, main)
  paintLive()
  if (focused) { const n = document.querySelector(`[data-keep="${focused}"]`); if (n) { n.focus(); try { n.setSelectionRange(caret, caret) } catch { } } }
  if (S.tab === 'map') requestAnimationFrame(() => { MAP.map?.invalidateSize(); refreshMap() })
  if (openDrawerId && soft) refreshDrawer()
}
function go(tab) { S.tab = tab; localStorage.setItem('tab', tab); render() }

/* ---------- Today ---------- */
function contactRow(c, { showDate = true } = {}) {
  const T = today(), d = parse(c.next_follow_up)
  const late = d && d < T ? daysBetween(d, T) : 0
  const tel = telHref(c.phone)
  return el('li', { class: 'item', onclick: () => openContact(c.id) },
    el('span', { class: 'pri ' + (c.priority || 'C'), text: c.priority || 'C' }),
    el('div', { class: 'who' },
      el('div', { class: 'name' }, c.name, c.contact_type && c.contact_type !== 'Owner' ? el('span', { class: 'tag ' + c.contact_type, text: c.contact_type }) : null,
        late ? el('span', { class: 'late', text: late + 'd overdue' }) : null),
      el('div', { class: 'sub', text: [c.next_note, c.address].filter(Boolean).join(' · ') || '—' })),
    showDate ? el('div', { class: 'when', text: fmt(c.next_follow_up, { weekday: 'short', month: 'short', day: 'numeric' }) }) : null,
    tel ? el('a', { class: 'tel', href: tel, onclick: e => e.stopPropagation(), text: c.phone }) : null)
}
function todayView() {
  const T = today(), Ts = ymd(T), wk = new Date(T); wk.setDate(wk.getDate() + 7); const Ws = ymd(wk)
  const withDate = S.contacts.filter(c => c.next_follow_up).sort((a, b) => a.next_follow_up.localeCompare(b.next_follow_up) || (a.priority || 'C').localeCompare(b.priority || 'C'))
  const overdue = withDate.filter(c => c.next_follow_up < Ts)
  const due = withDate.filter(c => c.next_follow_up === Ts)
  const week = withDate.filter(c => c.next_follow_up > Ts && c.next_follow_up <= Ws)
  const recent = [...S.convos].sort((a, b) => String(b.talked_on).localeCompare(String(a.talked_on)) || b.id - a.id).slice(0, 6)
  const block = (title, arr, empty) => [el('div', { class: 'section-title', text: `${title} (${arr.length})` }),
    el('div', { class: 'card' }, arr.length ? el('ul', { class: 'list' }, arr.map(c => contactRow(c))) : el('div', { class: 'empty', text: empty }))]
  return el('div', null,
    el('div', { class: 'head' }, el('div', null,
      el('h1', { text: T.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }),
      el('p', { class: 'muted', text: overdue.length + due.length ? `${overdue.length + due.length} call${overdue.length + due.length === 1 ? '' : 's'} to make today` : 'No calls due today' }))),
    el('div', { class: 'stats' },
      stat(due.length, 'Due today'), stat(overdue.length, 'Overdue'), stat(week.length, 'Next 7 days'), stat(S.contacts.length, 'Contacts')),
    overdue.length ? block('Overdue', overdue, '') : null,
    block('Today', due, 'Nothing scheduled for today.'),
    block('Next 7 days', week, 'Nothing in the next week.'),
    el('div', { class: 'section-title', text: 'Recent conversations' }),
    el('div', { class: 'card' }, recent.length ? el('ul', { class: 'list' }, recent.map(v => {
      const c = contactById(v.contact_id)
      return el('li', { class: 'item', onclick: () => c && openContact(c.id) },
        el('div', { class: 'who' }, el('div', { class: 'name', text: c ? c.name : v.contact_id }), el('div', { class: 'sub', text: v.notes })),
        el('div', { class: 'when', text: fmt(v.talked_on) }))
    })) : el('div', { class: 'empty', text: 'No conversations yet.' })))
}
const stat = (n, label) => el('div', { class: 'card stat' }, el('b', { text: n }), el('span', { text: label }))

/* ---------- Contacts ---------- */
function matches(c, q) {
  if (!q) return true
  const hay = [c.name, c.company, c.phone, c.email, c.address, c.address_query, c.city, c.county, c.notes, c.next_note, c.contact_type,
    ...convosFor(c.id).map(v => v.notes)].join(' ').toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))
}
function filtered() {
  return S.contacts.filter(c => matches(c, S.q) && (!S.pri.size || S.pri.has(c.priority || 'C')) && (!S.type || c.contact_type === S.type))
}
function filterBar() {
  const search = el('input', { class: 'search', type: 'search', placeholder: 'Search name, address, notes, phone…', value: S.q, 'data-keep': 'q',
    oninput: e => { S.q = e.target.value; render({ soft: true }) } })
  return el('div', { class: 'filters' }, search,
    ['A', 'B', 'C'].map(p => el('button', { class: 'chip' + (S.pri.has(p) ? ' on' : ''), onclick: () => { S.pri.has(p) ? S.pri.delete(p) : S.pri.add(p); render() } }, p)),
    el('select', { class: 'chip', onchange: e => { S.type = e.target.value; render() } },
      el('option', { value: '', text: 'All types' }), TYPES.map(t => el('option', { value: t, text: t, selected: S.type === t }))))
}
function contactsView() {
  const list = filtered().sort((a, b) => (a.next_follow_up || '9999').localeCompare(b.next_follow_up || '9999') || a.name.localeCompare(b.name))
  return el('div', null,
    el('div', { class: 'head' }, el('div', null, el('h1', { text: 'Contacts' }), el('p', { class: 'muted', text: `${list.length} of ${S.contacts.length}` })),
      el('button', { class: 'btn primary', onclick: () => openContactForm() }, '+ New contact')),
    filterBar(),
    el('div', { class: 'card' }, list.length ? el('ul', { class: 'list' }, list.map(c => contactRow(c))) : el('div', { class: 'empty', text: 'No matches.' })))
}

/* ---------- Calendar ---------- */
function calendarView() {
  const m = S.calMonth, T = ymd(today())
  const start = new Date(m); start.setDate(1 - m.getDay())
  const byDay = {}
  for (const c of S.contacts) if (c.next_follow_up) (byDay[c.next_follow_up] ||= []).push(c)
  const grid = el('div', { class: 'grid' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => el('div', { class: 'dow', text: d })))
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = ymd(d)
    const evs = (byDay[k] || []).sort((a, b) => (a.priority || 'C').localeCompare(b.priority || 'C'))
    grid.append(el('div', { class: 'cell' + (d.getMonth() !== m.getMonth() ? ' out' : '') + (k === T ? ' today' : '') },
      el('div', { class: 'd', text: d.getDate() }),
      evs.map(c => el('div', { class: 'ev', title: `${c.name} — ${c.next_note || ''}`, onclick: () => openContact(c.id) },
        el('span', { class: 'dot', style: `background:var(--${(c.priority || 'c').toLowerCase()})` }), el('span', { class: 'nm', text: c.name })))))
  }
  const shift = n => { S.calMonth = new Date(m.getFullYear(), m.getMonth() + n, 1); render() }
  return el('div', null,
    el('div', { class: 'head' }, el('div', { class: 'cal-head' },
      el('button', { class: 'btn small', onclick: () => shift(-1) }, '‹'),
      el('h2', { text: m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }),
      el('button', { class: 'btn small', onclick: () => shift(1) }, '›'),
      el('button', { class: 'btn small ghost', onclick: () => { S.calMonth = firstOfMonth(new Date()); render() } }, 'Today')),
      el('div', { class: 'muted', style: 'font-size:13px' }, 'Follow-ups by next call date')),
    grid)
}

/* ---------- Map ---------- */
const MAP = { map: null, node: null, contactsLayer: null, pinsLayer: null, parcels: null, placing: null, showParcels: true, showPins: true, q: '' }
function mapView() {
  if (!MAP.node) {
    MAP.node = el('div', { id: 'map' })
    MAP.map = L.map(MAP.node, { zoomControl: true, preferCanvas: false }).setView(HOME, 12)
    esri.tiledMapLayer({ url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer', maxZoom: 21, maxNativeZoom: 19 }).addTo(MAP.map)
    esri.tiledMapLayer({ url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer', maxZoom: 21, maxNativeZoom: 19, opacity: .7 }).addTo(MAP.map)
    esri.tiledMapLayer({ url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer', maxZoom: 21, maxNativeZoom: 19 }).addTo(MAP.map)
    MAP.parcels = esri.featureLayer({
      url: PARCELS_URL, minZoom: 16, fields: ['OBJECTID', 'PARCEL_ID', 'PHY_ADDR1'], simplifyFactor: 0.35, precision: 6,
      style: () => ({ color: '#ffd84d', weight: 1.2, fill: true, fillOpacity: 0, opacity: .9 }),
    })
    MAP.parcels.on('click', e => { if (MAP.placing) return; showParcel(e.layer.feature.properties.OBJECTID, e.latlng) })
    MAP.parcels.addTo(MAP.map)
    MAP.pinsLayer = L.layerGroup().addTo(MAP.map)
    MAP.contactsLayer = L.layerGroup().addTo(MAP.map)
    MAP.map.on('click', e => { if (MAP.placing) finishPlacing(e.latlng) })
    MAP.map.on('zoomend', () => paintMapHint())
  }
  const wrap = el('div', { class: 'mapwrap' }, MAP.node)
  const search = el('input', { class: 'search', type: 'search', placeholder: 'Filter pins… (name, address, notes)', value: MAP.q, 'data-keep': 'mapq',
    oninput: e => { MAP.q = e.target.value; refreshMap() } })
  wrap.append(el('div', { class: 'mapbar' }, search,
    el('button', { class: 'chip' + (MAP.showParcels ? ' on' : ''), onclick: e => { MAP.showParcels = !MAP.showParcels; MAP.showParcels ? MAP.parcels.addTo(MAP.map) : MAP.parcels.remove(); e.target.classList.toggle('on') } }, 'Parcel lines'),
    el('button', { class: 'chip' + (MAP.showPins ? ' on' : ''), onclick: e => { MAP.showPins = !MAP.showPins; MAP.showPins ? MAP.pinsLayer.addTo(MAP.map) : MAP.pinsLayer.remove(); e.target.classList.toggle('on') } }, 'Saved pins'),
    el('button', { class: 'chip', onclick: () => fitAll() }, 'Fit all'),
    el('span', { class: 'chip hint', style: 'cursor:default' })))
  wrap.append(el('div', { class: 'card legend' },
    el('div', null, el('span', { class: 'sw', style: 'background:var(--a)' }), 'A — every 2 weeks'),
    el('div', null, el('span', { class: 'sw', style: 'background:var(--b)' }), 'B — monthly'),
    el('div', null, el('span', { class: 'sw', style: 'background:var(--c)' }), 'C — quarterly'),
    el('div', null, el('span', { class: 'sw', style: 'background:#7a7f87;border-radius:3px' }), 'Saved pin (not a contact)')))
  const unplaced = S.contacts.filter(c => c.lat == null && (c.address || c.address_query))
  if (unplaced.length) wrap.append(el('div', { class: 'card unplaced' },
    el('h4', { text: `Not on the map yet (${unplaced.length})` }),
    el('div', { class: 'muted', style: 'font-size:12px', text: geoBusy ? 'Looking up addresses…' : 'Click one, then click its building on the map.' }),
    unplaced.map(c => el('button', { class: 'btn small', onclick: () => startPlacing(c) }, `${c.name} — ${c.address || c.address_query}`))))
  if (MAP.placing) wrap.append(el('div', { class: 'placing' }, `Click the map to place ${MAP.placing.name}`,
    el('button', { class: 'btn small', onclick: () => { MAP.placing = null; render() } }, 'Cancel')))
  return wrap
}
function paintMapHint() {
  const h = document.querySelector('.mapbar .hint'); if (!h || !MAP.map) return
  const z = MAP.map.getZoom()
  h.textContent = MAP.showParcels && z < 16 ? 'Zoom in to see parcel lines' : 'Click a parcel for owner info'
}
function pinIcon(cls) { return L.divIcon({ className: cls, iconSize: [18, 18] }) }
function refreshMap() {
  if (!MAP.map) return
  MAP.contactsLayer.clearLayers(); MAP.pinsLayer.clearLayers()
  const q = MAP.q
  for (const c of S.contacts) {
    if (c.lat == null || c.lng == null || !matches(c, q)) continue
    const m = L.marker([c.lat, c.lng], { icon: pinIcon('pin-' + (c.priority || 'c').toLowerCase()), title: c.name, riseOnHover: true })
    m.bindTooltip(c.name, { direction: 'top', offset: [0, -8] })
    m.bindPopup(() => contactPopup(c), { maxWidth: 300 })
    m.addTo(MAP.contactsLayer)
  }
  for (const p of S.pins) {
    if (q && ![p.name, p.address, p.owner_name, p.notes].join(' ').toLowerCase().includes(q.toLowerCase())) continue
    const m = L.marker([p.lat, p.lng], { icon: pinIcon('pin-x'), title: p.name })
    m.bindTooltip(p.name, { direction: 'top', offset: [0, -8] })
    m.bindPopup(() => pinPopup(p), { maxWidth: 300 })
    m.addTo(MAP.pinsLayer)
  }
  paintMapHint()
}
function fitAll() {
  const pts = [...S.contacts.filter(c => c.lat != null), ...S.pins].map(x => [x.lat, x.lng])
  if (pts.length) MAP.map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 })
}
function contactPopup(c) {
  const tel = telHref(c.phone), last = convosFor(c.id)[0]
  const n = el('div', { class: 'pop' },
    el('h3', null, el('span', { class: 'pri ' + (c.priority || 'C'), text: c.priority || 'C', style: 'margin-right:6px;width:18px;height:18px;font-size:11px' }), c.name),
    el('div', { class: 'muted', text: [c.contact_type, c.company].filter(Boolean).join(' · ') }),
    el('dl', null,
      el('dt', { text: 'Property' }), el('dd', null, el('a', { href: mapsHref(addrOf(c)), target: '_blank', rel: 'noopener', text: c.address || c.address_query })),
      el('dt', { text: 'Phone' }), el('dd', null, tel ? el('a', { href: tel, text: c.phone }) : '—'),
      el('dt', { text: 'Next call' }), el('dd', { text: fmt(c.next_follow_up, LONG) }),
      c.next_note ? [el('dt', { text: 'Next step' }), el('dd', { text: c.next_note })] : null,
      last ? [el('dt', { text: 'Last talk' }), el('dd', { text: `${fmt(last.talked_on)}: ${last.notes}` })] : null),
    el('div', { class: 'actions' },
      el('button', { class: 'btn small primary', onclick: () => openContact(c.id) }, 'Open / log call'),
      el('button', { class: 'btn small', onclick: () => { MAP.map.closePopup(); startPlacing(c) } }, 'Move pin')))
  return n
}
function pinPopup(p) {
  return el('div', { class: 'pop' },
    el('h3', { text: p.name }),
    el('dl', null,
      el('dt', { text: 'Address' }), el('dd', null, p.address ? el('a', { href: mapsHref(p.address), target: '_blank', rel: 'noopener', text: p.address }) : '—'),
      el('dt', { text: 'Owner' }), el('dd', { text: p.owner_name || '—' }),
      el('dt', { text: 'Parcel' }), el('dd', { text: p.parcel_id || '—' }),
      p.notes ? [el('dt', { text: 'Notes' }), el('dd', { text: p.notes })] : null),
    el('div', { class: 'actions' },
      el('button', { class: 'btn small primary', onclick: () => { MAP.map.closePopup(); openContactForm({ name: p.owner_name || '', address: p.address || '', lat: p.lat, lng: p.lng, parcel_id: p.parcel_id, pinId: p.id }) } }, 'Make contact'),
      el('button', { class: 'btn small', onclick: async () => { if (!confirm('Remove this pin?')) return; const { error } = await sb.from('pins').delete().eq('id', p.id); if (error) toast(error.message); else { MAP.map.closePopup(); await loadTable('pins'); refreshMap() } } }, 'Remove')))
}
async function queryParcel(where, extra = {}) {
  const params = new URLSearchParams({ where, outFields: '*', returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', f: 'json', ...extra })
  const r = await fetch(PARCELS_URL + '/query?' + params)
  const j = await r.json()
  if (j.error) throw new Error(j.error.message)
  return j.features || []
}
function parcelCenter(f) {
  const ring = f.geometry?.rings?.[0]; if (!ring) return null
  let x = 0, y = 0; for (const [a, b] of ring) { x += a; y += b }
  return { lat: y / ring.length, lng: x / ring.length }
}
async function showParcel(oid, latlng) {
  const pop = L.popup({ maxWidth: 320 }).setLatLng(latlng).setContent('<div class="pop">Loading parcel…</div>').openOn(MAP.map)
  try {
    const [f] = await queryParcel('OBJECTID=' + Number(oid))
    if (!f) { pop.setContent('Parcel not found.'); return }
    const a = f.attributes
    const addr = [a.PHY_ADDR1, a.PHY_CITY, 'FL', a.PHY_ZIPCD].filter(Boolean).join(', ')
    const owner = [a.OWN_NAME, [a.OWN_ADDR1, a.OWN_CITY, a.OWN_STATE, a.OWN_ZIPCD].filter(Boolean).join(', ')].filter(Boolean)
    const sale = a.SALE_PRC1 ? `${money(a.SALE_PRC1)} (${a.SALE_MO1 || ''}/${a.SALE_YR1 || ''})` : '—'
    const existing = S.contacts.find(c => c.parcel_id && c.parcel_id === a.PARCEL_ID)
    const n = el('div', { class: 'pop' },
      el('h3', { text: a.PHY_ADDR1 || 'Parcel' }),
      el('div', { class: 'muted', text: a.PHY_CITY || '' }),
      el('dl', null,
        el('dt', { text: 'Owner' }), el('dd', { text: owner[0] || '—' }),
        owner[1] ? [el('dt', { text: 'Mailing' }), el('dd', { text: owner[1] })] : null,
        el('dt', { text: 'Parcel ID' }), el('dd', { text: a.PARCEL_ID || '—' }),
        el('dt', { text: 'Use code' }), el('dd', { text: a.DOR_UC || '—' }),
        el('dt', { text: 'Just value' }), el('dd', { text: money(a.JV) }),
        el('dt', { text: 'Last sale' }), el('dd', { text: sale }),
        el('dt', { text: 'Land SF' }), el('dd', { text: a.LND_SQFOOT ? Number(a.LND_SQFOOT).toLocaleString() : '—' }),
        el('dt', { text: 'Bldg SF' }), el('dd', { text: a.TOT_LVG_AR ? Number(a.TOT_LVG_AR).toLocaleString() : '—' }),
        el('dt', { text: 'Year built' }), el('dd', { text: a.ACT_YR_BLT || '—' })),
      el('div', { class: 'actions' },
        existing ? el('button', { class: 'btn small primary', onclick: () => openContact(existing.id) }, 'Open ' + existing.name) :
          el('button', { class: 'btn small primary', onclick: () => { MAP.map.closePopup(); openContactForm({ name: '', company: a.OWN_NAME || '', address: addr, lat: latlng.lat, lng: latlng.lng, parcel_id: a.PARCEL_ID, notes: `Owner of record: ${owner.join(' — ')}` }) } }, 'Add as contact'),
        el('button', { class: 'btn small', onclick: async e => {
          e.target.disabled = true
          const c = parcelCenter(f) || latlng
          const { error } = await sb.from('pins').insert({ name: a.PHY_ADDR1 || 'Parcel', address: addr, lat: c.lat, lng: c.lng, parcel_id: a.PARCEL_ID, owner_name: a.OWN_NAME, pin_type: 'prospect' })
          if (error) { toast(error.message); e.target.disabled = false } else { toast('Pin saved'); MAP.map.closePopup(); await loadTable('pins'); refreshMap() }
        } }, 'Save pin'),
        el('a', { class: 'btn small', href: mapsHref(addr), target: '_blank', rel: 'noopener' }, 'Google Maps')))
    pop.setContent(n)
  } catch (e) { pop.setContent('Couldn’t load parcel: ' + esc(e.message)) }
}
function startPlacing(c) {
  MAP.placing = c
  if (S.tab !== 'map') go('map'); else render()
  if (c.lat != null) requestAnimationFrame(() => MAP.map?.setView([c.lat, c.lng], 18))
}
async function finishPlacing(latlng) {
  const c = MAP.placing; MAP.placing = null
  let parcel = null
  try { parcel = (await queryParcel('1=1', { geometry: `${latlng.lng},${latlng.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }))[0] } catch { }
  const patch = { lat: latlng.lat, lng: latlng.lng, location_note: 'Placed by hand on map', updated_at: new Date().toISOString() }
  if (parcel) { patch.parcel_id = parcel.attributes.PARCEL_ID }
  const { error } = await sb.from('contacts').update(patch).eq('id', c.id)
  if (error) toast(error.message); else { Object.assign(c, patch); toast(`${c.name} placed`) }
  render()
}

/* ---------- Geocoding (fills in missing map positions) ---------- */
let geoBusy = false
async function geocodeOne(c) {
  const q = addrOf(c)
  const r = await fetch('/api/geocode?' + new URLSearchParams({ q }))
  if (!r.ok) return null
  const j = await r.json()
  if (j.lat == null) return null
  let pt = { lat: +j.lat, lng: +j.lng }, parcelId = null
  let note = `Geocoded (${j.source})${j.approximate ? ' — approximate, check it' : ''}: ${j.matched || q}`
  // Snap to the parcel under that point when the house number matches
  try {
    const [f] = await queryParcel('1=1', { geometry: `${pt.lng},${pt.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' })
    const num = (q.match(/^\s*(\d+)/) || [])[1]
    if (f && num && String(f.attributes.PHY_ADDR1 || '').startsWith(num + ' ')) {
      parcelId = f.attributes.PARCEL_ID; pt = parcelCenter(f) || pt; note = 'Matched to parcel ' + parcelId
    }
  } catch { }
  return { ...pt, parcelId, note }
}
async function geocodeMissing() {
  const todo = S.contacts.filter(c => c.lat == null && (c.address_query || c.address) && !geoTried.has(c.id))
  if (!todo.length || geoBusy) return
  geoBusy = true
  for (const c of todo) {
    geoTried.add(c.id)
    try {
      const g = await geocodeOne(c)
      if (g) {
        const patch = { lat: g.lat, lng: g.lng, location_note: g.note, updated_at: new Date().toISOString() }
        if (g.parcelId && !c.parcel_id) patch.parcel_id = g.parcelId
        const { error } = await sb.from('contacts').update(patch).eq('id', c.id)
        if (!error) Object.assign(c, patch)
      }
    } catch (e) { console.warn('geocode', c.id, e) }
    if (S.tab === 'map') refreshMap()
    await new Promise(r => setTimeout(r, 600))
  }
  geoBusy = false
  if (S.tab === 'map') render({ soft: true })
}
const geoTried = new Set()

/* ---------- Contact drawer ---------- */
let openDrawerId = null
function closeDrawer() { openDrawerId = null; document.querySelectorAll('.scrim,.drawer').forEach(n => n.remove()) }
function showDrawer(content) {
  document.querySelectorAll('.scrim,.drawer').forEach(n => n.remove())
  const scrim = el('div', { class: 'scrim', onclick: closeDrawer })
  const d = el('aside', { class: 'drawer' }, el('button', { class: 'btn small x', onclick: closeDrawer }, 'Close'), content)
  document.body.append(scrim, d)
  return d
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer() })
function openContact(id) { openDrawerId = id; MAP.map?.closePopup(); refreshDrawer(true) }
function refreshDrawer(fresh) {
  const c = contactById(openDrawerId); if (!c) { closeDrawer(); return }
  const old = document.querySelector('.drawer')
  // Don't wipe something being typed when a live update arrives
  if (!fresh && old && [...old.querySelectorAll('textarea,input')].some(i => i.dataset.dirty)) return
  const scroll = old ? old.scrollTop : 0
  const d = showDrawer(contactDetail(c))
  if (!fresh) d.scrollTop = scroll
}
function contactDetail(c) {
  const tel = telHref(c.phone), hist = convosFor(c.id)
  const dirty = e => { e.target.dataset.dirty = '1' }
  // Log a conversation
  const talked = el('input', { type: 'date', value: ymd(today()), oninput: dirty })
  const notes = el('textarea', { rows: 4, placeholder: 'What did you talk about?', oninput: dirty })
  const pri = el('select', { oninput: dirty }, ['A', 'B', 'C'].map(p => el('option', { value: p, text: `${p} — ${CADENCE[p].label}`, selected: (c.priority || 'C') === p })))
  const nextDate = el('input', { type: 'date', value: ymd(addCadence(today(), c.priority || 'C')), oninput: dirty })
  pri.addEventListener('change', () => { nextDate.value = ymd(addCadence(parse(talked.value) || today(), pri.value)) })
  talked.addEventListener('change', () => { nextDate.value = ymd(addCadence(parse(talked.value) || today(), pri.value)) })
  const nextStep = el('input', { type: 'text', placeholder: 'What to do on that call', value: '', oninput: dirty })
  const logErr = el('div', { class: 'err' })
  const save = el('button', { class: 'btn primary' }, 'Save conversation')
  save.onclick = async () => {
    if (!notes.value.trim()) { logErr.textContent = 'Add a note about the conversation.'; return }
    save.disabled = true; logErr.textContent = ''
    try {
      const { error: e1 } = await sb.from('conversations').insert({ contact_id: c.id, talked_on: talked.value, notes: notes.value.trim() })
      if (e1) throw e1
      const patch = { last_contact: talked.value, priority: pri.value, next_follow_up: nextDate.value || null, next_note: nextStep.value.trim() || null, updated_at: new Date().toISOString() }
      if (c.last_contact && c.last_contact > talked.value) delete patch.last_contact
      const { error: e2 } = await sb.from('contacts').update(patch).eq('id', c.id)
      if (e2) throw e2
      await Promise.all([loadTable('conversations'), loadTable('contacts')])
      toast('Conversation saved'); render({ soft: true }); refreshDrawer(true)
    } catch (x) { logErr.textContent = 'Couldn’t save: ' + (x.message || x); save.disabled = false }
  }
  return el('div', null,
    el('div', { style: 'display:flex;gap:10px;align-items:center;padding-right:70px' },
      el('span', { class: 'pri ' + (c.priority || 'C'), text: c.priority || 'C' }), el('h2', { text: c.name })),
    el('div', { class: 'actions', style: 'margin-top:8px' },
      c.contact_type ? el('span', { class: 'tag ' + c.contact_type, text: c.contact_type }) : null,
      el('span', { class: 'muted', style: 'font-size:13px', text: (CADENCE[c.priority] || CADENCE.C).label + ' follow-up' })),
    el('dl', { class: 'facts' },
      el('dt', { text: 'Phone' }), el('dd', null, tel ? el('a', { href: tel, text: c.phone }) : '—', c.phone_note ? el('span', { class: 'muted', text: ' · ' + c.phone_note }) : null),
      c.email ? [el('dt', { text: 'Email' }), el('dd', null, el('a', { href: 'mailto:' + c.email, text: c.email }))] : null,
      c.company ? [el('dt', { text: 'Company' }), el('dd', { text: c.company })] : null,
      el('dt', { text: 'Property' }), el('dd', null, (c.address || c.address_query) ? el('a', { href: mapsHref(addrOf(c)), target: '_blank', rel: 'noopener', text: c.address || c.address_query }) : '—',
        c.lat != null ? el('button', { class: 'btn small ghost', style: 'margin-left:6px', onclick: () => { closeDrawer(); go('map'); MAP.map.setView([c.lat, c.lng], 18) } }, 'Show on map')
          : (c.address || c.address_query) ? el('button', { class: 'btn small ghost', style: 'margin-left:6px', onclick: () => { closeDrawer(); startPlacing(c) } }, 'Place on map') : null),
      c.parcel_id ? [el('dt', { text: 'Parcel' }), el('dd', { text: c.parcel_id })] : null,
      el('dt', { text: 'Next call' }), el('dd', { text: fmt(c.next_follow_up, LONG) + (c.next_note ? ' — ' + c.next_note : '') }),
      el('dt', { text: 'Last talked' }), el('dd', { text: fmt(c.last_contact, LONG) }),
      el('dt', { text: 'About' }), el('dd', { style: 'white-space:pre-wrap', text: c.notes || '—' })),
    el('div', { class: 'box stack' },
      el('h4', { text: 'Log a conversation' }),
      el('label', { class: 'f' }, 'Date you talked', talked),
      el('label', { class: 'f' }, 'Notes', notes),
      el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Priority', pri), el('label', { class: 'f' }, 'Next call', nextDate)),
      el('label', { class: 'f' }, 'Next step', nextStep),
      logErr, el('div', { class: 'actions' }, save)),
    el('h4', { text: `Conversation history (${hist.length})` }),
    hist.length ? el('ul', { class: 'timeline' }, hist.map(v => el('li', null, el('div', { class: 'date', text: fmt(v.talked_on, LONG) }), el('div', { class: 'txt', text: v.notes }))))
      : el('p', { class: 'muted', text: 'No conversations logged yet.' }),
    el('div', { class: 'actions', style: 'margin-top:20px' },
      el('button', { class: 'btn', onclick: () => openContactForm(c) }, 'Edit contact')))
}

/* ---------- Add / edit contact ---------- */
function openContactForm(c = {}) {
  const editing = !!c.id
  const v = k => c[k] ?? ''
  const f = {
    name: el('input', { required: true, value: v('name') }),
    company: el('input', { value: v('company') }),
    phone: el('input', { type: 'tel', value: v('phone') }),
    email: el('input', { type: 'email', value: v('email') }),
    priority: el('select', null, ['A', 'B', 'C'].map(p => el('option', { value: p, text: `${p} — ${CADENCE[p].label}`, selected: (c.priority || 'C') === p }))),
    contact_type: el('select', null, TYPES.map(t => el('option', { value: t, text: t, selected: (c.contact_type || 'Owner') === t }))),
    address: el('input', { value: v('address'), placeholder: '2121 Cornell St' }),
    city: el('input', { value: v('city'), placeholder: 'Sarasota' }),
    next_follow_up: el('input', { type: 'date', value: v('next_follow_up') }),
    next_note: el('input', { value: v('next_note') }),
    notes: el('textarea', { rows: 4, text: v('notes') }),
    first: el('textarea', { rows: 3, placeholder: 'Optional — saved as the first dated conversation' }),
  }
  const err = el('div', { class: 'err' })
  const save = el('button', { class: 'btn primary', type: 'submit' }, editing ? 'Save changes' : 'Add contact')
  const form = el('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault(); err.textContent = ''; save.disabled = true
    try {
      const addr = f.address.value.trim(), city = f.city.value.trim()
      const row = {
        name: f.name.value.trim(), company: f.company.value.trim() || null, phone: f.phone.value.trim() || null, email: f.email.value.trim() || null,
        priority: f.priority.value, contact_type: f.contact_type.value, address: addr || null, city: city || null,
        address_query: addr ? (/,/.test(addr) ? addr : [addr, city, 'FL'].filter(Boolean).join(', ')) : null,
        next_follow_up: f.next_follow_up.value || null, next_note: f.next_note.value.trim() || null, notes: f.notes.value.trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (editing) {
        if (addr !== (c.address || '') || city !== (c.city || '')) { row.lat = null; row.lng = null; geoTried.delete(c.id) }
        const { error } = await sb.from('contacts').update(row).eq('id', c.id); if (error) throw error
      } else {
        let id = slug(row.name), n = 2
        while (contactById(id)) id = slug(row.name) + '-' + n++
        Object.assign(row, { id, lat: c.lat ?? null, lng: c.lng ?? null, parcel_id: c.parcel_id ?? null })
        if (!row.next_follow_up) row.next_follow_up = ymd(addCadence(today(), row.priority))
        if (f.first.value.trim()) row.last_contact = ymd(today())
        const { error } = await sb.from('contacts').insert(row); if (error) throw error
        if (f.first.value.trim()) { const { error: e2 } = await sb.from('conversations').insert({ contact_id: id, talked_on: ymd(today()), notes: f.first.value.trim() }); if (e2) throw e2 }
        if (c.pinId) await sb.from('pins').update({ contact_id: id }).eq('id', c.pinId)
        c = { id }
      }
      await Promise.all([loadTable('contacts'), loadTable('conversations')])
      render({ soft: true }); openContact(c.id); geocodeMissing()
      toast(editing ? 'Saved' : 'Contact added')
    } catch (x) { err.textContent = x.message || String(x); save.disabled = false }
  } },
    el('h2', { text: editing ? 'Edit contact' : 'New contact' }),
    el('label', { class: 'f' }, 'Name', f.name),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Phone', f.phone), el('label', { class: 'f' }, 'Email', f.email)),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Priority', f.priority), el('label', { class: 'f' }, 'Type', f.contact_type)),
    el('label', { class: 'f' }, 'Company / entity', f.company),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Property address', f.address), el('label', { class: 'f' }, 'City', f.city)),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Next follow-up', f.next_follow_up), el('label', { class: 'f' }, 'Next step', f.next_note)),
    el('label', { class: 'f' }, 'About this contact', f.notes),
    editing ? null : el('label', { class: 'f' }, 'Notes from this first conversation', f.first),
    editing ? null : el('div', { class: 'muted', style: 'font-size:12px', text: 'Leave the follow-up date blank to set it by priority. The address is placed on the map automatically.' }),
    err, el('div', { class: 'actions' }, save, el('button', { class: 'btn', type: 'button', onclick: () => editing ? openContact(c.id) : closeDrawer() }, 'Cancel')))
  openDrawerId = null
  showDrawer(form)
  f.name.focus()
}

/* ---------- Buyers ---------- */
const B = { q: '', results: null, busy: false }
function buyersView() {
  const search = el('input', { class: 'search', type: 'search', placeholder: 'Try “pinellas office buyer” or “sarasota medical”', value: B.q, 'data-keep': 'bq',
    oninput: e => { B.q = e.target.value }, onkeydown: e => { if (e.key === 'Enter') runSearch() } })
  async function runSearch() {
    B.busy = true; render({ soft: true })
    const q = B.q.trim()
    if (!q) { B.results = null; B.busy = false; render({ soft: true }); return }
    const { data, error } = await sb.rpc('search_crm', { q })
    B.busy = false; B.results = error ? { error: error.message } : data; render({ soft: true })
  }
  const list = S.buyers
  return el('div', null,
    el('div', { class: 'head' }, el('div', null, el('h1', { text: 'Buyers' }), el('p', { class: 'muted', text: `${list.length} buyer${list.length === 1 ? '' : 's'} with criteria` })),
      el('button', { class: 'btn primary', onclick: () => openBuyerForm() }, '+ New buyer')),
    el('div', { class: 'filters' }, search, el('button', { class: 'btn', onclick: runSearch, disabled: B.busy }, B.busy ? 'Searching…' : 'Search CRM')),
    B.results ? el('div', null,
      el('div', { class: 'section-title', text: 'Search results' }),
      el('div', { class: 'card' }, B.results.error ? el('div', { class: 'empty err', text: B.results.error }) :
        B.results.length ? el('ul', { class: 'list' }, B.results.map(r => el('li', { class: 'item', onclick: () => {
          const c = contactById(r.ref) || S.contacts.find(x => x.name === r.name) || contactById(S.buyers.find(b => String(b.id) === String(r.ref))?.contact_id)
          if (c) openContact(c.id); else { const b = S.buyers.find(b => String(b.id) === String(r.ref)); if (b) openBuyerForm(b) }
        } },
          el('span', { class: 'tag', text: r.kind }),
          el('div', { class: 'who' }, el('div', { class: 'name', text: r.name }), el('div', { class: 'sub', text: r.summary || '' })))))
          : el('div', { class: 'empty', text: 'No matches.' }))) : null,
    el('div', { class: 'section-title', text: 'All buyers' }),
    el('div', { class: 'card' }, list.length ? el('ul', { class: 'list' }, list.map(b => el('li', { class: 'item', onclick: () => openBuyerForm(b) },
      el('div', { class: 'who' },
        el('div', { class: 'name' }, b.name, b.in_1031 ? el('span', { class: 'tag Buyer', text: '1031' }) : null),
        el('div', { class: 'sub', text: [(b.markets || []).join(', '), (b.product_types || []).join(', '), sfRange(b), priceRange(b)].filter(Boolean).join(' · ') })),
      b.phone ? el('a', { class: 'tel', href: telHref(b.phone), onclick: e => e.stopPropagation(), text: b.phone }) : null)))
      : el('div', { class: 'empty', text: 'No buyers yet.' })))
}
const sfRange = b => b.min_sf || b.max_sf ? `${b.min_sf ? Number(b.min_sf).toLocaleString() : '?'}–${b.max_sf ? Number(b.max_sf).toLocaleString() : '?'} SF` : ''
const priceRange = b => b.min_price || b.max_price ? `${money(b.min_price)}–${money(b.max_price)}` : ''
function openBuyerForm(b = {}) {
  const editing = !!b.id
  const csv = a => (a || []).join(', ')
  const f = {
    contact_id: el('select', null, el('option', { value: '', text: '— Not linked —' }), [...S.contacts].sort((a, x) => a.name.localeCompare(x.name)).map(c => el('option', { value: c.id, text: c.name, selected: b.contact_id === c.id }))),
    name: el('input', { required: true, value: b.name || '' }), company: el('input', { value: b.company || '' }),
    phone: el('input', { value: b.phone || '' }), email: el('input', { value: b.email || '' }),
    markets: el('input', { value: csv(b.markets), placeholder: 'Sarasota, Pinellas, Tampa' }),
    product_types: el('input', { value: csv(b.product_types), placeholder: 'Office, Medical office' }),
    min_sf: el('input', { type: 'number', value: b.min_sf ?? '' }), max_sf: el('input', { type: 'number', value: b.max_sf ?? '' }),
    min_price: el('input', { type: 'number', value: b.min_price ?? '' }), max_price: el('input', { type: 'number', value: b.max_price ?? '' }),
    in_1031: el('input', { type: 'checkbox', checked: !!b.in_1031 }), exchange_deadline: el('input', { type: 'date', value: b.exchange_deadline || '' }),
    notes: el('textarea', { rows: 4, text: b.notes || '' }),
  }
  f.contact_id.onchange = () => { const c = contactById(f.contact_id.value); if (c) { f.name.value ||= c.name; f.phone.value ||= c.phone || ''; f.email.value ||= c.email || ''; f.company.value ||= c.company || '' } }
  const list = s => s.split(',').map(x => x.trim()).filter(Boolean)
  const num = s => s === '' ? null : Number(s)
  const err = el('div', { class: 'err' }), save = el('button', { class: 'btn primary', type: 'submit' }, editing ? 'Save buyer' : 'Add buyer')
  const form = el('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault(); save.disabled = true; err.textContent = ''
    const row = { contact_id: f.contact_id.value || null, name: f.name.value.trim(), company: f.company.value.trim() || null, phone: f.phone.value.trim() || null, email: f.email.value.trim() || null,
      markets: list(f.markets.value), product_types: list(f.product_types.value), min_sf: num(f.min_sf.value), max_sf: num(f.max_sf.value),
      min_price: num(f.min_price.value), max_price: num(f.max_price.value), in_1031: f.in_1031.checked, exchange_deadline: f.exchange_deadline.value || null,
      notes: f.notes.value.trim() || null, updated_at: new Date().toISOString() }
    const { error } = editing ? await sb.from('buyers').update(row).eq('id', b.id) : await sb.from('buyers').insert(row)
    if (error) { err.textContent = error.message; save.disabled = false; return }
    await loadTable('buyers'); closeDrawer(); render({ soft: true }); toast('Buyer saved')
  } },
    el('h2', { text: editing ? 'Edit buyer' : 'New buyer' }),
    el('label', { class: 'f' }, 'Linked contact', f.contact_id),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Name', f.name), el('label', { class: 'f' }, 'Company', f.company)),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Phone', f.phone), el('label', { class: 'f' }, 'Email', f.email)),
    el('label', { class: 'f' }, 'Markets (comma separated)', f.markets),
    el('label', { class: 'f' }, 'Product types (comma separated)', f.product_types),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Min SF', f.min_sf), el('label', { class: 'f' }, 'Max SF', f.max_sf)),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Min price', f.min_price), el('label', { class: 'f' }, 'Max price', f.max_price)),
    el('div', { class: 'row2' }, el('label', { class: 'f', style: 'flex-direction:row;align-items:center;gap:8px' }, f.in_1031, 'In a 1031 exchange'), el('label', { class: 'f' }, '1031 deadline', f.exchange_deadline)),
    el('label', { class: 'f' }, 'Notes', f.notes),
    err, el('div', { class: 'actions' }, save, el('button', { class: 'btn', type: 'button', onclick: closeDrawer }, 'Cancel'),
      b.contact_id ? el('button', { class: 'btn ghost', type: 'button', onclick: () => openContact(b.contact_id) }, 'Open contact') : null))
  openDrawerId = null
  showDrawer(form)
}

boot()
