import { createClient } from '@supabase/supabase-js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as esri from 'esri-leaflet'
import './style.css'
import Papa from 'papaparse'

/* ---------- Config ---------- */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ucjicbvlctzrauahzvgf.supabase.co'
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_pYaBkCJkb5RpPyFhPwkibw_8gZ7TukF'
// County parcel layers from the Southwest Florida Water Management District (public, supports area searches)
const PARCEL_SVC = 'https://www25.swfwmd.state.fl.us/arcgis12/rest/services/BaseVector/parcel_search/MapServer'
const COUNTY_LAYERS = [{ id: 15, name: 'Sarasota' }, { id: 10, name: 'Manatee' }, { id: 1, name: 'Charlotte' }, { id: 13, name: 'Pinellas' }, { id: 7, name: 'Hillsborough' }]
const CITY_COUNTY = {
  sarasota: 'Sarasota', venice: 'Sarasota', nokomis: 'Sarasota', osprey: 'Sarasota', englewood: 'Sarasota', 'north port': 'Sarasota', 'longboat key': 'Sarasota', 'siesta key': 'Sarasota',
  bradenton: 'Manatee', 'lakewood ranch': 'Manatee', palmetto: 'Manatee', ellenton: 'Manatee', parrish: 'Manatee', 'anna maria': 'Manatee', 'holmes beach': 'Manatee',
  tampa: 'Hillsborough', brandon: 'Hillsborough', riverview: 'Hillsborough', 'plant city': 'Hillsborough', lutz: 'Hillsborough',
  'st petersburg': 'Pinellas', 'st. petersburg': 'Pinellas', 'saint petersburg': 'Pinellas', clearwater: 'Pinellas', largo: 'Pinellas', dunedin: 'Pinellas', 'pinellas park': 'Pinellas', seminole: 'Pinellas', 'tarpon springs': 'Pinellas',
  'port charlotte': 'Charlotte', 'punta gorda': 'Charlotte',
}
const HOME = [27.3364, -82.5307] // Sarasota
const TYPES = ['Owner', 'Seller', 'Buyer', 'Leasing', 'Other']
const STAGES = ['Prospect', 'Contacted', 'Meeting', 'BOV', 'Listing', 'Under contract', 'Closed', 'Dead']
const PRODUCT_TYPES = ['Office', 'Medical office', 'Retail', 'Industrial', 'Flex', 'Multifamily', 'Land', 'Mixed use', 'Other']
const CADENCE = { A: { days: 14, label: 'Every 2 weeks' }, B: { months: 1, label: 'Monthly' }, C: { months: 3, label: 'Quarterly' } }

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

/* ---------- State ---------- */
const S = {
  session: null,
  contacts: [], convos: [], buyers: [], pins: [], props: [],
  tab: localStorage.getItem('tab') || 'today',
  q: '', pri: new Set(), type: '',
  pipeMode: localStorage.getItem('pipeMode') || 'board', pipeQ: '',
  calMonth: firstOfMonth(new Date()),
  live: false,
}
const TABLE_KEY = { contacts: 'contacts', conversations: 'convos', buyers: 'buyers', pins: 'pins', properties: 'props' }

/* ---------- Helpers ---------- */
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag)
  if (attrs) for (const k in attrs) {
    const v = attrs[k]
    if (v == null || v === false) continue
    if (k === 'class') n.className = v
    else if (k === 'text') n.textContent = v
    else if (k === 'value') n.value = v
    else if (k === 'checked') n.checked = !!v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else n.setAttribute(k, v === true ? '' : v)
  }
  for (const k of kids.flat(3)) { if (k == null || k === false) continue; n.append(k.nodeType ? k : document.createTextNode(k)) }
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
function addBusinessDays(from, n) {
  const d = new Date(from)
  while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n-- }
  return d
}
// Phone links open Webex by default (webextel: works on Windows, Mac, iOS and Android); switchable to the device's phone app
const callWith = () => { try { return localStorage.getItem('callWith') || 'webex' } catch { return 'webex' } }
const telHref = p => {
  const d = String(p || '').replace(/\D/g, ''); if (!d) return null
  const e164 = '+' + (d.length === 10 ? '1' + d : d)
  return (callWith() === 'webex' ? 'webextel:' : 'tel:') + e164
}
const smsHref = p => { const d = String(p || '').replace(/\D/g, ''); return d ? 'sms:+' + (d.length === 10 ? '1' + d : d) : null }
const isText = n => /^text (sent|received)/i.test(String(n || '').trim())
const mapsHref = q => q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : null
const addrOf = x => x.address_query || [x.address, x.city, 'FL'].filter(Boolean).join(', ')
const slug = s => String(s).toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'contact'
const money = n => n == null || n === '' ? '—' : '$' + Math.round(Number(n)).toLocaleString()
const moneyShort = n => { if (n == null || n === '') return ''; n = Number(n); return n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, '') + 'M' : '$' + Math.round(n / 1e3) + 'K' }
const num = n => n == null || n === '' ? '—' : Number(n).toLocaleString()
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
const nowIso = () => new Date().toISOString()
const fmtTime = t => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m || 0)} ${h < 12 ? 'AM' : 'PM'}` }
const byWhen = (a, b) => (a.next_follow_up || '9999').localeCompare(b.next_follow_up || '9999') || (a.next_time || '99').localeCompare(b.next_time || '99') || (a.priority || 'C').localeCompare(b.priority || 'C')

function toast(msg) {
  const t = el('div', { class: 'toast', text: msg }); document.body.append(t)
  setTimeout(() => t.remove(), 2600)
}
const convosFor = id => S.convos.filter(v => v.contact_id === id).sort((a, b) => String(b.talked_on).localeCompare(String(a.talked_on)) || b.id - a.id)
const contactById = id => S.contacts.find(c => c.id === id)
const propById = id => S.props.find(p => String(p.id) === String(id))
const propsFor = cid => S.props.filter(p => p.contact_id === cid)
const propTitle = p => p.name ? `${p.name} — ${p.address}` : p.address

// DOR use codes → plain labels + product type
const DOR = {
  0: ['Vacant residential', 'Land'], 1: ['Single family', 'Other'], 3: ['Multifamily 10+ units', 'Multifamily'], 4: ['Condominium', 'Other'], 8: ['Multifamily <10 units', 'Multifamily'],
  10: ['Vacant commercial', 'Land'], 11: ['Store, 1 story', 'Retail'], 12: ['Mixed use store/office/res', 'Mixed use'], 13: ['Department store', 'Retail'], 14: ['Supermarket', 'Retail'],
  15: ['Regional shopping center', 'Retail'], 16: ['Community shopping center', 'Retail'], 17: ['Office, 1 story', 'Office'], 18: ['Office, multi-story', 'Office'],
  19: ['Professional / medical office', 'Medical office'], 20: ['Airport / marina', 'Other'], 21: ['Restaurant', 'Retail'], 22: ['Drive-in restaurant', 'Retail'], 23: ['Bank / financial', 'Retail'],
  24: ['Insurance office', 'Office'], 25: ['Repair service shop', 'Retail'], 26: ['Service station', 'Retail'], 27: ['Auto sales / service', 'Retail'], 28: ['Parking lot / MH park', 'Other'],
  33: ['Nightclub / bar', 'Retail'], 39: ['Hotel / motel', 'Other'], 40: ['Vacant industrial', 'Land'], 41: ['Light manufacturing', 'Industrial'], 42: ['Heavy industrial', 'Industrial'],
  48: ['Warehouse / distribution', 'Industrial'], 49: ['Open storage', 'Industrial'], 71: ['Church', 'Other'], 73: ['Private hospital', 'Medical office'], 77: ['Club / lodge', 'Other'],
}
const dorInfo = code => { const n = parseInt(code, 10); return isNaN(n) ? null : (DOR[n] ? { code: n, label: DOR[n][0], type: DOR[n][1] } : { code: n, label: 'Use code ' + n, type: null }) }

/* ---------- Data ---------- */
async function loadTable(t) {
  const order = { contacts: 'name', conversations: 'talked_on', buyers: 'name', pins: 'created_at', properties: 'address' }[t]
  // Supabase returns at most 1,000 rows per request — page through so nothing is silently cut off
  const PAGE = 1000, rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(t).select('*').order(order).order('id').range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  S[TABLE_KEY[t]] = rows
}
async function loadAll() { await Promise.all(Object.keys(TABLE_KEY).map(loadTable)) }
const reloadTimers = {}
let liveChannel = null
function subscribe() {
  if (liveChannel) return
  liveChannel = sb.channel('crm-live-' + Math.random().toString(36).slice(2, 8))
  liveChannel
    .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
      const t = payload.table; if (!TABLE_KEY[t]) return
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
let starting = false
async function start() {
  if (starting) return
  starting = true
  try { await startInner() } finally { starting = false }
}
async function startInner() {
  const app = document.getElementById('app')
  if (!S.session) {
    if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null }
    app.replaceChildren(loginView()); return
  }
  app.replaceChildren(el('div', { class: 'login' }, el('div', { class: 'card' }, el('p', { class: 'muted', text: 'Loading your CRM…' }))))
  try {
    const { data: me } = await sb.from('app_users').select('email').limit(1)
    if (!me || !me.length) { app.replaceChildren(deniedView()); return }
    await loadAll()
    try { subscribe() } catch (e) { console.warn('live updates', e) }
    render()
    locateMissing()
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
    el('label', { class: 'f' }, 'Email', email), el('label', { class: 'f' }, 'Password', pw),
    err, note, go, el('div', { class: 'actions' }, toggle, forgot))
  return el('div', { class: 'login' }, el('div', { class: 'card stack' },
    el('div', null, el('h1', { text: 'Cole CRM' }), el('p', { class: 'muted', text: 'Sign in to your contacts, pipeline and map.' })), form))
}
function deniedView() {
  return el('div', { class: 'login' }, el('div', { class: 'card stack' },
    el('h1', { text: 'No access' }),
    el('p', { class: 'muted', text: `${S.session?.user?.email} isn’t on the CRM’s allowed list.` }),
    el('button', { class: 'btn', onclick: () => sb.auth.signOut() }, 'Sign out')))
}

/* ---------- Shell ---------- */
const TABS = [['today', 'Today'], ['contacts', 'Contacts'], ['prospects', 'Prospects'], ['pipeline', 'Pipeline'], ['map', 'Map'], ['calendar', 'Calendar'], ['buyers', 'Buyers'], ['meetings', 'Meetings'], ['notes', 'Notes'], ['kpis', 'KPIs']]
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
      el('button', { class: 'btn small ghost callwith', title: 'Choose what phone links open', onclick: () => {
        const next = callWith() === 'webex' ? 'phone' : 'webex'
        try { localStorage.setItem('callWith', next) } catch { }
        toast(next === 'webex' ? 'Phone numbers now open Webex' : 'Phone numbers now open your phone app')
        render({ soft: true }); if (DRAWER.kind) refreshDrawer(true)
      } }, callWith() === 'webex' ? '📞 Webex' : '📞 Phone'),
      el('button', { class: 'btn small primary', onclick: () => openContactForm() }, '+ Contact'),
      el('button', { class: 'btn small ghost signout', onclick: () => sb.auth.signOut() }, 'Sign out')))
  const main = el('main', { class: S.tab === 'map' ? 'full' : S.tab === 'pipeline' && S.pipeMode === 'board' ? 'wide' : '' })
  const view = { today: todayView, contacts: contactsView, prospects: prospectsView, pipeline: pipelineView, calendar: calendarView, map: mapView, buyers: buyersView, meetings: meetingsView, notes: notesView, kpis: kpiView }[S.tab] || todayView
  const active = document.activeElement
  const focused = soft && active && active.dataset && active.dataset.keep
  const caret = focused ? active.selectionStart : null
  const scrollY = soft ? window.scrollY : 0
  const boardScroll = soft ? document.querySelector('.board')?.scrollLeft : 0
  main.append(view())
  app.replaceChildren(top, main)
  paintLive()
  if (soft) { window.scrollTo(0, scrollY); const b = document.querySelector('.board'); if (b && boardScroll) b.scrollLeft = boardScroll }
  if (focused) { const n = document.querySelector(`[data-keep="${focused}"]`); if (n) { n.focus(); try { n.setSelectionRange(caret, caret) } catch { } } }
  if (S.tab === 'map') requestAnimationFrame(() => { MAP.map?.invalidateSize(); refreshMap() })
  if (soft && DRAWER.kind) refreshDrawer()
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
      el('div', { class: 'name' }, c.name, c.contact_type && c.contact_type !== 'Seller' ? el('span', { class: 'tag ' + c.contact_type, text: c.contact_type }) : null,
        late ? el('span', { class: 'late', text: late + 'd overdue' }) : null),
      el('div', { class: 'sub', text: [c.next_note, c.address].filter(Boolean).join(' · ') || '—' })),
    showDate ? el('div', { class: 'when', text: fmt(c.next_follow_up, { weekday: 'short', month: 'short', day: 'numeric' }) + (c.next_time ? ' · ' + fmtTime(c.next_time) : '') }) : null,
    tel ? el('a', { class: 'tel', href: tel, onclick: e => e.stopPropagation(), text: c.phone }) : null)
}
function todayView() {
  const T = today(), Ts = ymd(T), wk = new Date(T); wk.setDate(wk.getDate() + 7); const Ws = ymd(wk)
  const withDate = S.contacts.filter(c => c.next_follow_up).sort(byWhen)
  const overdue = withDate.filter(c => c.next_follow_up < Ts)
  const due = withDate.filter(c => c.next_follow_up === Ts)
  const week = withDate.filter(c => c.next_follow_up > Ts && c.next_follow_up <= Ws)
  const recent = [...S.convos].sort((a, b) => String(b.talked_on).localeCompare(String(a.talked_on)) || b.id - a.id).slice(0, 6)
  const active = S.props.filter(p => ['Meeting', 'BOV', 'Listing', 'Under contract'].includes(p.stage))
  const block = (title, arr, empty) => [el('div', { class: 'section-title', text: `${title} (${arr.length})` }),
    el('div', { class: 'card' }, arr.length ? el('ul', { class: 'list' }, arr.map(c => contactRow(c))) : el('div', { class: 'empty', text: empty }))]
  return el('div', null,
    el('div', { class: 'head' }, el('div', null,
      el('h1', { text: T.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }),
      el('p', { class: 'muted', text: overdue.length + due.length ? `${overdue.length + due.length} call${overdue.length + due.length === 1 ? '' : 's'} to make today` : 'No calls due today' }))),
    el('div', { class: 'stats' },
      stat(due.length, 'Due today'), stat(overdue.length, 'Overdue'), stat(week.length, 'Next 7 days'), stat(active.length, 'Active deals', () => go('pipeline'))),
    overdue.length ? block('Overdue', overdue, '') : null,
    block('Today', due, 'Nothing scheduled for today.'),
    block('Next 7 days', week, 'Nothing in the next week.'),
    active.length ? [el('div', { class: 'section-title', text: `Active deals (${active.length})` }),
      el('div', { class: 'card' }, el('ul', { class: 'list' }, active.map(propRow)))] : null,
    el('div', { class: 'section-title', text: 'Recent conversations' }),
    el('div', { class: 'card' }, recent.length ? el('ul', { class: 'list' }, recent.map(v => {
      const c = contactById(v.contact_id)
      return el('li', { class: 'item', onclick: () => c && openContact(c.id) },
        el('div', { class: 'who' }, el('div', { class: 'name', text: c ? c.name : v.contact_id }), el('div', { class: 'sub', text: v.notes })),
        el('div', { class: 'when', text: fmt(v.talked_on) }))
    })) : el('div', { class: 'empty', text: 'No conversations yet.' })))
}
const stat = (n, label, onclick) => el('div', { class: 'card stat' + (onclick ? ' click' : ''), onclick }, el('b', { text: n }), el('span', { text: label }))

/* ---------- Contacts ---------- */
// Phone search: "941-628-2030", "(941) 628 2030", "6282030", "+1 941…" all match the same number
function phoneQuery(q) {
  q = String(q || '')
  if (/[a-z]/i.test(q)) return null // has letters → it's a name/address search
  let d = q.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') d = d.slice(1)
  return d.length >= 4 ? d : null
}
const digitsOf = s => String(s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
const phoneLike = d => '*' + d.split('').join('*') + '*'
// Prospects with a matching number (any of their numbers) — shown under Contacts results
const PHQ = { q: null, rows: [], busy: false }
async function findProspectsByPhone(d) {
  if (PHQ.q === d) return
  PHQ.q = d; PHQ.busy = true; PHQ.rows = []
  const { data } = await sb.from('prospect_phones').select('phone, status, prospects(id, owner_name, company, property_address, city, status)').like('digits', `%${d}%`).limit(25)
  if (PHQ.q !== d) return
  PHQ.busy = false; PHQ.rows = (data || []).filter(r => r.prospects)
  if (S.tab === 'contacts') render({ soft: true })
}
function matches(c, q) {
  if (!q) return true
  const pd = phoneQuery(q.trim())
  if (pd) return digitsOf(c.phone).includes(pd)
  const hay = [c.name, c.company, c.phone, c.email, c.address, c.address_query, c.city, c.county, c.notes, c.next_note, c.contact_type,
    ...convosFor(c.id).map(v => v.notes), ...propsFor(c.id).map(p => [p.address, p.name, p.notes, p.stage, p.product_type].join(' '))].join(' ').toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))
}
function contactsView() {
  const list = S.contacts.filter(c => matches(c, S.q) && (!S.pri.size || S.pri.has(c.priority || 'C')) && (!S.type || c.contact_type === S.type))
    .sort((a, b) => (a.next_follow_up || '9999').localeCompare(b.next_follow_up || '9999') || a.name.localeCompare(b.name))
  return el('div', null,
    el('div', { class: 'head' }, el('div', null, el('h1', { text: 'Contacts' }), el('p', { class: 'muted', text: `${list.length} of ${S.contacts.length}` })),
      el('button', { class: 'btn primary', onclick: () => openContactForm() }, '+ New contact')),
    el('div', { class: 'filters' },
      el('input', { class: 'search', type: 'search', placeholder: 'Search name, address, notes, phone…', value: S.q, 'data-keep': 'q', oninput: e => { S.q = e.target.value; render({ soft: true }) } }),
      ['A', 'B', 'C'].map(p => el('button', { class: 'chip' + (S.pri.has(p) ? ' on' : ''), onclick: () => { S.pri.has(p) ? S.pri.delete(p) : S.pri.add(p); render() } }, p)),
      el('select', { class: 'chip', onchange: e => { S.type = e.target.value; render() } },
        el('option', { value: '', text: 'All types' }), TYPES.map(t => el('option', { value: t, text: t, selected: S.type === t })))),
    el('div', { class: 'card' }, list.length ? el('ul', { class: 'list' }, list.map(c => contactRow(c))) : el('div', { class: 'empty', text: 'No matches.' })),
    phoneMatchesCard())
}
function phoneMatchesCard() {
  const d = phoneQuery((S.q || '').trim())
  if (!d) { PHQ.q = null; return null }
  findProspectsByPhone(d)
  return el('div', null,
    el('div', { class: 'section-title', text: 'Prospects with this number' }),
    el('div', { class: 'card' }, PHQ.busy ? el('div', { class: 'empty', text: 'Searching prospects…' }) :
      PHQ.rows.length ? el('ul', { class: 'list' }, PHQ.rows.map(r => el('li', { class: 'item', onclick: () => { S.tab = 'prospects'; render(); openProspect(r.prospects.id) } },
        el('div', null,
          el('b', { text: r.prospects.owner_name || r.prospects.company || 'Unknown owner' }),
          el('div', { class: 'muted', text: [r.phone + (r.status && r.status !== 'Untested' ? ' · ' + r.status : ''), r.prospects.company, [r.prospects.property_address, r.prospects.city].filter(Boolean).join(', '), r.prospects.status].filter(Boolean).join(' · ') }))))) :
      el('div', { class: 'empty', text: 'No prospects with this number.' })))
}

/* ---------- Buyer matching ---------- */
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const countyOf = p => p.county || CITY_COUNTY[norm(p.city)] || null
function marketHit(p, markets) {
  const city = norm(p.city), county = norm(countyOf(p))
  return markets.some(m => {
    const k = norm(m).replace(/ county$/, '')
    if (k === 'tampa bay') return ['hillsborough', 'pinellas', 'pasco', 'manatee', 'sarasota'].includes(county)
    if (k === 'sarasota' || k === 'bradenton sarasota' || k === 'sarasota bradenton') return county === 'sarasota' || city === 'sarasota' || (k !== 'sarasota' && county === 'manatee')
    return k === city || k === county
  })
}
function typeHit(p, types) {
  const t = norm(p.product_type)
  if (!t) return null
  return types.some(x => { const k = norm(x); return t === k || t.includes(k) || k.includes(t) || (k === 'medical' && t.includes('medical')) })
}
const inRange = (v, lo, hi) => v == null ? null : (lo == null || v >= Number(lo)) && (hi == null || v <= Number(hi))
// Returns null (no match) or { level: 'match'|'possible', why: [...], unknown: [...] }
function buyerMatch(p, b) {
  if (!b || ['Dead', 'Closed'].includes(p.stage)) return null
  if (b.contact_id && b.contact_id === p.contact_id) return null
  const why = [], unknown = []
  const check = (label, res, detail) => { if (res === false) return false; if (res === null) unknown.push(label); else why.push(detail); return true }
  if ((b.markets || []).length && !check('market', marketHit(p, b.markets) ? true : false, p.city || countyOf(p))) return null
  if ((b.product_types || []).length && !check('type', typeHit(p, b.product_types) || false, p.product_type)) return null
  if ((b.min_sf != null || b.max_sf != null) && !check('size', inRange(p.building_sf != null ? Number(p.building_sf) : null, b.min_sf, b.max_sf), num(p.building_sf) + ' SF')) return null
  const price = p.asking_price ?? p.est_value
  if ((b.min_price != null || b.max_price != null) && !check('price', inRange(price != null ? Number(price) : null, b.min_price, b.max_price), moneyShort(price))) return null
  if (!why.length) return null
  return { level: unknown.length ? 'possible' : 'match', why, unknown }
}
const matchesForProp = p => S.buyers.map(b => ({ b, m: buyerMatch(p, b) })).filter(x => x.m).sort((a, c) => (a.m.level === 'match' ? 0 : 1) - (c.m.level === 'match' ? 0 : 1))
const matchesForBuyer = b => S.props.map(p => ({ p, m: buyerMatch(p, b) })).filter(x => x.m).sort((a, c) => (a.m.level === 'match' ? 0 : 1) - (c.m.level === 'match' ? 0 : 1))
function matchBadge(p) {
  const ms = matchesForProp(p); if (!ms.length) return null
  const strong = ms.filter(x => x.m.level === 'match').length
  return el('span', { class: 'match-badge' + (strong ? '' : ' weak'), title: ms.map(x => x.b.name).join(', ') }, `${ms.length} buyer${ms.length > 1 ? 's' : ''}`)
}
function matchList(items, render1) {
  return el('ul', { class: 'list' }, items.map(render1))
}

/* ---------- Pipeline ---------- */
function propMatches(p, q) {
  if (!q) return true
  const c = contactById(p.contact_id)
  const hay = [p.address, p.name, p.city, p.notes, p.stage, p.product_type, p.owner_of_record, p.parcel_id, c?.name, c?.company].join(' ').toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))
}
function propFacts(p) {
  return [p.product_type, p.building_sf ? num(p.building_sf) + ' SF' : null, p.year_built ? 'built ' + p.year_built : null,
    p.asking_price ? 'ask ' + moneyShort(p.asking_price) : p.est_value ? 'est ' + moneyShort(p.est_value) : null].filter(Boolean).join(' · ')
}
function propRow(p) {
  const c = contactById(p.contact_id)
  return el('li', { class: 'item', onclick: () => openProperty(p.id) },
    el('span', { class: 'stage-dot s' + STAGES.indexOf(p.stage) }),
    el('div', { class: 'who' },
      el('div', { class: 'name' }, propTitle(p), el('span', { class: 'stage-tag s' + STAGES.indexOf(p.stage), text: p.stage }), matchBadge(p)),
      el('div', { class: 'sub', text: [c ? c.name : p.owner_of_record, propFacts(p)].filter(Boolean).join(' · ') || '—' })),
    c?.next_follow_up ? el('div', { class: 'when', text: 'Call ' + fmt(c.next_follow_up) }) : null)
}
async function setStage(p, stage) {
  if (p.stage === stage) return
  const old = p.stage
  p.stage = stage; render({ soft: true })
  const { error } = await sb.from('properties').update({ stage, stage_updated_at: nowIso(), updated_at: nowIso() }).eq('id', p.id)
  if (error) { p.stage = old; render({ soft: true }); toast(error.message) } else toast(`${p.address} → ${stage}`)
}
function pipelineView() {
  const list = S.props.filter(p => propMatches(p, S.pipeQ))
  const head = el('div', { class: 'head' },
    el('div', null, el('h1', { text: 'Pipeline' }), el('p', { class: 'muted', text: `${S.props.filter(p => p.stage !== 'Dead' && p.stage !== 'Closed').length} open · ${S.props.length} properties` })),
    el('div', { class: 'actions' },
      el('div', { class: 'seg' }, ['board', 'list'].map(m => el('button', { class: S.pipeMode === m ? 'on' : '', onclick: () => { S.pipeMode = m; localStorage.setItem('pipeMode', m); render() } }, m === 'board' ? 'Board' : 'List'))),
      el('button', { class: 'btn primary', onclick: () => openPropertyForm() }, '+ Property')))
  const search = el('div', { class: 'filters' }, el('input', { class: 'search', type: 'search', placeholder: 'Search address, owner, notes, type…', value: S.pipeQ, 'data-keep': 'pq', oninput: e => { S.pipeQ = e.target.value; render({ soft: true }) } }))
  if (S.pipeMode === 'list') {
    const sorted = [...list].sort((a, b) => STAGES.indexOf(b.stage) % 7 - STAGES.indexOf(a.stage) % 7 || a.address.localeCompare(b.address))
    return el('div', null, head, search, el('div', { class: 'card' }, sorted.length ? el('ul', { class: 'list' }, sorted.map(propRow)) : el('div', { class: 'empty', text: 'No properties.' })))
  }
  const board = el('div', { class: 'board' }, STAGES.map((st, i) => {
    const cards = list.filter(p => p.stage === st)
    const total = cards.reduce((s, p) => s + Number(p.asking_price || p.est_value || 0), 0)
    const col = el('div', { class: 'col' + (st === 'Dead' ? ' dead' : ''), 'data-stage': st,
      ondragover: e => { e.preventDefault(); col.classList.add('over') }, ondragleave: () => col.classList.remove('over'),
      ondrop: e => { e.preventDefault(); col.classList.remove('over'); const p = propById(e.dataTransfer.getData('text/plain')); if (p) setStage(p, st) } },
      el('div', { class: 'col-head' }, el('span', { class: 'stage-dot s' + i }), el('b', { text: st }), el('span', { class: 'muted', text: cards.length }),
        total ? el('span', { class: 'muted col-total', text: moneyShort(total) }) : null),
      cards.map(p => {
        const c = contactById(p.contact_id)
        const sel = el('select', { class: 'stage-sel', onclick: e => e.stopPropagation(), onchange: e => setStage(p, e.target.value) }, STAGES.map(s => el('option', { value: s, text: s, selected: s === p.stage })))
        return el('div', { class: 'pcard', draggable: 'true', ondragstart: e => e.dataTransfer.setData('text/plain', String(p.id)), onclick: () => openProperty(p.id) },
          el('div', { class: 'pc-title', text: propTitle(p) }),
          c ? el('div', { class: 'pc-owner' }, el('span', { class: 'pri mini ' + (c.priority || 'C'), text: c.priority || 'C' }), c.name) : p.owner_of_record ? el('div', { class: 'pc-owner muted', text: p.owner_of_record }) : null,
          propFacts(p) ? el('div', { class: 'pc-facts', text: propFacts(p) }) : null,
          matchBadge(p),
          el('div', { class: 'pc-foot' }, c?.next_follow_up ? el('span', { class: 'muted', text: 'Call ' + fmt(c.next_follow_up) }) : el('span'), sel))
      }),
      cards.length ? null : el('div', { class: 'col-empty', text: 'Drag a card here' }))
    return col
  }))
  return el('div', null, head, search, board)
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
    const evs = (byDay[k] || []).sort(byWhen)
    grid.append(el('div', { class: 'cell' + (d.getMonth() !== m.getMonth() ? ' out' : '') + (k === T ? ' today' : '') },
      el('div', { class: 'd', text: d.getDate() }),
      evs.map(c => el('div', { class: 'ev', title: `${c.name} — ${c.next_note || ''}`, onclick: () => openContact(c.id) },
        el('span', { class: 'dot', style: `background:var(--${(c.priority || 'c').toLowerCase()})` }), el('span', { class: 'nm', text: (c.next_time ? fmtTime(c.next_time).replace(':00', '').replace(' ', '').toLowerCase() + ' ' : '') + c.name })))))
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
const MAP = { map: null, node: null, propsLayer: null, pinsLayer: null, parcels: null, placing: null, showParcels: true, showPins: false, showProspects: false, showCold: false, showDead: false, q: '', cold: null }
// A property is a map lead when its owner is a contact you've talked to and ranked A/B/C
const talkedTo = id => S.convos.some(v => v.contact_id === id)
const isLead = p => { const c = contactById(p.contact_id); return !!(c && ['A', 'B', 'C'].includes(c.priority) && talkedTo(c.id)) }
function mapView() {
  if (!MAP.node) {
    MAP.node = el('div', { id: 'map' })
    MAP.map = L.map(MAP.node, { zoomControl: true }).setView(HOME, 12)
    esri.tiledMapLayer({ url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer', maxZoom: 21, maxNativeZoom: 19 }).addTo(MAP.map)
    esri.tiledMapLayer({ url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer', maxZoom: 21, maxNativeZoom: 19, opacity: .7 }).addTo(MAP.map)
    esri.tiledMapLayer({ url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer', maxZoom: 21, maxNativeZoom: 19 }).addTo(MAP.map)
    MAP.parcels = L.layerGroup(COUNTY_LAYERS.map(c => {
      const fl = esri.featureLayer({
        url: `${PARCEL_SVC}/${c.id}`, minZoom: 16, fields: ['OBJECTID'], simplifyFactor: 0.35, precision: 6,
        style: () => ({ color: '#ffd84d', weight: 1.2, fill: true, fillOpacity: 0, opacity: .9 }),
      })
      fl.on('click', e => { if (MAP.placing || PROS.drawing) return; showParcel(c.id, e.layer.feature.id ?? e.layer.feature.properties.OBJECTID, e.latlng) })
      return fl
    }))
    MAP.parcels.addTo(MAP.map)
    MAP.prospectLayer = L.layerGroup().addTo(MAP.map)
    MAP.pinsLayer = L.layerGroup(); if (MAP.showPins) MAP.pinsLayer.addTo(MAP.map)
    MAP.coldLayer = L.layerGroup().addTo(MAP.map)
    MAP.propsLayer = L.layerGroup().addTo(MAP.map)
    MAP.map.on('click', e => {
      if (!MAP.placing) return
      if (MAP.map.getZoom() < 16) { toast('Zoom in until you can see the building, then click it'); MAP.map.setView(e.latlng, Math.max(MAP.map.getZoom() + 3, 16)); return }
      finishPlacing(e.latlng)
    })
    MAP.map.on('zoomend', () => paintMapHint())
  }
  const wrap = el('div', { class: 'mapwrap' }, MAP.node)
  const toggle = (label, key, fn) => el('button', { class: 'chip' + (MAP[key] ? ' on' : ''), onclick: e => { MAP[key] = !MAP[key]; e.target.classList.toggle('on'); fn() } }, label)
  wrap.append(el('div', { class: 'mapbar' },
    el('input', { class: 'search', type: 'search', placeholder: 'Filter pins… (owner, address, notes)', value: MAP.q, 'data-keep': 'mapq', oninput: e => { MAP.q = e.target.value; refreshMap() } }),
    toggle('Parcel lines', 'showParcels', () => { MAP.showParcels ? MAP.parcels.addTo(MAP.map) : MAP.parcels.remove(); paintMapHint() }),
    toggle('Prospects', 'showProspects', refreshMap),
    toggle('Cold list', 'showCold', refreshCold),
    toggle('Saved pins', 'showPins', () => { MAP.showPins ? MAP.pinsLayer.addTo(MAP.map) : MAP.pinsLayer.remove() }),
    toggle('Show dead', 'showDead', refreshMap),
    el('button', { class: 'chip' + (PROS.open ? ' on accent' : ' accent'), onclick: () => { PROS.open = !PROS.open; render() } }, 'Prospect an area'),
    el('button', { class: 'chip', onclick: () => fitAll() }, 'Fit all'),
    el('span', { class: 'chip hint', style: 'cursor:default' })))
  if (PROS.open) wrap.append(prospectPanel())
  wrap.append(el('div', { class: 'card legend' },
    el('div', null, el('span', { class: 'sw', style: 'background:var(--a)' }), 'A owner — every 2 weeks'),
    el('div', null, el('span', { class: 'sw', style: 'background:var(--b)' }), 'B owner — monthly'),
    el('div', null, el('span', { class: 'sw', style: 'background:var(--c)' }), 'C owner — quarterly'),
    el('div', null, el('span', { class: 'sw ring' }), 'Active deal (meeting → contract)'),
    el('div', null, el('span', { class: 'sw', style: 'background:#7a7f87;border-radius:3px' }), 'Saved pin (no owner yet)'),
    MAP.showCold ? el('div', null, el('span', { class: 'sw cold' }), 'Cold list — not called yet (green = owner verified)') : null))
  const unplaced = S.props.filter(p => p.lat == null && isLead(p))
  if (unplaced.length && !PROS.open) wrap.append(el('div', { class: 'card unplaced' },
    el('h4', { text: `Not on the map yet (${unplaced.length})` }),
    el('div', { class: 'muted', style: 'font-size:12px', text: LOC.busy ? 'Looking up addresses…' : 'Click one, then click its building on the map.' }),
    unplaced.map(p => el('button', { class: 'btn small', onclick: () => startPlacing(p) }, `${propTitle(p)}${contactById(p.contact_id) ? ' — ' + contactById(p.contact_id).name : ''}`))))
  if (MAP.placing) wrap.append(el('div', { class: 'placing' }, `Click the building for ${MAP.placing.address}`,
    el('button', { class: 'btn small', onclick: () => { MAP.placing = null; render() } }, 'Cancel')))
  return wrap
}
function paintMapHint() {
  const h = document.querySelector('.mapbar .hint'); if (!h || !MAP.map) return
  h.textContent = MAP.showParcels && MAP.map.getZoom() < 16 ? 'Zoom in to see parcel lines' : 'Click a parcel for owner info'
}
const ACTIVE = ['Meeting', 'BOV', 'Listing', 'Under contract']
function refreshMap() {
  if (!MAP.map || !MAP.propsLayer) return
  MAP.propsLayer.clearLayers(); MAP.pinsLayer.clearLayers()
  const q = MAP.q
  for (const p of S.props) {
    if (p.lat == null || p.lng == null) continue
    if (!isLead(p) && !MAP.showProspects) continue
    if (p.stage === 'Dead' && !MAP.showDead) continue
    const c = contactById(p.contact_id)
    if (q && !propMatches(p, q)) continue
    const cls = 'pin-' + (c ? (c.priority || 'c').toLowerCase() : 'x') + (ACTIVE.includes(p.stage) ? ' pin-active' : '') + (p.stage === 'Dead' ? ' pin-dead' : '') + (c && c.priority === 'C' && !ACTIVE.includes(p.stage) ? ' pin-cfade' : '')
    const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: cls, iconSize: [18, 18] }), title: p.address, riseOnHover: true })
    m.bindTooltip(c ? `${c.name} — ${p.address}` : p.address, { direction: 'top', offset: [0, -8] })
    m.bindPopup(() => propPopup(p), { maxWidth: 300 })
    m.addTo(MAP.propsLayer)
  }
  for (const p of S.pins) {
    if (p.contact_id && S.props.some(x => x.parcel_id && x.parcel_id === p.parcel_id)) continue
    if (q && ![p.name, p.address, p.owner_name, p.notes].join(' ').toLowerCase().includes(q.toLowerCase())) continue
    const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'pin-x', iconSize: [18, 18] }), title: p.name })
    m.bindTooltip(p.name, { direction: 'top', offset: [0, -8] })
    m.bindPopup(() => pinPopup(p), { maxWidth: 300 })
    m.addTo(MAP.pinsLayer)
  }
  paintMapHint()
}
/* Cold-list owners (Prospects tab) as small dots — only when toggled on */
async function refreshCold() {
  if (!MAP.coldLayer) return
  MAP.coldLayer.clearLayers()
  if (!MAP.showCold) { render({ soft: true }); return }
  if (!MAP.cold) {
    const rows = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('prospects').select('id, owner_name, company, property_address, city, status, ownership_check, owner_of_record, lat, lng')
        .not('lat', 'is', null).in('status', ['New', 'Attempted', 'Reached', 'Bad data']).neq('ownership_check', 'Public/institution').range(from, from + 999)
      if (error) { toast(error.message); return }
      rows.push(...data); if (data.length < 1000) break
    }
    MAP.cold = rows
  }
  const byBldg = new Map()
  for (const r of MAP.cold) { const k = r.lat.toFixed(5) + ',' + r.lng.toFixed(5); if (!byBldg.has(k)) byBldg.set(k, []); byBldg.get(k).push(r) }
  for (const rs of byBldg.values()) {
    const ok = rs.some(r => ['Owner match', 'Company match'].includes(r.ownership_check))
    const m = L.circleMarker([rs[0].lat, rs[0].lng], { radius: 6, weight: 2, color: '#fff', fillColor: ok ? '#3fb27f' : '#9aa0a8', fillOpacity: .95 })
    m.bindTooltip(`${rs[0].property_address} — ${rs.length} owner contact${rs.length > 1 ? 's' : ''}`, { direction: 'top' })
    m.bindPopup(() => el('div', { class: 'pop' },
      el('h3', { text: rs[0].property_address + (rs[0].city ? ', ' + rs[0].city : '') }),
      rs[0].owner_of_record ? el('div', { class: 'muted', style: 'font-size:12px', text: 'County owner: ' + rs[0].owner_of_record }) : null,
      el('ul', { class: 'plain' }, rs.map(r => el('li', null, el('a', { href: '#', onclick: e => { e.preventDefault(); openProspect(r.id) }, text: r.owner_name }), r.company ? el('span', { class: 'muted', text: ' · ' + r.company }) : null, ' ', ownTag(r))))), { maxWidth: 320 })
    m.addTo(MAP.coldLayer)
  }
  render({ soft: true })
}
function fitAll() {
  const pts = [...S.props.filter(p => p.lat != null && (MAP.showDead || p.stage !== 'Dead') && (MAP.showProspects || isLead(p))), ...(MAP.showPins ? S.pins : [])].map(x => [x.lat, x.lng])
  if (pts.length) MAP.map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 })
}
function propPopup(p) {
  const c = contactById(p.contact_id), tel = c && telHref(c.phone)
  return el('div', { class: 'pop' },
    el('h3', { text: propTitle(p) }),
    el('div', null, el('span', { class: 'stage-tag s' + STAGES.indexOf(p.stage), text: p.stage }), p.product_type ? ' ' + p.product_type : ''),
    el('dl', null,
      c ? [el('dt', { text: 'Owner' }), el('dd', null, el('span', { class: 'pri mini ' + (c.priority || 'C'), text: c.priority || 'C' }), ' ', c.name)] : null,
      tel ? [el('dt', { text: 'Phone' }), el('dd', null, el('a', { href: tel, text: c.phone }))] : null,
      p.building_sf ? [el('dt', { text: 'Building' }), el('dd', { text: `${num(p.building_sf)} SF${p.year_built ? ', built ' + p.year_built : ''}` })] : null,
      p.just_value ? [el('dt', { text: 'Just value' }), el('dd', { text: money(p.just_value) })] : null,
      c?.next_follow_up ? [el('dt', { text: 'Next call' }), el('dd', { text: fmt(c.next_follow_up, LONG) })] : null),
    el('div', { class: 'actions' },
      el('button', { class: 'btn small primary', onclick: () => openProperty(p.id) }, 'Property'),
      c ? el('button', { class: 'btn small', onclick: () => openContact(c.id) }, 'Owner / log call') : null,
      el('a', { class: 'btn small', href: mapsHref(addrOf(p)), target: '_blank', rel: 'noopener' }, 'Google Maps')))
}
function pinPopup(p) {
  return el('div', { class: 'pop' },
    el('h3', { text: p.name }),
    el('dl', null,
      el('dt', { text: 'Address' }), el('dd', null, p.address ? el('a', { href: mapsHref(p.address), target: '_blank', rel: 'noopener', text: p.address }) : '—'),
      el('dt', { text: 'Owner' }), el('dd', { text: p.owner_name || '—' }),
      el('dt', { text: 'Parcel' }), el('dd', { text: p.parcel_id || '—' })),
    el('div', { class: 'actions' },
      el('button', { class: 'btn small primary', onclick: () => { MAP.map.closePopup(); openPropertyForm({ address: p.address, lat: p.lat, lng: p.lng, parcel_id: p.parcel_id, owner_of_record: p.owner_name, stage: 'Prospect' }) } }, 'Add to pipeline'),
      el('button', { class: 'btn small', onclick: async () => { const { error } = await sb.from('pins').delete().eq('id', p.id); if (error) toast(error.message); else { MAP.map.closePopup(); await loadTable('pins'); refreshMap() } } }, 'Remove')))
}

/* ---------- Map prospecting ---------- */
const PROS = { open: false, drawing: false, busy: false, types: new Set(['Office', 'Medical office']), minSf: '', results: null, selected: new Set(), msg: '', rect: null }
const PROS_FIELDS = 'OBJECTID,PARCELID,PARNO,SITEADD,SCITY,SZIP,OWNNAME,MAILADD,MCITY,MSTATE,MZIP,PARUSECODE,PARUSEDESC,DORUSECODE,TOT_LVG_AREA,YRBLT_ACT,PARVAL,ASSD_TOT,SALE1_AMT,SALE1_DATE,SALE1_YEAR,ZONING,ACRES,PALINK,PAWEBPAGE,CNTYNAME'
function prospectPanel() {
  const minSf = el('input', { type: 'number', placeholder: 'Any', value: PROS.minSf, oninput: e => { PROS.minSf = e.target.value } })
  const r = PROS.results
  const inCrm = row => S.props.some(p => p.parcel_id && p.parcel_id === row.pf.parcel_id)
  const panel = el('div', { class: 'card prospect' },
    el('div', { class: 'pros-head' }, el('h4', { text: 'Prospect an area' }), el('button', { class: 'btn small ghost', onclick: () => { PROS.open = false; clearProspect(); render() } }, '✕')),
    el('div', { class: 'pros-types' }, PRODUCT_TYPES.filter(t => t !== 'Other').map(t => el('button', { class: 'chip small' + (PROS.types.has(t) ? ' on' : ''), onclick: () => { PROS.types.has(t) ? PROS.types.delete(t) : PROS.types.add(t); render() } }, t))),
    el('label', { class: 'f' }, 'Min building SF', minSf),
    el('div', { class: 'actions' },
      el('button', { class: 'btn small primary', disabled: PROS.busy, onclick: startDraw }, PROS.drawing ? 'Drag on the map…' : 'Draw a box'),
      el('button', { class: 'btn small', disabled: PROS.busy, onclick: () => runProspect(MAP.map.getBounds()) }, 'Search this view')),
    PROS.msg ? el('div', { class: 'muted pros-msg', text: PROS.msg }) : null)
  if (r && r.length) {
    const sel = r.filter(x => PROS.selected.has(x.key))
    const all = el('input', { type: 'checkbox', checked: sel.length === r.length, onchange: e => { PROS.selected = e.target.checked ? new Set(r.map(x => x.key)) : new Set(); render() } })
    panel.append(
      el('div', { class: 'pros-bar' }, el('label', { class: 'chk' }, all, `${r.length} parcels · ${new Set(r.map(x => x.pf.owner_of_record)).size} owners`)),
      el('div', { class: 'actions' },
        el('button', { class: 'btn small primary', disabled: !sel.length, onclick: () => addProspects(sel) }, `Add ${sel.length} to pipeline`),
        el('button', { class: 'btn small', onclick: () => downloadCsv(sel.length ? sel : r) }, `Call list CSV (${sel.length || r.length})`),
        el('button', { class: 'btn small ghost', onclick: () => { clearProspect(); render() } }, 'Clear')),
      el('ul', { class: 'pros-list' }, r.map(x => el('li', { class: PROS.selected.has(x.key) ? 'on' : '' },
        el('input', { type: 'checkbox', checked: PROS.selected.has(x.key), onchange: e => { e.target.checked ? PROS.selected.add(x.key) : PROS.selected.delete(x.key); render({ soft: true }) } }),
        el('div', { class: 'pr-body', onclick: () => { const c = x.center; if (c) { MAP.map.setView([c.lat, c.lng], 18); L.popup({ maxWidth: 320 }).setLatLng([c.lat, c.lng]).setContent(parcelPopup(x.f, c)).openOn(MAP.map) } } },
          el('div', { class: 'pr-addr' }, x.pf._site || '(no site address)', inCrm(x) ? el('span', { class: 'tag Buyer', text: 'In CRM' }) : null),
          el('div', { class: 'pr-owner', text: x.pf.owner_of_record || '—' }),
          el('div', { class: 'pr-sub', text: [x.pf.use_code, x.pf.building_sf ? num(x.pf.building_sf) + ' SF' : null, x.pf.year_built ? 'built ' + x.pf.year_built : null, x.pf.just_value ? moneyShort(x.pf.just_value) : null].filter(Boolean).join(' · ') }),
          x.pf.owner_mailing ? el('div', { class: 'pr-sub', text: 'Mail: ' + x.pf.owner_mailing }) : null)))))
  } else if (r) panel.append(el('div', { class: 'muted', style: 'font-size:13px;margin-top:8px', text: 'No matching parcels here. Try more property types or a bigger area.' }))
  return panel
}
function clearProspect() { PROS.results = null; PROS.selected = new Set(); PROS.msg = ''; MAP.prospectLayer?.clearLayers() }
function startDraw() {
  if (PROS.drawing) return
  PROS.drawing = true; render()
  const map = MAP.map, node = MAP.node
  map.dragging.disable(); map.boxZoom?.disable(); node.classList.add('drawing')
  let start = null, rect = null
  const down = e => { start = map.mouseEventToLatLng(e); rect = L.rectangle([start, start], { color: '#e8b04b', weight: 2, dashArray: '6 4', fillOpacity: .08 }).addTo(MAP.prospectLayer); try { node.setPointerCapture(e.pointerId) } catch { } e.preventDefault() }
  const move = e => { if (start) rect.setBounds(L.latLngBounds(start, map.mouseEventToLatLng(e))) }
  const up = e => {
    node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up)
    map.dragging.enable(); map.boxZoom?.enable(); node.classList.remove('drawing'); PROS.drawing = false
    if (!start) { render(); return }
    const b = L.latLngBounds(start, map.mouseEventToLatLng(e))
    if (b.getNorth() - b.getSouth() < 0.0003 && b.getEast() - b.getWest() < 0.0003) { rect.remove(); render(); return }
    runProspect(b, rect)
  }
  node.addEventListener('pointerdown', down); node.addEventListener('pointermove', move); node.addEventListener('pointerup', up)
}
async function runProspect(bounds, rect) {
  const h = bounds.getNorth() - bounds.getSouth(), w = bounds.getEast() - bounds.getWest()
  if (h * w > 0.0016) { PROS.msg = 'That area is too big — zoom in or draw a smaller box (about 2–3 miles across max).'; rect?.remove(); render(); return }
  if (!PROS.types.size) { PROS.msg = 'Pick at least one property type.'; render(); return }
  MAP.prospectLayer.clearLayers(); if (rect) rect.addTo(MAP.prospectLayer)
  PROS.busy = true; PROS.msg = 'Searching county parcel records…'; PROS.results = null; PROS.selected = new Set(); render()
  const env = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`
  const feats = []
  try {
    await Promise.all(COUNTY_LAYERS.map(async c => {
      for (let off = 0, page = 0; page < 8; page++, off += 1000) {
        const { features, more } = await queryLayer(c.id, { geometry: env, geometryType: 'esriGeometryEnvelope', outFields: PROS_FIELDS, maxAllowableOffset: '0.00002', resultOffset: String(off), resultRecordCount: '1000' })
        feats.push(...features)
        if (!more || !features.length) break
      }
    }))
  } catch (e) { PROS.busy = false; PROS.msg = 'Parcel search failed: ' + e.message; render(); return }
  const minSf = Number(PROS.minSf) || 0, seen = new Set(), out = []
  for (const f of feats) {
    const pf = parcelFields(f)
    if (!pf._type || !PROS.types.has(pf._type)) continue
    if (minSf && !(pf.building_sf >= minSf)) continue
    const key = pf.parcel_id || f._layer + ':' + f.attributes.OBJECTID
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, f, pf, center: parcelCenter(f) })
  }
  out.sort((a, b) => String(a.pf.owner_of_record).localeCompare(String(b.pf.owner_of_record)))
  for (const x of out) {
    const poly = L.polygon(x.f.geometry.rings.map(r => r.map(([lng, lat]) => [lat, lng])), { color: '#ff8a3d', weight: 2, fillOpacity: .18 })
    poly.bindTooltip(`${x.pf._site} — ${x.pf.owner_of_record || ''}`)
    poly.on('click', e => { L.DomEvent.stopPropagation(e); L.popup({ maxWidth: 320 }).setLatLng(e.latlng).setContent(parcelPopup(x.f, e.latlng)).openOn(MAP.map) })
    poly.addTo(MAP.prospectLayer)
  }
  PROS.busy = false
  PROS.results = out
  PROS.selected = new Set(out.filter(x => !S.props.some(p => p.parcel_id && p.parcel_id === x.pf.parcel_id)).map(x => x.key))
  PROS.msg = feats.length ? `Checked ${feats.length.toLocaleString()} parcels.` : 'No parcels found in that area (outside Sarasota, Manatee, Charlotte, Pinellas and Hillsborough?).'
  render()
}
async function addProspects(rows) {
  const fresh = rows.filter(x => !S.props.some(p => p.parcel_id && p.parcel_id === x.pf.parcel_id))
  if (!fresh.length) { toast('All selected parcels are already in your pipeline'); return }
  const payload = fresh.map(x => { const s = parcelSeed(x.f); delete s.stage_updated_at; return { ...s, stage: 'Prospect', location_note: 'Added from map prospecting', notes: null } })
  const { error } = await sb.from('properties').insert(payload)
  if (error) { toast(error.message); return }
  await loadTable('properties'); PROS.selected = new Set(); render(); toast(`${fresh.length} added to Pipeline → Prospect`)
}
function downloadCsv(rows) {
  const cols = [['Owner', x => x.pf.owner_of_record], ['Mailing address', x => x.f.attributes.MAILADD], ['Mailing city', x => x.f.attributes.MCITY], ['Mailing state', x => x.f.attributes.MSTATE], ['Mailing zip', x => x.f.attributes.MZIP],
    ['Property address', x => x.pf._site], ['Property city', x => x.pf._city], ['Property zip', x => x.pf._zip], ['County', x => x.pf.county], ['Use', x => x.pf.use_code], ['Building SF', x => x.pf.building_sf], ['Year built', x => x.pf.year_built],
    ['Value', x => x.pf.just_value], ['Last sale price', x => x.pf.last_sale_price], ['Last sale date', x => x.pf.last_sale_date], ['Zoning', x => x.pf.zoning], ['Parcel ID', x => x.pf.parcel_id], ['Appraiser link', x => x.pf.pa_link]]
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }
  const csv = [cols.map(c => c[0]).join(','), ...rows.map(x => cols.map(c => q(c[1](x))).join(','))].join('\n')
  const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `call-list-${ymd(today())}.csv` })
  document.body.append(a); a.click(); a.remove()
}

/* ---------- Parcel data ---------- */
async function queryLayer(layerId, extra) {
  const params = new URLSearchParams({ where: '1=1', outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'json', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', ...extra })
  const r = await fetch(`${PARCEL_SVC}/${layerId}/query?` + params)
  const j = await r.json()
  if (j.error) throw new Error(j.error.message)
  const county = COUNTY_LAYERS.find(c => c.id === layerId)?.name
  return { features: (j.features || []).map(f => (f._layer = layerId, f._county = county, f)), more: !!j.exceededTransferLimit }
}
async function queryAllCounties(extra) {
  const res = await Promise.allSettled(COUNTY_LAYERS.map(c => queryLayer(c.id, extra)))
  return res.flatMap(r => r.status === 'fulfilled' ? r.value.features : [])
}
const parcelsAtPoint = ll => queryAllCounties({ geometry: `${ll.lng},${ll.lat}`, geometryType: 'esriGeometryPoint' })
const parcelsNear = (ll, d = 0.0007) => queryAllCounties({ geometry: `${ll.lng - d},${ll.lat - d},${ll.lng + d},${ll.lat + d}`, geometryType: 'esriGeometryEnvelope' })
const parcelsById = async (layerId, oid) => (await queryLayer(layerId, { where: 'OBJECTID=' + Number(oid) })).features
function parcelCenter(f) {
  const ring = f.geometry?.rings?.[0]; if (!ring) return null
  let x = 0, y = 0; for (const [a, b] of ring) { x += a; y += b }
  return { lat: y / ring.length, lng: x / ring.length }
}
function dorCode(a) {
  let n = a.DORUSECODE != null ? Number(a.DORUSECODE) : parseInt(a.PARUSECODE || a.DOR4CODE, 10)
  if (isNaN(n)) return null
  if (n > 99) n = Math.floor(n / 100)
  return n
}
function saleDate(s) {
  if (!s) return null
  s = String(s)
  if (/^\d{8}$/.test(s)) return `${s.slice(4, 6)}/${s.slice(0, 4)}`
  if (/^\d{13}$/.test(s)) { const d = new Date(Number(s)); return `${pad(d.getMonth() + 1)}/${d.getFullYear()}` }
  const d = new Date(s); return isNaN(d) ? s : `${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
function parcelFields(f) {
  const a = f.attributes, code = dorCode(a), use = code != null ? dorInfo(code) : null, c = parcelCenter(f)
  const desc = a.PARUSEDESC ? String(a.PARUSEDESC).trim() : null
  return {
    parcel_id: a.PARCELID || a.PARNO || null,
    building_sf: a.TOT_LVG_AREA || null, lot_sf: a.ACRES ? Math.round(a.ACRES * 43560) : null, year_built: a.YRBLT_ACT || null,
    just_value: a.PARVAL || a.ASSD_TOT || null, last_sale_price: a.SALE1_AMT || null, last_sale_date: saleDate(a.SALE1_DATE) || (a.SALE1_YEAR ? String(a.SALE1_YEAR) : null),
    use_code: code != null ? `${pad(code)} — ${desc || use?.label || ''}`.replace(/ — $/, '') : desc, _type: use?.type || null, _dor: code,
    owner_of_record: a.OWNNAME || a.OWNERNAME || null,
    owner_mailing: [a.MAILADD || a.OWNERADD1, a.MCITY || a.OWNERCITY, a.MSTATE || a.OWNERSTATE, a.MZIP || a.OWNERZIP].filter(Boolean).join(', ') || null,
    zoning: a.ZONING || null, pa_link: a.PALINK || a.PAWEBPAGE || null, county: f._county || a.CNTYNAME || null,
    ...(c ? { lat: c.lat, lng: c.lng } : {}),
    _addr: [a.SITEADD || a.SITUSADD1, a.SCITY].filter(Boolean).join(', '), _site: a.SITEADD || a.SITUSADD1 || '', _city: a.SCITY || null, _zip: a.SZIP || null,
  }
}
const stripPrivate = o => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')))
// Pick the parcel near a point whose situs address matches the street number (and street name when possible)
function pickParcel(features, address) {
  const m = String(address || '').toUpperCase().match(/^\s*(\d+)(?:\s*-\s*\d+)?\s+([A-Z0-9]+)(?:\s+([A-Z0-9]+))?/)
  if (!m) return null
  const [, numStr, w1, w2] = m
  const dirs = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'])
  const word = dirs.has(w1) && w2 ? w2 : w1
  const site = f => String(f.attributes.SITEADD || f.attributes.SITUSADD1 || '').toUpperCase()
  const cands = features.filter(f => site(f).startsWith(numStr + ' '))
  return cands.find(f => site(f).includes(' ' + word)) || cands[0] || null
}
async function showParcel(layerId, oid, latlng) {
  const pop = L.popup({ maxWidth: 320 }).setLatLng(latlng).setContent('<div class="pop">Loading parcel…</div>').openOn(MAP.map)
  try {
    const [f] = await parcelsById(layerId, oid)
    if (!f) { pop.setContent('Parcel not found.'); return }
    pop.setContent(parcelPopup(f, latlng))
  } catch (e) { pop.setContent('Couldn’t load parcel: ' + esc(e.message)) }
}
function parcelSeed(f) {
  const pf = parcelFields(f)
  return { address: pf._site, city: pf._city, address_query: [pf._site, pf._city, 'FL', pf._zip].filter(Boolean).join(', '), ...stripPrivate(pf), product_type: pf._type, stage: 'Prospect', parcel_checked_at: nowIso() }
}
function parcelPopup(f, latlng) {
  const pf = parcelFields(f)
  const addr = [pf._site, pf._city, 'FL', pf._zip].filter(Boolean).join(', ')
  const existing = S.props.find(p => p.parcel_id && p.parcel_id === pf.parcel_id)
  return el('div', { class: 'pop' },
    el('h3', { text: pf._site || 'Parcel' }),
    el('div', { class: 'muted', text: [pf._city, pf.county && pf.county + ' County'].filter(Boolean).join(' · ') }),
    el('dl', null,
      el('dt', { text: 'Owner' }), el('dd', { text: pf.owner_of_record || '—' }),
      pf.owner_mailing ? [el('dt', { text: 'Mailing' }), el('dd', { text: pf.owner_mailing })] : null,
      el('dt', { text: 'Use' }), el('dd', { text: pf.use_code || '—' }),
      el('dt', { text: 'Zoning' }), el('dd', { text: pf.zoning || '—' }),
      el('dt', { text: 'Building' }), el('dd', { text: pf.building_sf ? `${num(pf.building_sf)} SF${pf.year_built ? ', built ' + pf.year_built : ''}` : '—' }),
      el('dt', { text: 'Lot' }), el('dd', { text: pf.lot_sf ? `${num(pf.lot_sf)} SF` : '—' }),
      el('dt', { text: 'Value' }), el('dd', { text: money(pf.just_value) }),
      el('dt', { text: 'Last sale' }), el('dd', { text: pf.last_sale_price ? `${money(pf.last_sale_price)} (${pf.last_sale_date || '?'})` : '—' }),
      el('dt', { text: 'Parcel ID' }), el('dd', { text: pf.parcel_id || '—' })),
    el('div', { class: 'actions' },
      existing ? el('button', { class: 'btn small primary', onclick: () => openProperty(existing.id) }, 'Open property') :
        el('button', { class: 'btn small primary', onclick: () => { MAP.map.closePopup(); openPropertyForm(parcelSeed(f)) } }, 'Add to pipeline'),
      existing ? null : el('button', { class: 'btn small', onclick: async e => {
        e.target.disabled = true
        const c = parcelCenter(f) || latlng
        const { error } = await sb.from('pins').insert({ name: pf._site || 'Parcel', address: addr, lat: c.lat, lng: c.lng, parcel_id: pf.parcel_id, owner_name: pf.owner_of_record, pin_type: 'prospect' })
        if (error) { toast(error.message); e.target.disabled = false } else { toast('Pin saved'); MAP.map.closePopup(); await loadTable('pins'); refreshMap() }
      } }, 'Save pin'),
      pf.pa_link ? el('a', { class: 'btn small', href: pf.pa_link, target: '_blank', rel: 'noopener' }, 'Appraiser') : null,
      el('a', { class: 'btn small', href: mapsHref(addr), target: '_blank', rel: 'noopener' }, 'Google Maps')))
}
function startPlacing(p) {
  MAP.placing = p
  closeDrawer()
  if (S.tab !== 'map') go('map'); else render()
  if (p.lat != null) requestAnimationFrame(() => MAP.map?.setView([p.lat, p.lng], 18))
}
async function finishPlacing(latlng) {
  const p = MAP.placing; MAP.placing = null
  let patch = { lat: latlng.lat, lng: latlng.lng, location_note: 'Placed by hand on map', updated_at: nowIso() }
  try {
    const [f] = await parcelsAtPoint(latlng)
    if (f) { const pf = parcelFields(f); if (!p.product_type && pf._type) patch.product_type = pf._type; patch = { ...patch, ...stripPrivate(pf), lat: latlng.lat, lng: latlng.lng, parcel_checked_at: nowIso() } }
  } catch { }
  const { error } = await sb.from('properties').update(patch).eq('id', p.id)
  if (error) toast(error.message); else { Object.assign(p, patch); toast(`${p.address} placed`) }
  render()
}

/* ---------- Locate + enrich properties (runs in the background) ---------- */
const LOC = { busy: false, tried: new Set() }
async function geocode(q) {
  const r = await fetch('/api/geocode?' + new URLSearchParams({ q }))
  if (!r.ok) return null
  const j = await r.json()
  return j.lat == null ? null : j
}
async function enrich(p) {
  // p has a rough point; find its parcel and fill in the building facts
  const patch = { parcel_checked_at: nowIso(), updated_at: nowIso() }
  try {
    const feats = await parcelsNear({ lat: p.lat, lng: p.lng })
    const f = pickParcel(feats, p.address_query || p.address) || (p.parcel_id && feats.find(x => (x.attributes.PARCELID || x.attributes.PARNO) === p.parcel_id))
    if (f) {
      const pf = parcelFields(f)
      const always = ['lat', 'lng', 'just_value', 'last_sale_price', 'last_sale_date', 'owner_of_record', 'owner_mailing', 'use_code', 'zoning', 'pa_link', 'county', 'building_sf', 'lot_sf', 'year_built', 'parcel_id']
      for (const [k, v] of Object.entries(stripPrivate(pf))) if (v != null && (p[k] == null || always.includes(k))) patch[k] = v
      if (!p.product_type && pf._type) patch.product_type = pf._type
      patch.location_note = 'Matched to parcel ' + pf.parcel_id + ' (' + pf._addr + ')'
    }
  } catch (e) { console.warn('parcel', p.id, e) }
  return patch
}
async function locateMissing() {
  if (LOC.busy) return
  const todo = S.props.filter(p => !LOC.tried.has(p.id) && (p.lat == null || !p.parcel_checked_at) && /^\s*\d/.test(p.address_query || p.address || ''))
  if (!todo.length) return
  LOC.busy = true
  for (const p of todo) {
    LOC.tried.add(p.id)
    try {
      let patch = {}
      if (p.lat == null) {
        const g = await geocode(addrOf(p))
        if (!g) continue
        patch = { lat: g.lat, lng: g.lng, location_note: `Geocoded (${g.source})${g.approximate ? ' — approximate' : ''}` }
        Object.assign(p, patch)
      }
      Object.assign(patch, await enrich(p))
      const { error } = await sb.from('properties').update(patch).eq('id', p.id)
      if (!error) Object.assign(p, patch)
    } catch (e) { console.warn('locate', p.id, e) }
    if (S.tab === 'map') refreshMap()
    await new Promise(r => setTimeout(r, 400))
  }
  LOC.busy = false
  render({ soft: true })
}

/* ---------- Drawer plumbing ---------- */
const DRAWER = { kind: null, id: null }
function closeDrawer() { DRAWER.kind = null; DRAWER.id = null; document.querySelectorAll('.scrim,.drawer').forEach(n => n.remove()) }
function showDrawer(content) {
  document.querySelectorAll('.scrim,.drawer').forEach(n => n.remove())
  const d = el('aside', { class: 'drawer' }, el('button', { class: 'btn small x', onclick: closeDrawer }, 'Close'), content)
  document.body.append(el('div', { class: 'scrim', onclick: closeDrawer }), d)
  return d
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer() })
function openContact(id) { DRAWER.kind = 'contact'; DRAWER.id = id; MAP.map?.closePopup(); refreshDrawer(true) }
function openProperty(id) { DRAWER.kind = 'property'; DRAWER.id = id; MAP.map?.closePopup(); refreshDrawer(true) }
function refreshDrawer(fresh) {
  const obj = DRAWER.kind === 'contact' ? contactById(DRAWER.id) : DRAWER.kind === 'property' ? propById(DRAWER.id) : null
  if (!obj) { if (DRAWER.kind === 'contact' || DRAWER.kind === 'property') closeDrawer(); return }
  const old = document.querySelector('.drawer')
  if (!fresh && old && [...old.querySelectorAll('textarea,input')].some(i => i.dataset.dirty)) return
  const scroll = old ? old.scrollTop : 0
  const d = showDrawer(DRAWER.kind === 'contact' ? contactDetail(obj) : propertyDetail(obj))
  if (!fresh) d.scrollTop = scroll
}
const markDirty = e => { e.target.dataset.dirty = '1' }

/* ---------- Logging calls ---------- */
async function logCall(c, { note, talked, priority, next, nextTime, nextNote, meeting, propertyId }) {
  const { error: e1 } = await sb.from('conversations').insert({ contact_id: c.id, talked_on: talked, notes: note, property_id: propertyId || null })
  if (e1) throw e1
  const patch = { priority, next_follow_up: next || null, next_time: nextTime || null, next_note: nextNote || null, updated_at: nowIso() }
  if (!c.last_contact || c.last_contact <= talked) patch.last_contact = talked
  const { error: e2 } = await sb.from('contacts').update(patch).eq('id', c.id)
  if (e2) throw e2
  // Move this owner's properties along the pipeline
  const bump = propsFor(c.id).filter(p => (propertyId && meeting ? String(p.id) === String(propertyId) && ['Prospect', 'Contacted'].includes(p.stage) : p.stage === 'Prospect' || (meeting && p.stage === 'Contacted')))
  for (const p of bump) await sb.from('properties').update({ stage: meeting ? 'Meeting' : 'Contacted', stage_updated_at: nowIso(), updated_at: nowIso() }).eq('id', p.id)
  await Promise.all([loadTable('conversations'), loadTable('contacts'), bump.length ? loadTable('properties') : null])
}
// Dial reminder shown wherever Cole makes calls
const pitchTip = () => el('div', { class: 'pitch-tip' }, el('strong', { text: 'On the call: ' }), 'say “a strategic analysis of your building,” not “BOV” or “proposal.”')
function outcomeBar(c, notesField) {
  const T = today(), pri = c.priority || 'C'
  const extra = () => notesField.value.trim()
  const run = async (btn, label, opts) => {
    btn.disabled = true
    try {
      const note = extra() ? `${label} — ${extra()}` : label
      await logCall(c, { note, talked: ymd(T), priority: opts.priority || pri, next: ymd(opts.next), nextTime: opts.nextTime, nextNote: opts.nextNote, meeting: opts.meeting, propertyId: opts.propertyId })
      toast(`${label} logged · next call ${fmt(ymd(opts.next), { weekday: 'short', month: 'short', day: 'numeric' })}`)
      render({ soft: true }); refreshDrawer(true)
    } catch (x) { toast('Couldn’t save: ' + (x.message || x)); btn.disabled = false }
  }
  const meetBox = el('div', { class: 'meetbox hidden' })
  const bar = el('div', { class: 'outcomes' },
    el('button', { class: 'oc', onclick: e => run(e.currentTarget, 'No answer', { next: addBusinessDays(T, 1), nextNote: 'Try again — no answer ' + fmt(ymd(T)) }) }, el('b', { text: 'No answer' }), el('span', { text: 'retry next business day' })),
    el('button', { class: 'oc', onclick: e => run(e.currentTarget, 'Left voicemail', { next: addBusinessDays(T, 2), nextNote: 'Follow up on voicemail from ' + fmt(ymd(T)) }) }, el('b', { text: 'Left VM' }), el('span', { text: 'follow up in 2 business days' })),
    el('button', { class: 'oc', onclick: () => { notesField.focus(); notesField.scrollIntoView({ block: 'center', behavior: 'smooth' }) } }, el('b', { text: 'Talked' }), el('span', { text: 'add notes below' })),
    el('button', { class: 'oc', onclick: e => run(e.currentTarget, 'Not interested', { priority: 'C', next: addCadence(T, 'C'), nextNote: 'Quarterly check-in — see if anything has changed' }) }, el('b', { text: 'Not interested' }), el('span', { text: 'set C, check back in 3 mo' })),
    el('button', { class: 'oc meet', onclick: () => meetBox.classList.toggle('hidden') }, el('b', { text: 'Meeting set' }), el('span', { text: 'pick the date' })))
  const mDate = el('input', { type: 'date', value: ymd(addBusinessDays(T, 2)) })
  const mTime = el('input', { type: 'time', value: '10:00' })
  const mWhere = el('input', { placeholder: 'Where (at the property, Zoom…)' })
  const mAbout = propertyPicker(c.id)
  meetBox.append(el('div', { class: 'row3' }, el('label', { class: 'f' }, 'Date', mDate), el('label', { class: 'f' }, 'Time', mTime), el('label', { class: 'f' }, 'Where', mWhere)),
    propsFor(c.id).length ? el('label', { class: 'f' }, 'Meeting is about', mAbout) : null,
    el('button', { class: 'btn primary small', onclick: e => {
      const t = mTime.value ? new Date('1970-01-01T' + mTime.value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
      const when = `${fmt(mDate.value, { weekday: 'short', month: 'short', day: 'numeric' })}${t ? ' at ' + t : ''}${mWhere.value.trim() ? ' — ' + mWhere.value.trim() : ''}`
      run(e.currentTarget, 'Meeting set for ' + when, { next: parse(mDate.value) || T, nextTime: mTime.value || null, nextNote: 'MEETING ' + when, meeting: true, propertyId: mAbout.value || null })
    } }, 'Save meeting'))
  return el('div', null, bar, meetBox)
}

// Which building a meeting is about (shown when the contact has any properties)
function propertyPicker(cid, selected) {
  const props = propsFor(cid).filter(p => p.stage !== 'Dead')
  const sel = el('select', null, el('option', { value: '', text: props.length ? '— Not about a specific building —' : '— No buildings on this contact —' }),
    props.map((p, i) => el('option', { value: p.id, text: [p.name, p.address, p.city].filter(Boolean).join(', '), selected: selected ? String(selected) === String(p.id) : i === 0 })))
  return sel
}
const propLabel = id => { const p = propById(Number(id)) || S.props.find(x => String(x.id) === String(id)); return p ? [p.name, p.address].filter(Boolean).join(' — ') : null }

/* ---------- Contact drawer ---------- */
function contactDetail(c) {
  const tel = telHref(c.phone), all = convosFor(c.id), hist = all.filter(v => !isText(v.notes)), texts = all.filter(v => isText(v.notes)), props = propsFor(c.id)
  const talked = el('input', { type: 'date', value: ymd(today()), oninput: markDirty })
  const notes = el('textarea', { rows: 4, placeholder: 'What did you talk about?', oninput: markDirty })
  const pri = el('select', null, ['A', 'B', 'C'].map(p => el('option', { value: p, text: `${p} — ${CADENCE[p].label}`, selected: (c.priority || 'C') === p })))
  const nextDate = el('input', { type: 'date', value: ymd(addCadence(today(), c.priority || 'C')), oninput: markDirty })
  const recalc = () => { nextDate.value = ymd(addCadence(parse(talked.value) || today(), pri.value)) }
  pri.addEventListener('change', recalc); talked.addEventListener('change', recalc)
  const nextStep = el('input', { type: 'text', placeholder: 'What to do on that call', oninput: markDirty })
  const nextTime = el('input', { type: 'time', oninput: markDirty })
  const logErr = el('div', { class: 'err' })
  const save = el('button', { class: 'btn primary' }, 'Save conversation')
  save.onclick = async () => {
    if (!notes.value.trim()) { logErr.textContent = 'Add a note about the conversation.'; return }
    save.disabled = true; logErr.textContent = ''
    try {
      await logCall(c, { note: notes.value.trim(), talked: talked.value, priority: pri.value, next: nextDate.value, nextTime: nextTime.value, nextNote: nextStep.value.trim() })
      toast('Conversation saved'); render({ soft: true }); refreshDrawer(true)
    } catch (x) { logErr.textContent = 'Couldn’t save: ' + (x.message || x); save.disabled = false }
  }
  return el('div', null,
    el('div', { class: 'dhead' }, el('span', { class: 'pri ' + (c.priority || 'C'), text: c.priority || 'C' }), el('h2', { text: c.name })),
    el('div', { class: 'actions', style: 'margin-top:8px' },
      c.contact_type ? el('span', { class: 'tag ' + c.contact_type, text: c.contact_type }) : null,
      el('span', { class: 'muted', style: 'font-size:13px', text: (CADENCE[c.priority] || CADENCE.C).label + ' follow-up' }),
      tel ? el('a', { class: 'btn small primary', href: tel, style: 'margin-left:auto' }, 'Call ' + c.phone) : null,
      smsHref(c.phone) ? el('a', { class: 'btn small', href: smsHref(c.phone) }, 'Text') : null),
    el('div', { class: 'nextcall' }, el('span', { class: 'muted', text: 'Next call' }), el('b', { text: fmt(c.next_follow_up, LONG) + (c.next_follow_up ? ' · ' + (c.next_time ? fmtTime(c.next_time) : 'first call block') : '') }), c.next_note ? el('div', { text: c.next_note }) : null),
    el('div', { class: 'section-title', text: 'How did the call go?' }),
    pitchTip(),
    outcomeBar(c, notes),
    el('button', { class: 'btn small primary', style: 'margin-top:10px', onclick: () => openMeetingForm({ contactId: c.id }) }, '📝 Log meeting notes'),
    milestoneBar(c),
    el('div', { class: 'section-title', text: `Properties (${props.length})` }),
    props.length ? el('div', { class: 'card' }, el('ul', { class: 'list' }, props.map(propRow))) : null,
    el('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => openPropertyForm({ contact_id: c.id, city: c.city, stage: 'Contacted' }) }, '+ Add a property'),
    coOwnersSection(c),
    S.buyers.filter(b => b.contact_id === c.id).map(buyerPropsSection),
    (() => { const mp = props.find(x => x.lat != null && x.stage !== 'Dead'); return mp ? nearbySection(mp) : null })(),
    docsSection(c, 'contacts'),
    el('dl', { class: 'facts' },
      el('dt', { text: 'Phone' }), el('dd', null, tel ? el('a', { href: tel, text: c.phone }) : '—', c.phone_note ? el('span', { class: 'muted', text: ' · ' + c.phone_note }) : null),
      c.email ? [el('dt', { text: 'Email' }), el('dd', null, el('a', { href: 'mailto:' + c.email, text: c.email }))] : null,
      c.company ? [el('dt', { text: 'Company' }), el('dd', { text: c.company })] : null,
      el('dt', { text: 'Last talked' }), el('dd', { text: fmt(c.last_contact, LONG) }),
      el('dt', { text: 'About' }), el('dd', { style: 'white-space:pre-wrap', text: c.notes || '—' })),
    (() => {
      const convBox = el('div', { class: 'stack' + (S.logMode === 'note' ? ' hidden' : '') },
        el('label', { class: 'f' }, 'Date you talked', talked),
        el('label', { class: 'f' }, 'Notes', notes),
        el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Priority', pri), el('label', { class: 'f' }, 'Next call', nextDate)),
        el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Next step', nextStep), el('label', { class: 'f' }, 'Time (blank = first call block)', nextTime)),
        logErr, el('div', { class: 'actions' }, save))
      const noteBox = noteForm(c, { hidden: S.logMode !== 'note' })
      const chipC = el('button', { class: 'chip' + (S.logMode !== 'note' ? ' on' : '') }, 'Log a conversation')
      const chipN = el('button', { class: 'chip' + (S.logMode === 'note' ? ' on' : '') }, 'Add a note (didn’t talk)')
      const pick = m => { S.logMode = m; chipC.classList.toggle('on', m !== 'note'); chipN.classList.toggle('on', m === 'note'); convBox.classList.toggle('hidden', m === 'note'); noteBox.classList.toggle('hidden', m !== 'note') }
      chipC.onclick = () => pick('conv'); chipN.onclick = () => pick('note')
      return el('div', { class: 'box stack' }, el('div', { class: 'filters', style: 'margin:0' }, chipC, chipN), convBox, noteBox)
    })(),
    textSection(c, texts),
    el('h4', { text: `Conversation history (${hist.length})` }),
    hist.length ? el('ul', { class: 'timeline' }, hist.map(v => el('li', { class: isNote(v.notes) ? 'note' : null }, el('div', { class: 'date' }, fmt(v.talked_on, LONG), isNote(v.notes) ? el('span', { class: 'notetag', text: 'Note' }) : null, v.property_id && propLabel(v.property_id) ? el('span', { class: 'notetag', text: '🏢 ' + propLabel(v.property_id) }) : null), el('div', { class: 'txt', text: isNote(v.notes) ? noteBody(v.notes) : v.notes }))))
      : el('p', { class: 'muted', text: 'No conversations logged yet.' }),
    el('div', { class: 'actions', style: 'margin-top:20px' }, el('button', { class: 'btn', onclick: () => openContactForm(c) }, 'Edit contact'),
      el('button', { class: 'btn danger', style: 'margin-left:auto', onclick: e => deleteContact(c, e.currentTarget) }, 'Delete contact')))
}

/* ---------- Texts (logged as conversations starting "Text sent:" / "Text received:") ---------- */
function textSection(c, texts) {
  const box = el('textarea', { rows: 2, placeholder: 'Paste or type the text…', oninput: markDirty })
  const day = el('input', { type: 'date', value: ymd(today()) })
  const err = el('div', { class: 'err' })
  const save = async (btn, dir) => {
    const t = box.value.trim(); if (!t) { err.textContent = 'Type the text first.'; return }
    btn.disabled = true; err.textContent = ''
    try {
      const { error } = await sb.from('conversations').insert({ contact_id: c.id, talked_on: day.value || ymd(today()), notes: `Text ${dir}: ${t}` })
      if (error) throw error
      if (dir === 'received' && (!c.last_contact || c.last_contact < day.value)) await sb.from('contacts').update({ last_contact: day.value, updated_at: nowIso() }).eq('id', c.id)
      await Promise.all([loadTable('conversations'), loadTable('contacts')])
      box.dataset.dirty = ''; toast(dir === 'sent' ? 'Text logged' : 'Reply logged'); render({ soft: true }); refreshDrawer(true)
    } catch (x) { err.textContent = 'Couldn’t save: ' + (x.message || x); btn.disabled = false }
  }
  const sms = smsHref(c.phone)
  const thread = [...texts].sort((a, b) => String(a.talked_on).localeCompare(String(b.talked_on)) || a.id - b.id)
  return el('div', { class: 'box stack texts' },
    el('h4', { text: `Texts (${texts.length})` }),
    thread.length ? el('div', { class: 'sms-thread' }, thread.map(v => {
      const inbound = /^text received/i.test(v.notes)
      return el('div', { class: 'sms ' + (inbound ? 'in' : 'out') },
        el('div', { class: 'sms-meta', text: (inbound ? (c.name.split(' ')[0]) : 'You') + ' · ' + fmt(v.talked_on, { month: 'short', day: 'numeric' }) }),
        el('div', { text: String(v.notes).replace(/^text (sent|received):\s*/i, '') }))
    })) : el('p', { class: 'muted', text: 'No texts logged yet.' }),
    box,
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary small', onclick: e => save(e.currentTarget, 'sent') }, 'Log text I sent'),
      el('button', { class: 'btn small', onclick: e => save(e.currentTarget, 'received') }, 'Log their reply'),
      sms ? el('a', { class: 'btn small ghost', href: sms, onclick: () => { if (box.value.trim()) navigator.clipboard?.writeText(box.value.trim()).catch(() => {}) } }, 'Open Messages') : null,
      el('label', { class: 'f', style: 'margin-left:auto;max-width:150px' }, 'Date', day)),
    err)
}

/* ---------- Property drawer ---------- */
function propertyDetail(p) {
  const c = contactById(p.contact_id)
  const stageSel = el('select', { class: 'stage-big', onchange: e => setStage(p, e.target.value) }, STAGES.map(s => el('option', { value: s, text: s, selected: s === p.stage })))
  const ppsf = (p.asking_price || p.est_value) && p.building_sf ? Math.round(Number(p.asking_price || p.est_value) / Number(p.building_sf)) : null
  const refresh = el('button', { class: 'btn small', onclick: async () => {
    if (p.lat == null) { toast('Place it on the map first'); return }
    refresh.disabled = true; refresh.textContent = 'Checking parcel…'
    const patch = await enrich({ ...p, parcel_checked_at: null })
    const { error } = await sb.from('properties').update(patch).eq('id', p.id)
    if (error) toast(error.message); else { Object.assign(p, patch); toast(patch.parcel_id ? 'Parcel data updated' : 'No matching parcel found — try Move pin') }
    render({ soft: true }); refreshDrawer(true)
  } }, 'Refresh parcel data')
  return el('div', null,
    el('div', { class: 'dhead' }, el('h2', { text: propTitle(p) })),
    el('div', { class: 'muted', text: [p.city, p.product_type].filter(Boolean).join(' · ') }),
    el('div', { class: 'stagebar' }, el('span', { class: 'muted', text: 'Stage' }), stageSel,
      el('span', { class: 'muted', style: 'font-size:12px', text: 'since ' + fmt(p.stage_updated_at?.slice(0, 10)) })),
    el('div', { class: 'stepper' }, STAGES.slice(0, 7).map((s, i) => el('span', { class: 'step' + (STAGES.indexOf(p.stage) >= i && p.stage !== 'Dead' ? ' done' : '') + (p.stage === s ? ' cur' : ''), title: s, onclick: () => setStage(p, s) }, s))),
    c ? el('div', { class: 'card owner', onclick: () => openContact(c.id) },
      el('span', { class: 'pri ' + (c.priority || 'C'), text: c.priority || 'C' }),
      el('div', { class: 'who' }, el('div', { class: 'name', text: c.name }), el('div', { class: 'sub', text: c.next_follow_up ? `Next call ${fmt(c.next_follow_up, LONG)}${c.next_note ? ' — ' + c.next_note : ''}` : 'No call scheduled' })),
      c.phone ? el('a', { class: 'tel', href: telHref(c.phone), onclick: e => e.stopPropagation(), text: c.phone }) : null)
      : el('p', { class: 'muted', text: 'No owner contact linked yet. Edit the property to link one.' }),
    el('dl', { class: 'facts' },
      el('dt', { text: 'Address' }), el('dd', null, el('a', { href: mapsHref(addrOf(p)), target: '_blank', rel: 'noopener', text: addrOf(p) })),
      el('dt', { text: 'Building' }), el('dd', { text: p.building_sf ? num(p.building_sf) + ' SF' : '—' }),
      el('dt', { text: 'Lot' }), el('dd', { text: p.lot_sf ? `${num(p.lot_sf)} SF (${(p.lot_sf / 43560).toFixed(2)} ac)` : '—' }),
      el('dt', { text: 'Year built' }), el('dd', { text: p.year_built || '—' }),
      el('dt', { text: 'Use' }), el('dd', { text: p.use_code || '—' }),
      el('dt', { text: 'Zoning' }), el('dd', { text: p.zoning || '—' }),
      el('dt', { text: 'Just value' }), el('dd', { text: money(p.just_value) }),
      el('dt', { text: 'Last sale' }), el('dd', { text: p.last_sale_price ? `${money(p.last_sale_price)} (${p.last_sale_date || '?'})` : '—' }),
      el('dt', { text: 'Asking' }), el('dd', { text: money(p.asking_price) }),
      el('dt', { text: 'Your value' }), el('dd', { text: p.est_value ? money(p.est_value) + (ppsf ? ` (~$${ppsf}/SF)` : '') : '—' }),
      el('dt', { text: 'Owner of record' }), el('dd', { text: p.owner_of_record || '—' }),
      p.owner_mailing ? [el('dt', { text: 'Mailing' }), el('dd', { text: p.owner_mailing })] : null,
      el('dt', { text: 'Parcel ID' }), el('dd', { text: p.parcel_id || '—' }),
      el('dt', { text: 'Notes' }), el('dd', { style: 'white-space:pre-wrap', text: p.notes || '—' })),
    p.parcel_checked_at && !p.parcel_id ? el('p', { class: 'muted', style: 'font-size:13px', text: 'Couldn’t match this address to a parcel automatically. Use “Move pin” to click the right building, and the facts fill in.' }) : null,
    buyerMatchSection(p),
    nearbySection(p),
    docsSection(p, 'properties', p.pa_link ? [{ title: 'Property appraiser record', url: p.pa_link, auto: true }] : []),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', onclick: () => openPropertyForm(p) }, 'Edit'),
      p.lat != null ? el('button', { class: 'btn', onclick: () => { closeDrawer(); go('map'); MAP.map.setView([p.lat, p.lng], 18) } }, 'Show on map') : null,
      el('button', { class: 'btn', onclick: () => startPlacing(p) }, p.lat != null ? 'Move pin' : 'Place on map'),
      refresh))
}

/* ---------- Shared drawer sections ---------- */
const NEARBY = new Map() // property id -> { status, rows, error }
const distMi = (a, b) => Math.hypot((a.lat - b.lat) * 69, (a.lng - b.lng) * 69 * Math.cos(a.lat * Math.PI / 180))
function nearbySection(p) {
  if (p.lat == null) return null
  const box = el('div', { class: 'card nearby' })
  const paint = () => {
    const st = NEARBY.get(p.id)
    if (!st || st.status === 'loading') { box.replaceChildren(el('div', { class: 'empty', text: 'Finding office & medical owners nearby…' })); return }
    if (st.status === 'error') { box.replaceChildren(el('div', { class: 'empty', text: 'Couldn’t load nearby parcels: ' + st.error })); return }
    const rows = st.rows.filter(x => !S.props.some(q => q.parcel_id && q.parcel_id === x.pf.parcel_id))
    if (!rows.length) { box.replaceChildren(el('div', { class: 'empty', text: 'No other office or medical buildings within about half a mile.' })); return }
    box.replaceChildren(el('ul', { class: 'list' }, rows.slice(0, 10).map(x => el('li', { class: 'item nb' },
      el('div', { class: 'who' },
        el('div', { class: 'name' }, x.pf._site || 'Parcel', el('span', { class: 'muted', style: 'font-weight:400;font-size:12px', text: x.dist.toFixed(2) + ' mi' })),
        el('div', { class: 'sub', text: [x.pf.owner_of_record, x.pf._type, x.pf.building_sf ? num(x.pf.building_sf) + ' SF' : null, x.pf.year_built ? 'built ' + x.pf.year_built : null].filter(Boolean).join(' · ') })),
      el('div', { class: 'nb-actions' },
        el('button', { class: 'btn small', title: 'Show on map', onclick: () => { closeDrawer(); go('map'); requestAnimationFrame(() => { MAP.map.setView([x.center.lat, x.center.lng], 18); L.popup({ maxWidth: 320 }).setLatLng([x.center.lat, x.center.lng]).setContent(parcelPopup(x.f, x.center)).openOn(MAP.map) }) } }, 'Map'),
        el('button', { class: 'btn small primary', onclick: async e => { e.target.disabled = true; await addProspects([x]); paint() } }, '+ Prospect'))))))
  }
  if (!NEARBY.has(p.id)) {
    NEARBY.set(p.id, { status: 'loading' })
    const d = 0.008, env = `${p.lng - d},${p.lat - d},${p.lng + d},${p.lat + d}`
    Promise.all(COUNTY_LAYERS.map(c => queryLayer(c.id, { geometry: env, geometryType: 'esriGeometryEnvelope', outFields: PROS_FIELDS, maxAllowableOffset: '0.00002', resultRecordCount: '1000' }).then(r => r.features).catch(() => [])))
      .then(lists => {
        const seen = new Set(), rows = []
        for (const f of lists.flat()) {
          const pf = parcelFields(f)
          if (!['Office', 'Medical office'].includes(pf._type)) continue
          if (pf.parcel_id && (seen.has(pf.parcel_id) || pf.parcel_id === p.parcel_id)) continue
          seen.add(pf.parcel_id)
          const center = parcelCenter(f); if (!center) continue
          const dist = distMi(p, center); if (dist > 0.5 || dist < 0.005) continue
          rows.push({ key: pf.parcel_id || f._layer + ':' + f.attributes.OBJECTID, f, pf, center, dist })
        }
        rows.sort((a, b) => a.dist - b.dist)
        NEARBY.set(p.id, { status: 'ok', rows })
      })
      .catch(e => NEARBY.set(p.id, { status: 'error', error: e.message }))
      .finally(() => { if (box.isConnected) paint() })
  }
  paint()
  return el('div', null, el('div', { class: 'section-title', text: 'Nearby office & medical owners' }), box)
}
function buyerMatchSection(p) {
  const ms = matchesForProp(p)
  return el('div', null,
    el('div', { class: 'section-title', text: `Buyer matches (${ms.length})` }),
    ms.length ? el('div', { class: 'card' }, el('ul', { class: 'list' }, ms.map(({ b, m }) => {
      const c = contactById(b.contact_id)
      return el('li', { class: 'item', onclick: () => c ? openContact(c.id) : openBuyerForm(b) },
        el('span', { class: 'match-dot ' + m.level }),
        el('div', { class: 'who' },
          el('div', { class: 'name' }, b.name, el('span', { class: 'muted', style: 'font-weight:400;font-size:12px', text: m.level === 'match' ? 'fits' : 'possible fit' }), /^ON HOLD/i.test(b.notes || '') ? el('span', { class: 'tag', text: 'On hold — don’t pitch yet' }) : null),
          el('div', { class: 'sub', text: [buyerCriteria(b), m.unknown.length ? 'unknown: ' + m.unknown.join(', ') : null].filter(Boolean).join(' · ') })),
        (c?.phone || b.phone) ? el('a', { class: 'tel', href: telHref(c?.phone || b.phone), onclick: e => e.stopPropagation(), text: c?.phone || b.phone }) : null)
    }))) : el('p', { class: 'muted', style: 'font-size:13px;margin:0', text: 'No buyer on your list fits this one yet.' }))
}
const buyerCriteria = b => [(b.markets || []).join('/'), (b.product_types || []).join('/'), sfRange(b), priceRange(b)].filter(Boolean).join(' · ')
function buyerPropsSection(b) {
  const ms = matchesForBuyer(b)
  return el('div', null,
    el('div', { class: 'section-title', text: `Properties that fit ${b.name.split(' ')[0]} (${ms.length})` }),
    ms.length ? el('div', { class: 'card' }, el('ul', { class: 'list' }, ms.map(({ p, m }) => {
      const li = propRow(p)
      li.querySelector('.name')?.prepend(el('span', { class: 'match-dot ' + m.level, title: m.level === 'match' ? 'fits' : 'possible fit — unknown ' + m.unknown.join(', ') }))
      return li
    }))) : el('p', { class: 'muted', style: 'font-size:13px;margin:0', text: 'Nothing in your pipeline fits these criteria yet.' }))
}
function docsSection(obj, table, extras = []) {
  const docs = [...extras, ...(Array.isArray(obj.documents) ? obj.documents : [])]
  const title = el('input', { placeholder: 'Title (e.g. BOV, rent roll)', oninput: markDirty })
  const url = el('input', { type: 'url', placeholder: 'Paste a link (Drive, Docs, Dropbox…)', oninput: markDirty })
  const save = async list => {
    const { error } = await sb.from(table).update({ documents: list, updated_at: nowIso() }).eq('id', obj.id)
    if (error) { toast(error.message); return }
    obj.documents = list; await loadTable(table); refreshDrawer(true)
  }
  const add = el('button', { class: 'btn small', onclick: async () => {
    let u = url.value.trim(); if (!u) { url.focus(); return }
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u
    let t = title.value.trim()
    if (!t) { try { const h = new URL(u).hostname; t = /docs\.google/.test(h) ? 'Google Doc' : /drive\.google/.test(h) ? 'Drive folder' : h.replace(/^www\./, '') } catch { t = 'Link' } }
    await save([...(obj.documents || []), { title: t, url: u, added: ymd(today()) }]); toast('Document added')
  } }, 'Add link')
  return el('div', null,
    el('div', { class: 'section-title', text: `Documents (${docs.length})` }),
    docs.length ? el('ul', { class: 'docs' }, docs.map((d, i) => el('li', null,
      el('span', { class: 'doc-ic', text: /drive\.google\.com\/drive\/folders/.test(d.url) ? '📁' : /docs\.google/.test(d.url) ? '📄' : '🔗' }),
      el('a', { href: d.url, target: '_blank', rel: 'noopener', text: d.title || d.url }),
      d.added ? el('span', { class: 'muted', text: fmt(d.added) }) : null,
      d.auto ? null : el('button', { class: 'btn small ghost', title: 'Remove', onclick: () => save((obj.documents || []).filter((_, j) => j !== i - extras.length)) }, '✕')))) : null,
    el('div', { class: 'doc-add' }, title, url, add))
}

/* ---------- Forms ---------- */
function contactSelect(selected) {
  return el('select', null, el('option', { value: '', text: '— No owner linked —' }),
    [...S.contacts].sort((a, b) => a.name.localeCompare(b.name)).map(c => el('option', { value: c.id, text: c.name, selected: selected === c.id })))
}
function openPropertyForm(p = {}) {
  const editing = !!p.id
  const v = k => p[k] ?? ''
  const f = {
    name: el('input', { value: v('name'), placeholder: 'Optional, e.g. Old Bank of America' }),
    address: el('input', { required: true, value: v('address'), placeholder: '2121 Cornell St' }),
    city: el('input', { value: v('city'), placeholder: 'Sarasota' }),
    contact_id: contactSelect(p.contact_id),
    stage: el('select', null, STAGES.map(s => el('option', { value: s, text: s, selected: (p.stage || 'Prospect') === s }))),
    product_type: el('select', null, el('option', { value: '', text: '—' }), PRODUCT_TYPES.map(t => el('option', { value: t, text: t, selected: p.product_type === t || p._type === t }))),
    building_sf: el('input', { type: 'number', value: v('building_sf') }), year_built: el('input', { type: 'number', value: v('year_built') }),
    asking_price: el('input', { type: 'number', value: v('asking_price') }), est_value: el('input', { type: 'number', value: v('est_value') }),
    notes: el('textarea', { rows: 4, text: v('notes') }),
  }
  const err = el('div', { class: 'err' }), save = el('button', { class: 'btn primary', type: 'submit' }, editing ? 'Save property' : 'Add property')
  const n = s => s === '' ? null : Number(s)
  const form = el('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault(); save.disabled = true; err.textContent = ''
    const addr = f.address.value.trim(), city = f.city.value.trim()
    const row = {
      name: f.name.value.trim() || null, address: addr, city: city || null, contact_id: f.contact_id.value || null,
      product_type: f.product_type.value || null, building_sf: n(f.building_sf.value), year_built: n(f.year_built.value),
      asking_price: n(f.asking_price.value), est_value: n(f.est_value.value), notes: f.notes.value.trim() || null, updated_at: nowIso(),
    }
    const addrChanged = !editing || addr !== (p.address || '') || city !== (p.city || '')
    if (addrChanged) row.address_query = p.address_query && !editing ? p.address_query : (/,/.test(addr) ? addr : [addr, city, 'FL'].filter(Boolean).join(', '))
    if (!editing || f.stage.value !== p.stage) { row.stage = f.stage.value; row.stage_updated_at = nowIso() }
    try {
      if (editing) {
        if (addrChanged) Object.assign(row, { lat: null, lng: null, parcel_id: null, parcel_checked_at: null })
        const { error } = await sb.from('properties').update(row).eq('id', p.id); if (error) throw error
        LOC.tried.delete(p.id)
      } else {
        for (const k of ['lat', 'lng', 'parcel_id', 'lot_sf', 'just_value', 'last_sale_price', 'last_sale_date', 'use_code', 'owner_of_record', 'owner_mailing', 'parcel_checked_at', 'location_note']) if (p[k] != null) row[k] = p[k]
        const { data, error } = await sb.from('properties').insert(row).select('id').single(); if (error) throw error
        p = { id: data.id }
      }
      await loadTable('properties'); render({ soft: true }); openProperty(p.id); locateMissing()
      toast(editing ? 'Saved' : 'Property added')
    } catch (x) { err.textContent = x.message || String(x); save.disabled = false }
  } },
    el('h2', { text: editing ? 'Edit property' : 'New property' }),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Address', f.address), el('label', { class: 'f' }, 'City', f.city)),
    el('label', { class: 'f' }, 'Name', f.name),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Owner contact', f.contact_id), el('label', { class: 'f' }, 'Stage', f.stage)),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Product type', f.product_type), el('label', { class: 'f' }, 'Building SF', f.building_sf)),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Asking price', f.asking_price), el('label', { class: 'f' }, 'Your value (BOV)', f.est_value)),
    el('label', { class: 'f' }, 'Year built', f.year_built),
    el('label', { class: 'f' }, 'Notes', f.notes),
    el('div', { class: 'muted', style: 'font-size:12px', text: 'Building size, lot, year, value and last sale fill in automatically from county parcel data once it’s on the map.' }),
    err, el('div', { class: 'actions' }, save, el('button', { class: 'btn', type: 'button', onclick: () => editing ? openProperty(p.id) : closeDrawer() }, 'Cancel')))
  DRAWER.kind = null
  showDrawer(form)
}
/* Permanently delete a contact with their logged conversations and linked properties */
async function deleteContact(c, btn) {
  const nConv = convosFor(c.id).length, nProp = propsFor(c.id).length
  const extra = [nConv ? `${nConv} conversation${nConv > 1 ? 's' : ''}` : '', nProp ? `${nProp} propert${nProp > 1 ? 'ies' : 'y'}` : ''].filter(Boolean).join(' and ')
  if (!confirm(`Delete ${c.name}${extra ? ' and their ' + extra : ''}? This can't be undone.`)) return
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…' }
  for (const t of ['conversations', 'properties']) {
    const { error } = await sb.from(t).delete().eq('contact_id', c.id)
    if (error) { toast(error.message); if (btn) { btn.disabled = false; btn.textContent = 'Delete contact' } return }
  }
  const { error } = await sb.from('contacts').delete().eq('id', c.id)
  if (error) { toast(error.message); if (btn) { btn.disabled = false; btn.textContent = 'Delete contact' } return }
  S.contacts = S.contacts.filter(x => x.id !== c.id)
  S.convos && (S.convos = S.convos.filter(x => x.contact_id !== c.id))
  S.props && (S.props = S.props.filter(x => x.contact_id !== c.id))
  closeDrawer(); toast(`${c.name} deleted`); loadAll().then(() => render({ soft: true })).catch(() => render({ soft: true }))
}
function openContactForm(c = {}) {
  const editing = !!c.id
  const v = k => c[k] ?? ''
  const f = {
    name: el('input', { required: true, value: v('name') }),
    company: el('input', { value: v('company') }),
    phone: el('input', { type: 'tel', value: v('phone') }),
    email: el('input', { type: 'email', value: v('email') }),
    priority: el('select', null, ['A', 'B', 'C'].map(p => el('option', { value: p, text: `${p} — ${CADENCE[p].label}`, selected: (c.priority || 'C') === p }))),
    contact_type: el('select', null, TYPES.map(t => el('option', { value: t, text: t, selected: (c.contact_type || 'Seller') === t }))),
    address: el('input', { value: v('address'), placeholder: '2121 Cornell St' }),
    city: el('input', { value: v('city'), placeholder: 'Sarasota' }),
    next_follow_up: el('input', { type: 'date', value: v('next_follow_up') }),
    next_time: el('input', { type: 'time', value: v('next_time') }),
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
      const aq = addr ? (/,/.test(addr) ? addr : [addr, city, 'FL'].filter(Boolean).join(', ')) : null
      const row = {
        name: f.name.value.trim(), company: f.company.value.trim() || null, phone: f.phone.value.trim() || null, email: f.email.value.trim() || null,
        priority: f.priority.value, contact_type: f.contact_type.value, address: addr || null, city: city || null, address_query: aq,
        next_follow_up: f.next_follow_up.value || null, next_time: f.next_time.value || null, next_note: f.next_note.value.trim() || null, notes: f.notes.value.trim() || null, updated_at: nowIso(),
      }
      let id = c.id
      if (editing) {
        const { error } = await sb.from('contacts').update(row).eq('id', c.id); if (error) throw error
      } else {
        id = slug(row.name); let n = 2
        while (contactById(id)) id = slug(row.name) + '-' + n++
        row.id = id
        if (!row.next_follow_up) row.next_follow_up = ymd(addCadence(today(), row.priority))
        if (f.first.value.trim()) row.last_contact = ymd(today())
        const { error } = await sb.from('contacts').insert(row); if (error) throw error
        if (f.first.value.trim()) { const { error: e2 } = await sb.from('conversations').insert({ contact_id: id, talked_on: ymd(today()), notes: f.first.value.trim() }); if (e2) throw e2 }
      }
      // Make sure the main property exists as its own record
      if (addr && !S.props.some(p => p.contact_id === id && p.address.toLowerCase() === addr.toLowerCase())) {
        const seed = c.seedProperty || {}
        await sb.from('properties').insert({ ...seed, contact_id: id, address: addr, city: city || null, address_query: aq, stage: f.first.value.trim() || editing ? 'Contacted' : 'Prospect' })
      }
      await Promise.all([loadTable('contacts'), loadTable('conversations'), loadTable('properties')])
      render({ soft: true }); openContact(id); locateMissing()
      toast(editing ? 'Saved' : 'Contact added')
    } catch (x) { err.textContent = x.message || String(x); save.disabled = false }
  } },
    el('h2', { text: editing ? 'Edit contact' : 'New contact' }),
    el('label', { class: 'f' }, 'Name', f.name),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Phone', f.phone), el('label', { class: 'f' }, 'Email', f.email)),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Priority', f.priority), el('label', { class: 'f' }, 'Type', f.contact_type)),
    el('label', { class: 'f' }, 'Company / entity', f.company),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Main property address', f.address), el('label', { class: 'f' }, 'City', f.city)),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Next follow-up', f.next_follow_up), el('label', { class: 'f' }, 'Time (optional)', f.next_time)),
    el('label', { class: 'f' }, 'Next step', f.next_note),
    el('label', { class: 'f' }, 'About this contact', f.notes),
    editing ? null : el('label', { class: 'f' }, 'Notes from this first conversation', f.first),
    el('div', { class: 'muted', style: 'font-size:12px', text: editing ? 'Add more buildings from the contact’s Properties section.' : 'Leave the follow-up date blank to set it by priority. The property is added to your pipeline and placed on the map automatically.' }),
    err, el('div', { class: 'actions' }, save, el('button', { class: 'btn', type: 'button', onclick: () => editing ? openContact(c.id) : closeDrawer() }, 'Cancel')))
  DRAWER.kind = null
  showDrawer(form)
  f.name.focus()
}

/* ---------- Buyers ---------- */
const B = { q: '', results: null, busy: false }
function buyersView() {
  const search = el('input', { class: 'search', type: 'search', placeholder: 'Try “sarasota office buyer” or “medical”', value: B.q, 'data-keep': 'bq',
    oninput: e => { B.q = e.target.value }, onkeydown: e => { if (e.key === 'Enter') runSearch() } })
  async function runSearch() {
    const q = B.q.trim()
    if (!q) { B.results = null; render({ soft: true }); return }
    B.busy = true; render({ soft: true })
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
          const b = S.buyers.find(b => String(b.id) === String(r.ref))
          const c = contactById(r.ref) || S.contacts.find(x => x.name === r.name) || (b && contactById(b.contact_id))
          if (c) openContact(c.id); else if (b) openBuyerForm(b)
        } },
          el('span', { class: 'tag', text: r.kind }),
          el('div', { class: 'who' }, el('div', { class: 'name', text: r.name }), el('div', { class: 'sub', text: r.summary || '' })))))
          : el('div', { class: 'empty', text: 'No matches.' }))) : null,
    el('div', { class: 'section-title', text: 'All buyers' }),
    el('div', { class: 'card' }, list.length ? el('ul', { class: 'list' }, list.map(b => { const mc = matchesForBuyer(b).length; return el('li', { class: 'item', onclick: () => openBuyerForm(b) },
      el('div', { class: 'who' },
        el('div', { class: 'name' }, b.name, b.in_1031 ? el('span', { class: 'tag Buyer', text: '1031' }) : null, mc ? el('span', { class: 'match-badge', text: `${mc} propert${mc > 1 ? 'ies' : 'y'} fit` }) : null),
        el('div', { class: 'sub', text: buyerCriteria(b) || 'No criteria yet' })),
      b.phone ? el('a', { class: 'tel', href: telHref(b.phone), onclick: e => e.stopPropagation(), text: b.phone }) : null) }))
      : el('div', { class: 'empty', text: 'No buyers yet.' })))
}
const sfRange = b => b.min_sf || b.max_sf ? `${b.min_sf ? num(b.min_sf) : '?'}–${b.max_sf ? num(b.max_sf) : '?'} SF` : ''
const priceRange = b => b.min_price || b.max_price ? `${money(b.min_price)}–${money(b.max_price)}` : ''
function openBuyerForm(b = {}) {
  const editing = !!b.id
  const csv = a => (a || []).join(', ')
  const f = {
    contact_id: contactSelect(b.contact_id),
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
  const n = s => s === '' ? null : Number(s)
  const err = el('div', { class: 'err' }), save = el('button', { class: 'btn primary', type: 'submit' }, editing ? 'Save buyer' : 'Add buyer')
  const form = el('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault(); save.disabled = true; err.textContent = ''
    const row = { contact_id: f.contact_id.value || null, name: f.name.value.trim(), company: f.company.value.trim() || null, phone: f.phone.value.trim() || null, email: f.email.value.trim() || null,
      markets: list(f.markets.value), product_types: list(f.product_types.value), min_sf: n(f.min_sf.value), max_sf: n(f.max_sf.value),
      min_price: n(f.min_price.value), max_price: n(f.max_price.value), in_1031: f.in_1031.checked, exchange_deadline: f.exchange_deadline.value || null,
      notes: f.notes.value.trim() || null, updated_at: nowIso() }
    const { error } = editing ? await sb.from('buyers').update(row).eq('id', b.id) : await sb.from('buyers').insert(row)
    if (error) { err.textContent = error.message; save.disabled = false; return }
    await loadTable('buyers'); closeDrawer(); render({ soft: true }); toast('Buyer saved')
  } },
    el('h2', { text: editing ? 'Edit buyer' : 'New buyer' }),
    editing ? buyerPropsSection(b) : null,
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
  DRAWER.kind = null
  showDrawer(form)
}

/* ---------- Prospects (owners not yet talked to) ---------- */
const P = { county: localStorage.getItem('pCounty') || '', status: 'tocall', own: 'nopublic', q: '', page: 0, rows: [], total: 0, counts: [], loading: false, loaded: false, reqId: 0 }
const P_PAGE = 50
const P_STATUS = { tocall: ['New', 'Attempted'], never: ['New', 'Attempted'], today: null, later: ['Attempted'], reached: ['Reached'], bad: ['Bad data'], ni: ['Not interested'], dnc: ['Do not call'], converted: ['Converted'], all: null }
const P_STATUS_LABEL = { tocall: 'To call', never: 'Haven’t called', ownervm: 'Good # (left VM)', today: 'Called today', later: 'Callback scheduled', reached: 'Reached', bad: 'Needs skip trace', ni: 'Not interested', dnc: 'Do not call', converted: 'Converted', all: 'All' }
const PHONE_BAD = ['Wrong number', 'Disconnected', 'Do not call']
const P_OWN = { nopublic: ['Skip public/institutional', null], verified: ['Owner verified', null], unverified: ['Owner not verified yet', null], public: ['Public/institutional', null], all: ['Everyone', null] }
const OWN_TAG = { 'Owner match': ['✓ owner', 'own-ok', 'County records list this person (or their family) as owner'], 'Company match': ['✓ company', 'own-ok', 'County records list their company as owner'], 'Different owner': ['owner differs', 'own-q', 'County records show a different owner name — confirm on the call'], 'Public/institution': ['public owner', 'own-x', 'Owned by a government, hospital, school or similar'], 'Not checked': ['not checked', 'own-q', 'Could not match this parcel in county records'], 'Not found': ['owner not found', 'own-q', 'Parcel not in county data — likely an office condo'], 'Out of market': ['out of market', 'own-x', 'Outside Florida'] }
const ownTag = r => { const t = OWN_TAG[r.ownership_check]; return t ? el('span', { class: 'otag ' + t[1], title: t[2], text: t[0] }) : null }
// How each person on a building checks out against the LLC (Sunbiz) and county records
const VERIFY_TAG = { 'LLC manager': ['✓ on the LLC', 'own-ok', 'Listed as a manager/officer of the owning entity on Sunbiz'], 'County owner': ['✓ county owner', 'own-ok', 'Named as owner in county property records'], 'Unverified': ['not verified', 'own-q', 'Not yet matched to the LLC or county records'], 'Not on LLC/county': ['not on LLC or county', 'own-x', 'Not on the LLC or in county records'] }
const verifyTag = v => { const t = VERIFY_TAG[v || 'Unverified']; return t ? el('span', { class: 'otag ' + t[1], title: t[2], text: t[0] }) : null }
const phoneRank = s => ({ Good: 0, 'Owner VM': 0, Untested: 1, 'No answer': 2, Voicemail: 2, 'Wrong number': 8, Disconnected: 8, 'Do not call': 9 }[s] ?? 5)
const fmtPhone = v => { const d = String(v).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v).trim() }
const bTitle = b => b.property_name || b.address || 'Unknown address'
const bStatus = b => b.any_converted ? 'Converted' : b.callable > 0 ? (b.attempts ? 'Attempted' : 'New') : b.any_reached ? 'Reached' : b.any_ni ? 'Not interested' : b.any_dnc ? 'Do not call' : 'Bad data'
// Same key the database uses to group people into buildings
const bkeyOf = (addr, city) => String(addr || '').replace(/[.,#]/g, '').replace(/\s+/g, ' ').trim().toUpperCase() + '|' + String(city || '').trim().toUpperCase()

/* The prospect list is one card per BUILDING; every owner/manager hangs off it with their own numbers */
function applyBuildingFilters(q) {
  if (P.county) q = P.county === 'Unknown' ? q.is('county', null) : q.eq('county', P.county)
  q = q.gt('n_people', 0)
  if (P.own === 'nopublic') q = q.neq('best_rank', 4)
  else if (P.own === 'verified') q = q.eq('has_verified', true)
  else if (P.own === 'unverified') q = q.or('has_verified.is.null,has_verified.eq.false')
  else if (P.own === 'public') q = q.eq('best_rank', 4)
  return q
}
async function loadProspectCounts() {
  const { data, error } = await sb.rpc('prospect_building_county_counts')
  if (!error) P.counts = data || []
  // Buildings where nobody has been dialed yet — shown on the "Haven't called" tab
  let nq = sb.from('prospect_building_list').select('id', { count: 'exact', head: true }).gt('callable', 0).eq('attempts', 0).neq('best_rank', 4)
  if (P.county) nq = P.county === 'Unknown' ? nq.is('county', null) : nq.eq('county', P.county)
  const { count } = await nq
  P.neverCount = count ?? null
}
async function loadProspects() {
  const my = ++P.reqId
  P.loading = true
  let q = sb.from('prospect_building_list').select('*', { count: 'exact' })
  const pd = phoneQuery(P.q.trim())
  const term = P.q.trim().replace(/[%,()*]/g, ' ').trim().toLowerCase()
  const T0 = ymd(today())
  if (pd) q = q.gt('n_people', 0).like('digits', `%${pd}%`) // a phone search looks across every building, ignoring tabs and filters
  else {
    q = applyBuildingFilters(q)
    if (P.status === 'tocall') q = q.gt('callable', 0).lte('next_due', T0)
    else if (P.status === 'never') q = q.gt('callable', 0).eq('attempts', 0)
    else if (P.status === 'ownervm') q = q.eq('has_owner_vm', true)
    else if (P.status === 'later') q = q.gt('callable', 0).gt('next_due', T0)
    else if (P.status === 'today') { const m = new Date(); m.setHours(0, 0, 0, 0); q = q.gte('last_attempt_at', m.toISOString()) }
    else if (P.status === 'reached') q = q.eq('any_reached', true)
    else if (P.status === 'ni') q = q.eq('any_ni', true)
    else if (P.status === 'dnc') q = q.eq('any_dnc', true)
    else if (P.status === 'converted') q = q.eq('any_converted', true)
    else if (P.status === 'bad') q = q.eq('callable', 0).eq('all_bad', true)
    if (term) q = q.ilike('search_text', `%${term}%`)
  }
  if (P.status === 'tocall') q = q.order('callback_on', { ascending: true, nullsFirst: false }).order('next_due').order('attempts').order('best_rank').order('address')
  else if (P.status === 'later' || P.status === 'ownervm') q = q.order('next_due').order('address')
  else if (P.status === 'never') q = q.order('best_rank').order('address')
  else if (P.status === 'today') q = q.order('last_attempt_at', { ascending: false })
  else q = q.order('updated_at', { ascending: false })
  q = q.range(P.page * P_PAGE, P.page * P_PAGE + P_PAGE - 1)
  const { data, error, count } = await q
  if (my !== P.reqId) return
  P.loading = false; P.loaded = true
  if (error) { toast(error.message); return }
  P.rows = data || []; P.total = count || 0
}
async function refreshProspects() { MAP.cold = null; await Promise.all([loadProspects(), loadProspectCounts()]); if (S.tab === 'prospects') render({ soft: true }) }

function prospectsView() {
  if (!P.loaded && !P.loading) refreshProspects()
  const totalAll = P.counts.reduce((s, c) => s + Number(c.total), 0)
  const toCallAll = P.counts.reduce((s, c) => s + Number(c.to_call), 0)
  const T = ymd(today())
  const search = el('input', { class: 'search', type: 'search', placeholder: 'Search address, owner, LLC, city, phone…', value: P.q, 'data-keep': 'pq2',
    oninput: e => { P.q = e.target.value; clearTimeout(P.searchTimer); P.searchTimer = setTimeout(() => { P.page = 0; refreshProspects() }, 300) } })
  const pages = Math.max(1, Math.ceil(P.total / P_PAGE))
  return el('div', null,
    el('div', { class: 'head' },
      el('div', null, el('h1', { text: 'Prospects' }), el('p', { class: 'muted', text: totalAll ? `${totalAll.toLocaleString()} buildings · ${toCallAll.toLocaleString()} with owners still to call` : 'Buildings whose owners you haven’t talked to yet' })),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: exportSkipTrace }, 'Skip-trace list'),
        el('button', { class: 'btn', onclick: () => openProspectForm() }, '+ Prospect'),
        el('button', { class: 'btn primary', onclick: openImport }, 'Import CSV'))),
    el('div', { class: 'filters county-chips' },
      el('button', { class: 'chip' + (!P.county ? ' on' : ''), onclick: () => setPF({ county: '' }) }, `All counties${toCallAll ? ' · ' + toCallAll.toLocaleString() : ''}`),
      P.counts.map(c => el('button', { class: 'chip' + (P.county === c.county ? ' on' : ''), onclick: () => setPF({ county: c.county }) }, `${c.county} · ${Number(c.to_call).toLocaleString()}`))),
    el('div', { class: 'filters status-tabs' }, Object.entries(P_STATUS_LABEL).map(([k, v]) => el('button', { class: 'chip' + (P.status === k ? ' on' : ''), onclick: () => setPF({ status: k }) }, k === 'tocall' ? 'To call (due first)' : k === 'never' && P.neverCount != null ? `${v} · ${P.neverCount.toLocaleString()}` : v))),
    el('div', { class: 'filters' }, search,
      el('select', { class: 'chip', title: 'Checked against the LLC (Sunbiz) and county property records', onchange: e => setPF({ own: e.target.value }) }, Object.entries(P_OWN).map(([k, v]) => el('option', { value: k, text: v[0], selected: P.own === k })))),
    (() => {
      const d = phoneQuery(P.q.trim()); if (!d) return null
      const cs = S.contacts.filter(c => digitsOf(c.phone).includes(d) || digitsOf(c.phone_note).includes(d))
      return cs.length ? [el('div', { class: 'section-title', text: `In your contacts (${cs.length})` }), el('div', { class: 'card', style: 'margin-bottom:10px' }, el('ul', { class: 'list' }, cs.map(c => contactRow(c))))] : null
    })(),
    !totalAll && P.loaded ? el('div', { class: 'card empty-state' },
      el('h3', { text: 'No prospects yet' }),
      el('p', { class: 'muted', text: 'Import a CSV of owners (name, property address, county, and any phone columns). Excel files: File → Save As → CSV. Or send the file to Claude and it will load it for you.' }),
      el('button', { class: 'btn primary', onclick: openImport }, 'Import CSV')) :
    el('div', { class: 'card' },
      P.loading && !P.rows.length ? el('div', { class: 'empty', text: 'Loading…' }) :
      P.rows.length ? el('ul', { class: 'list' }, P.rows.map(b => {
        const due = b.next_due && b.next_due <= T
        const fuDue = b.callback_on && b.callback_on <= T
        const st = bStatus(b)
        return el('li', { class: 'item', onclick: () => openBuilding(b.id) },
          b.priority ? el('span', { class: 'pri ' + b.priority, text: b.priority }) : el('span', { class: 'pstat ' + slug(st), title: st }),
          el('div', { class: 'who' },
            el('div', { class: 'name' }, bTitle(b), b.city ? el('span', { class: 'muted', style: 'font-weight:400', text: b.city }) : null,
              b.n_people > 1 ? el('span', { class: 'tag', text: `${b.n_people} owners` }) : null,
              b.has_verified ? el('span', { class: 'otag own-ok', text: '✓ verified' }) : null,
              b.has_owner_vm ? el('span', { class: 'otag own-ok', title: 'You left a voicemail and confirmed this is the owner’s number', text: '✓ owner VM' }) : null,
              b.any_converted ? el('span', { class: 'tag', text: 'contact' }) : null,
              b.attempts ? el('span', { class: 'tag', text: `${b.attempts} attempt${b.attempts > 1 ? 's' : ''}` }) : null,
              b.callback_note ? el('span', { class: fuDue ? 'late' : 'tag fu', text: `📅 ${fuDue ? 'follow-up due' : 'follow-up ' + fmt(b.callback_on, { weekday: 'short', month: 'short', day: 'numeric' })}${b.callback_time ? ' · ' + fmtTime(b.callback_time) : ''}` })
              : due && b.attempts ? el('span', { class: 'late', text: 'callback due' }) : null),
            el('div', { class: 'sub', text: [b.callback_note ? '→ ' + b.callback_note : null, b.names, b.owner_of_record && !String(b.names || '').toUpperCase().includes(String(b.owner_of_record).toUpperCase()) ? b.owner_of_record : null, b.building_sf ? num(b.building_sf) + ' SF' : b.product_type, `${b.live_phones}/${b.all_phones} numbers live`].filter(Boolean).join(' · ') })))
      })) : el('div', { class: 'empty', text: !P.loaded ? 'Loading…' : phoneQuery(P.q.trim()) ? `No prospect has a number containing ${phoneQuery(P.q.trim())}${S.contacts.some(c => digitsOf(c.phone).includes(phoneQuery(P.q.trim()))) ? ' — it’s on a contact above.' : '.'}` : 'No buildings match.' })),
    P.total > P_PAGE ? el('div', { class: 'pager' },
      el('button', { class: 'btn small', disabled: P.page === 0, onclick: () => { P.page--; refreshProspects() } }, '‹ Prev'),
      el('span', { class: 'muted', text: `Page ${P.page + 1} of ${pages} · ${P.total.toLocaleString()} buildings` }),
      el('button', { class: 'btn small', disabled: P.page + 1 >= pages, onclick: () => { P.page++; refreshProspects() } }, 'Next ›')) : null)
}
function setPF(patch) { Object.assign(P, patch, { page: 0 }); try { localStorage.setItem('pCounty', P.county) } catch { } P.rows = []; P.loading = true; render({ soft: true }); refreshProspects() }

/* Building drawer */
// Buildings you've opened, in order — "Previous" walks back through them even after the list re-sorts
const PHIST = []
const BCTX = { id: null, b: null, showRemoved: false }
function prevBuildingId(id) {
  const i = PHIST.lastIndexOf(id)
  if (i > 0) return PHIST[i - 1]
  const j = P.rows.findIndex(x => x.id === id)
  return j > 0 ? P.rows[j - 1].id : null
}
async function goPrevBuilding() {
  const id = BCTX.id, prev = prevBuildingId(id)
  if (!prev) { toast('This is the first building'); return }
  const i = PHIST.lastIndexOf(id)
  if (i > 0) PHIST.length = i // drop the current one so Previous keeps stepping back
  await openBuilding(prev, { back: true })
}
// Open the building a person belongs to (the one on screen if they're on it)
async function openProspect(personId) {
  if (BCTX.b && (BCTX.b.prospect_building_people || []).some(x => x.prospects?.id === personId)) return openBuilding(BCTX.id, { back: true })
  const { data } = await sb.from('prospect_building_people').select('building_id').eq('prospect_id', personId).limit(1)
  if (data?.[0]) return openBuilding(data[0].building_id)
  toast('That prospect isn’t tied to a building')
}
async function openBuilding(id, { back } = {}) {
  if (!back && PHIST[PHIST.length - 1] !== id) { PHIST.push(id); if (PHIST.length > 200) PHIST.shift() }
  const { data, error } = await sb.from('prospect_buildings')
    .select('*, prospect_building_people(role, verified, prospects(*, prospect_phones(*), prospect_calls(*), prospect_building_people(building_id)))').eq('id', id).single()
  if (error) { toast(error.message); return }
  BCTX.id = id; BCTX.b = data
  DRAWER.kind = null
  showDrawer(buildingDetail(data))
}
const bPeople = b => (b.prospect_building_people || []).filter(x => x.prospects).map(x => ({ ...x.prospects, role: x.role, verified: x.verified }))
const VER_ORDER = { 'LLC manager': 0, 'County owner': 1, Unverified: 2, 'Not on LLC/county': 3 }
function buildingDetail(b) {
  const all = bPeople(b)
  const people = all.filter(r => r.status !== 'Removed').sort((x, y) => (x.status === 'Converted' ? -1 : 0) - (y.status === 'Converted' ? -1 : 0) || (VER_ORDER[x.verified] ?? 2) - (VER_ORDER[y.verified] ?? 2) || (x.own_rank ?? 2) - (y.own_rank ?? 2) || String(x.owner_name).localeCompare(String(y.owner_name)))
  const removed = all.filter(r => r.status === 'Removed')
  const addr = [b.address, b.city, 'FL', b.zip].filter(Boolean).join(', ')
  const notes = el('textarea', { rows: 2, placeholder: 'Optional note for this attempt' })
  BCTX.note = notes
  const calls = all.flatMap(r => (r.prospect_calls || []).map(c => ({ ...c, who: r.owner_name }))).sort((a, c) => String(c.called_at).localeCompare(String(a.called_at)))
  const ents = Array.isArray(b.entity_people) ? b.entity_people : []
  return el('div', null,
    el('div', { class: 'dhead' }, el('span', { class: 'bicon', text: '🏢' }), el('h2', { text: bTitle(b) })),
    el('div', { class: 'actions', style: 'margin-top:6px' },
      el('a', { href: mapsHref(addr), target: '_blank', rel: 'noopener', text: [b.property_name ? b.address : null, b.city, b.county ? b.county + ' County' : null].filter(Boolean).join(' · ') || addr }),
      b.pa_link ? el('a', { class: 'btn small ghost', href: b.pa_link, target: '_blank', rel: 'noopener' }, 'County record ↗') : null),
    el('dl', { class: 'facts' },
      (b.product_type || b.use_desc || b.building_sf) ? [el('dt', { text: 'Building' }), el('dd', { text: [b.product_type || (b.use_desc ? b.use_desc.toLowerCase() : null), b.building_sf ? num(b.building_sf) + ' SF' : null, b.year_built ? 'built ' + b.year_built : null].filter(Boolean).join(' · ') })] : null,
      [el('dt', { text: 'County owner' }), el('dd', { text: b.owner_of_record || '—' })],
      b.owner_mailing ? [el('dt', { text: 'Owner mailing' }), el('dd', { text: b.owner_mailing })] : null,
      b.just_value ? [el('dt', { text: 'County value' }), el('dd', { text: money(b.just_value) })] : null,
      b.last_sale_date || b.last_sale_price ? [el('dt', { text: 'Last sale' }), el('dd', { text: [b.last_sale_date ? fmt(b.last_sale_date, LONG) : null, b.last_sale_price > 100 ? money(b.last_sale_price) : null].filter(Boolean).join(' · ') })] : null,
      b.parcel_id ? [el('dt', { text: 'Parcel' }), el('dd', { text: b.parcel_id })] : null),
    ents.length ? el('div', { class: 'card', style: 'padding:10px 12px;margin:10px 0;font-size:13px;line-height:1.5' },
      el('strong', { text: `On the ${b.owner_of_record || 'LLC'} filing (Sunbiz): ` }), ents.map(e => `${e.name}${e.title ? ' (' + e.title + ')' : ''}`).join(' · '),
      b.entity_checked_at ? el('span', { class: 'muted', text: ` · checked ${fmt(String(b.entity_checked_at).slice(0, 10))}` }) : null) : null,
    b.entity_info ? el('div', { class: 'card', style: 'padding:10px 12px;margin:10px 0;font-size:13px;line-height:1.45' }, el('strong', { text: 'Notes on ownership: ' }), b.entity_info) : null,
    pitchTip(),
    el('div', { class: 'section-title', text: `Owners & managers (${people.length})` }),
    people.length ? people.map(r => personBlock(r, b, notes)) : el('p', { class: 'muted', text: 'No owner contacts on this building yet — skip trace the LLC managers.' }),
    el('label', { class: 'f', style: 'margin-top:8px' }, 'Note (saved with the next outcome you tap)', notes),
    el('div', { class: 'actions', style: 'margin-top:12px' },
      el('button', { class: 'btn small', onclick: () => openProspectForm({ property_address: b.address, city: b.city, county: b.county, zip: b.zip, product_type: b.product_type, _building: b }) }, '+ Add an owner / manager'),
      removed.length ? el('button', { class: 'btn small ghost', onclick: () => { BCTX.showRemoved = !BCTX.showRemoved; openBuilding(b.id, { back: true }) } }, `${BCTX.showRemoved ? 'Hide' : 'Show'} removed (${removed.length})`) : null),
    BCTX.showRemoved && removed.length ? [el('div', { class: 'section-title', text: `Removed — not on the LLC or county records (${removed.length})` }),
      removed.map(r => el('div', { class: 'person removed' },
        el('div', { class: 'ph-head' }, el('b', { text: r.owner_name }), r.title ? el('span', { class: 'muted', text: r.title }) : null, verifyTag(r.verified)),
        el('div', { class: 'muted', style: 'font-size:12.5px', text: (r.prospect_phones || []).map(p => p.phone).join(' · ') || 'no numbers' }),
        el('button', { class: 'btn small', onclick: async e => { e.currentTarget.disabled = true; await sb.from('prospects').update({ status: r.attempts ? 'Attempted' : 'New', next_attempt_on: ymd(today()), updated_at: nowIso() }).eq('id', r.id); toast(`${r.owner_name} restored`); refreshProspects(); openBuilding(b.id, { back: true }) } }, 'Restore')))] : null,
    el('div', { class: 'actions', style: 'margin-top:16px' },
      el('button', { class: 'btn', disabled: !prevBuildingId(b.id), onclick: goPrevBuilding }, '← Previous building'),
      el('button', { class: 'btn', style: 'margin-left:auto', onclick: () => goNextProspect(null) }, 'Next building →')),
    calls.length ? [el('div', { class: 'section-title', text: `Attempts (${calls.length})` }),
      el('ul', { class: 'timeline' }, calls.map(c => el('li', null, el('div', { class: 'date', text: new Date(c.called_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' · ' + c.who }), el('div', { class: 'txt', text: c.outcome + (c.notes ? ' — ' + c.notes : '') }))))] : null)
}
// One owner/manager on a building: their name, how they check out, and their numbers right underneath
function personBlock(r, b, notes) {
  const phones = [...(r.prospect_phones || [])].sort((a, c) => phoneRank(a.status) - phoneRank(c.status))
  const newPhone = el('input', { type: 'tel', placeholder: 'Add a number' })
  const others = (r.prospect_building_people || []).filter(x => x.building_id !== b.id).length
  const fuBox = prospectFollowUp(r)
  if (!(r.callback_note || r.callback_time)) fuBox.classList.add('hidden')
  const phoneRow = ph => {
    const act = (label, outcome, statusTo) => el('button', { class: 'btn small' + (ph.status === statusTo ? ' on' : ''), onclick: e => { e.target.disabled = true; recordAttempt(r, ph, outcome, statusTo, notes.value.trim()) } }, label)
    const lastNote = (r.prospect_calls || []).filter(c => c.phone_id === ph.id && c.notes).sort((a, c) => String(c.called_at).localeCompare(String(a.called_at)))[0]
    return el('div', { class: 'pphone' + (PHONE_BAD.includes(ph.status) ? ' dead' : '') },
      el('div', { class: 'pp-top' },
        el('a', { class: 'tel', href: telHref(ph.phone), text: ph.phone }),
        ph.phone_type ? el('span', { class: 'muted', text: ph.phone_type }) : null,
        el('span', { class: 'ptag ' + slug(ph.status), text: ph.status }),
        ph.attempts ? el('span', { class: 'muted', style: 'font-size:12px', text: `${ph.attempts}×${ph.last_called_at ? ' · last ' + fmt(ph.last_called_at.slice(0, 10)) : ''}` }) : null),
      lastNote ? el('div', { class: 'pp-note', text: `📝 ${fmt(String(lastNote.called_at).slice(0, 10))}: ${lastNote.notes}` }) : null,
      r.status === 'Converted' ? null : el('div', { class: 'pp-acts' },
        act('No answer', 'No answer', 'No answer'), act('Left VM', 'Left voicemail', 'Voicemail'),
        el('button', { class: 'btn small vmok' + (ph.status === 'Owner VM' ? ' on' : ''), title: 'Left a voicemail and the greeting confirmed it’s the owner — parks this as a good number', onclick: e => { e.target.disabled = true; recordAttempt(r, ph, 'Left voicemail — owner’s number confirmed', 'Owner VM', notes.value.trim()) } }, 'VM ✓ owner’s #'),
        act('Wrong #', 'Wrong number', 'Wrong number'), act('Disconnected', 'Disconnected', 'Disconnected'),
        act('DNC', 'Asked not to be called', 'Do not call'),
        el('button', { class: 'btn small', title: 'Someone answered (office line, receptionist, partner…) but not a lead — log it with a note', onclick: e => {
          const n = prompt(`Talked on ${ph.phone} — who did you speak with / what did they say?`, '')
          if (n === null) return
          e.target.disabled = true; recordAttempt(r, ph, 'Spoke — office line', 'Good', n.trim())
        } }, 'Spoke (note)'),
        !['Untested', 'Good', 'Owner VM'].includes(ph.status) ? el('button', { class: 'btn small ghost', title: 'Tapped the wrong button? Put this number back', onclick: e => { e.target.disabled = true; resetPhone(r, ph) } }, '↺ Undo') : null,
        el('button', { class: 'btn small primary', onclick: () => openConvert(r, ph) }, 'Talked ✓'),
        el('button', { class: 'btn small primary', onclick: () => openConvert(r, ph, { meeting: true }) }, '📅 Meeting set')))
  }
  return el('div', { class: 'person' + (r.status === 'Converted' ? ' converted' : '') },
    el('div', { class: 'ph-head' },
      r.priority ? el('span', { class: 'pri ' + r.priority, text: r.priority }) : null,
      el('b', { class: 'pname', text: r.owner_name }),
      r.title || r.role ? el('span', { class: 'muted', text: r.title || r.role }) : null,
      verifyTag(r.verified),
      el('span', { class: 'ptag ' + slug(r.status), text: r.status === 'Converted' ? 'Contact' : r.status }),
      others ? el('span', { class: 'tag', title: 'This person is also on other buildings in your list', text: `+${others} other bldg` }) : null),
    r.company || r.email || r.mailing_address ? el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:2px', text: [r.company, r.email, r.mailing_address ? [r.mailing_address, r.mailing_city, r.mailing_state, r.mailing_zip].filter(Boolean).join(', ') : null].filter(Boolean).join(' · ') }) : null,
    r.callback_note || r.callback_time ? el('div', { class: 'nextcall' }, el('span', { class: 'muted', text: 'Follow-up' }), el('b', { text: fmt(r.next_attempt_on, LONG) + (r.callback_time ? ' · ' + fmtTime(r.callback_time) : '') }), r.callback_note ? el('div', { text: r.callback_note }) : null) : null,
    r.status === 'Converted' && r.converted_contact_id ? el('button', { class: 'btn small primary', style: 'margin:6px 0', onclick: () => openContact(r.converted_contact_id) }, 'Open contact card →') : null,
    r.status === 'Converted' ? null : el('div', { class: 'actions', style: 'margin:6px 0 2px' },
      el('span', { class: 'muted', style: 'font-size:12.5px', text: 'Tag:' }),
      ['A', 'B', 'C'].map(p => el('button', { class: 'chip pri-chip' + (r.priority === p ? ' on' : ''), title: r.priority === p ? 'Remove tag' : `Tag as ${p}`, onclick: async e => {
        e.currentTarget.disabled = true
        const v = r.priority === p ? null : p
        const { error } = await sb.from('prospects').update({ priority: v, updated_at: nowIso() }).eq('id', r.id)
        if (error) { toast(error.message); return }
        toast(v ? `${r.owner_name} tagged ${v}` : 'Tag removed'); refreshProspects(); openProspect(r.id)
      } }, p))),
    phones.length ? phones.map(phoneRow) : el('p', { class: 'muted', style: 'margin:6px 0', text: 'No numbers — skip trace this person.' }),
    r.status === 'Converted' ? null : [
      el('div', { class: 'doc-add', style: 'grid-template-columns:1fr auto;margin-top:8px' }, newPhone,
        el('button', { class: 'btn small', onclick: async () => {
          const v = newPhone.value.trim(); if (v.replace(/\D/g, '').length < 7) return
          const { error } = await sb.from('prospect_phones').insert({ prospect_id: r.id, phone: fmtPhone(v) })
          if (error) { toast(error.message); return }
          if (r.status === 'Bad data') await sb.from('prospects').update({ status: r.attempts ? 'Attempted' : 'New', next_attempt_on: ymd(today()), updated_at: nowIso() }).eq('id', r.id)
          openProspect(r.id); refreshProspects()
        } }, 'Add number')),
      fuBox,
      el('div', { class: 'actions', style: 'margin-top:8px' },
        el('button', { class: 'btn small primary', onclick: () => openConvert(r, null, { meeting: true }) }, '📅 Meeting set'),
        el('button', { class: 'btn small', onclick: () => openConvert(r, null) }, 'Talked (other number)'),
        el('button', { class: 'btn small', onclick: () => fuBox.classList.toggle('hidden') }, '📅 Follow-up'),
        el('button', { class: 'btn small', onclick: () => setProspectStatus(r, 'Not interested', 'Reached — not interested') }, 'Not interested'),
        el('button', { class: 'btn small', onclick: () => setProspectStatus(r, 'Do not call', 'Do not call') }, 'Do not call'),
        el('button', { class: 'btn small ghost', onclick: () => openProspectForm(r) }, 'Edit'),
        el('button', { class: 'btn small danger', onclick: e => deleteProspect(r, e.currentTarget) }, 'Delete'))])
}

async function recordAttempt(r, ph, outcome, phoneStatus, note) {
  const now = nowIso(), T = today()
  const phones = (r.prospect_phones || []).map(x => x.id === ph.id ? { ...x, status: phoneStatus, last_called_at: now } : x)
  const liveLeft = phones.filter(x => !PHONE_BAD.includes(x.status))
  const attempts = (r.attempts || 0) + 1
  let status = 'Attempted', next = ymd(addBusinessDays(T, /^Left voicemail/.test(outcome) ? 2 : 1))
  if (!liveLeft.length) { status = phones.every(x => x.status === 'Do not call') ? 'Do not call' : 'Bad data'; next = null }
  else if (attempts >= 6) next = ymd(addBusinessDays(T, 20)) // after 6 tries, cool off ~a month
  const res = await Promise.all([
    sb.from('prospect_phones').update({ status: phoneStatus, attempts: (ph.attempts || 0) + 1, last_called_at: now }).eq('id', ph.id),
    sb.from('prospect_calls').insert({ prospect_id: r.id, phone_id: ph.id, outcome: `${outcome} (${ph.phone})`, notes: note || null }),
    sb.from('prospects').update({ status, attempts, last_attempt_at: now, next_attempt_on: next, callback_time: null, callback_note: null, updated_at: now }).eq('id', r.id),
  ])
  const err = res.find(x => x.error); if (err) { toast(err.error.message); return }
  const msg = status === 'Bad data' ? 'No live numbers left — moved to the skip-trace list' : status === 'Do not call' ? 'Marked do not call' : `${outcome} logged · retry ${fmt(next, { weekday: 'short', month: 'short', day: 'numeric' })}`
  // Every number for every owner on this building tried today (or dead)? Move straight to the next building.
  const todayStr = ymd(T)
  const tried = x => PHONE_BAD.includes(x.status) || (x.last_called_at && ymd(new Date(x.last_called_at)) === todayStr)
  const others = BCTX.b ? bPeople(BCTX.b).filter(x => x.id !== r.id && ['New', 'Attempted'].includes(x.status)) : []
  const cardDone = phones.every(tried) && others.every(o => (o.prospect_phones || []).every(tried))
  if (cardDone) return goNextProspect(r, msg)
  toast(msg); refreshProspects(); openProspect(r.id)
}
// Open the building that comes after the current one in the list (captured before the list refreshes)
async function goNextProspect(r, msg) {
  const cur = BCTX.id
  const i = P.rows.findIndex(x => x.id === cur)
  const next = P.rows.slice(i + 1).find(x => x.id !== cur) || P.rows.find(x => x.id !== cur)
  await refreshProspects()
  if (next) { toast((msg ? msg + ' · ' : '') + `Next: ${bTitle(next)}`); openBuilding(next.id) }
  else { toast((msg ? msg + ' · ' : '') + 'That was the last building on this page'); closeDrawer() }
}
async function resetPhone(r, ph) {
  const now = nowIso()
  const res = await Promise.all([
    sb.from('prospect_phones').update({ status: 'Untested', attempts: Math.max(0, (ph.attempts || 1) - 1) }).eq('id', ph.id),
    sb.from('prospect_calls').insert({ prospect_id: r.id, phone_id: ph.id, outcome: `Undo — ${ph.phone} put back (was ${ph.status})` }),
    ['Bad data', 'Do not call'].includes(r.status) ? sb.from('prospects').update({ status: r.attempts ? 'Attempted' : 'New', next_attempt_on: ymd(today()), updated_at: now }).eq('id', r.id) : Promise.resolve({}),
  ])
  const err = res.find(x => x.error); if (err) { toast(err.error.message); return }
  toast(`${ph.phone} is back in play`); refreshProspects(); openProspect(r.id)
}
async function setProspectStatus(r, status, outcome) {
  const now = nowIso()
  await sb.from('prospect_calls').insert({ prospect_id: r.id, outcome })
  const { error } = await sb.from('prospects').update({ status, next_attempt_on: null, last_attempt_at: now, updated_at: now }).eq('id', r.id)
  if (error) { toast(error.message); return }
  // Co-owners on this building still to call? Stay on the building; otherwise move on
  const left = BCTX.b ? bPeople(BCTX.b).filter(x => x.id !== r.id && ['New', 'Attempted'].includes(x.status)) : []
  if (left.length) { toast(`${r.owner_name}: ${status}`); refreshProspects(); openBuilding(BCTX.id, { back: true }) }
  else goNextProspect(r, `${r.owner_name}: ${status}`)
}

/* Talked → becomes a real contact */
function openConvert(r, ph, { meeting } = {}) {
  const T = today()
  const defPri = r.priority || (meeting ? 'A' : 'B')
  const pri = el('select', null, ['A', 'B', 'C'].map(p => el('option', { value: p, text: `${p} — ${CADENCE[p].label}`, selected: p === defPri })))
  const mDate = el('input', { type: 'date', value: ymd(addBusinessDays(T, 2)) })
  const mTime = el('input', { type: 'time', value: '10:00' })
  // Buildings this person is tied to — the one on screen first; a meeting is linked to the one you pick
  const myB = [BCTX.b && bPeople(BCTX.b).some(x => x.id === r.id) ? BCTX.id : null, ...(r.prospect_building_people || []).map(x => x.building_id)].filter((v, i, a) => v && a.indexOf(v) === i)
  const curB = BCTX.b && BCTX.id === myB[0] ? BCTX.b : null
  const about = el('select', null, myB.map((bid, i) => el('option', { value: bid, text: bid === BCTX.id && curB ? bTitle(curB) : `Building #${i + 1}`, selected: i === 0 })))
  if (myB.length > 1) sb.from('prospect_buildings').select('id,address,property_name,city').in('id', myB).then(({ data }) => { for (const o of about.options) { const x = (data || []).find(d => String(d.id) === o.value); if (x) o.textContent = [bTitle(x), x.city].filter(Boolean).join(', ') } })
  const mWhere = el('input', { placeholder: 'At the property, their office, Zoom…', value: meeting ? 'At the property — ' + ((curB && curB.address) || r.property_address || '') : '' })
  about.onchange = async () => { if (!meeting) return; const { data } = await sb.from('prospect_buildings').select('address').eq('id', about.value).single(); if (data && /^At the property/.test(mWhere.value)) mWhere.value = 'At the property — ' + data.address }
  const meetWhen = () => `${fmt(mDate.value, { weekday: 'short', month: 'short', day: 'numeric' })}${mTime.value ? ' at ' + fmtTime(mTime.value) : ''}${mWhere.value.trim() ? ' — ' + mWhere.value.trim() : ''}`
  const type = el('select', null, TYPES.map(t => el('option', { value: t, text: t, selected: t === 'Seller' })))
  const notes = el('textarea', { rows: 4, placeholder: 'What did you talk about?' })
  const hasFu = !!(r.callback_note || r.callback_time) && r.next_attempt_on >= ymd(T)
  const next = el('input', { type: 'date', value: hasFu ? r.next_attempt_on : ymd(addCadence(T, defPri)) })
  pri.onchange = () => { next.value = ymd(addCadence(T, pri.value)) }
  const nextTime = el('input', { type: 'time', value: hasFu && r.callback_time ? String(r.callback_time).slice(0, 5) : '' })
  const nextNote = el('input', { placeholder: 'Next step', value: hasFu ? r.callback_note || '' : '' })
  const err = el('div', { class: 'err' })
  const save = el('button', { class: 'btn primary', type: 'submit' }, meeting ? 'Save meeting' : 'Save as contact')
  const form = el('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault()
    if (meeting && !mDate.value) { err.textContent = 'Pick the meeting date.'; return }
    if (!meeting && !notes.value.trim()) { err.textContent = 'Add a note about the conversation.'; return }
    const convNote = meeting ? 'Meeting set for ' + meetWhen() + (notes.value.trim() ? ' — ' + notes.value.trim() : '') : notes.value.trim()
    save.disabled = true
    try {
      const base = slug(r.owner_name)
      const { data: taken } = await sb.from('contacts').select('id').like('id', base + '%')
      const used = new Set((taken || []).map(x => x.id)); let id = base, n = 2
      while (used.has(id)) id = base + '-' + n++
      const goodPhone = ph || (r.prospect_phones || []).find(x => !PHONE_BAD.includes(x.status))
      const aq = r.property_address ? [r.property_address, r.city, 'FL', r.zip].filter(Boolean).join(', ') : null
      const contact = { id, name: r.owner_name, company: r.company, priority: pri.value, contact_type: type.value, phone: goodPhone?.phone || null, email: r.email,
        address: r.property_address, address_query: aq, city: r.city, county: r.county, lat: r.lat, lng: r.lng, parcel_id: r.parcel_id,
        next_follow_up: meeting ? mDate.value : next.value || null, next_time: meeting ? mTime.value || null : nextTime.value || null,
        next_note: meeting ? 'MEETING ' + meetWhen() : nextNote.value.trim() || null, last_contact: ymd(T),
        notes: [r.mailing_address ? 'Mailing: ' + [r.mailing_address, r.mailing_city, r.mailing_state, r.mailing_zip].filter(Boolean).join(', ') : null, r.notes, 'Converted from prospect list' + (r.source ? ` (${r.source})` : '')].filter(Boolean).join('\n') }
      const { error: e1 } = await sb.from('contacts').insert(contact); if (e1) throw e1
      // Every building this person owns goes on their one contact card; the one you're discussing moves along the pipeline
      const { data: blds } = myB.length ? await sb.from('prospect_buildings').select('*').in('id', myB) : { data: [] }
      let aboutPropId = null
      for (const bid of myB) {
        const x = (blds || []).find(d => d.id === bid); if (!x) continue
        const isAbout = String(bid) === String(about.value)
        const { data: pr } = await sb.from('properties').insert({ contact_id: id, name: x.property_name || null, address: x.address, address_query: [x.address, x.city, 'FL', x.zip].filter(Boolean).join(', '), city: x.city, county: x.county, lat: x.lat, lng: x.lng,
          parcel_id: x.parcel_id, product_type: x.product_type, building_sf: x.building_sf, year_built: x.year_built, just_value: x.just_value, owner_of_record: x.owner_of_record, owner_mailing: x.owner_mailing, pa_link: x.pa_link, use_code: x.use_code,
          stage: isAbout ? (meeting ? 'Meeting' : 'Contacted') : 'Contacted', stage_updated_at: nowIso() }).select('id').single()
        if (isAbout && pr) aboutPropId = pr.id
      }
      if (!myB.length && r.property_address) await sb.from('properties').insert({ contact_id: id, address: r.property_address, address_query: aq, city: r.city, county: r.county, lat: r.lat, lng: r.lng, parcel_id: r.parcel_id, product_type: r.product_type, building_sf: r.building_sf, year_built: r.year_built, stage: meeting ? 'Meeting' : 'Contacted', stage_updated_at: nowIso() })
      const { error: e2 } = await sb.from('conversations').insert({ contact_id: id, talked_on: ymd(T), notes: convNote, property_id: aboutPropId }); if (e2) throw e2
      if (ph) await sb.from('prospect_phones').update({ status: 'Good', attempts: (ph.attempts || 0) + 1, last_called_at: nowIso() }).eq('id', ph.id)
      await sb.from('prospect_calls').insert({ prospect_id: r.id, phone_id: ph?.id || null, outcome: meeting ? `Reached — meeting set → contact (${pri.value})${ph ? ' (' + ph.phone + ')' : ''}` : `Talked → contact (${pri.value})`, notes: convNote })
      await sb.from('prospects').update({ status: 'Converted', converted_contact_id: id, next_attempt_on: null, last_attempt_at: nowIso(), attempts: (r.attempts || 0) + 1, updated_at: nowIso() }).eq('id', r.id)
      await Promise.all([loadTable('contacts'), loadTable('conversations'), loadTable('properties')])
      refreshProspects(); openContact(id); locateMissing(); toast(meeting ? `Meeting set with ${r.owner_name} · ${meetWhen()}` : `${r.owner_name} added to your contacts (${pri.value})`)
    } catch (x) { err.textContent = x.message || String(x); save.disabled = false }
  } },
    el('h2', { text: (meeting ? '📅 Meeting set with ' : 'Talked to ') + r.owner_name }),
    el('p', { class: 'muted', text: (meeting ? 'They become a contact, the meeting goes on your calendar and counts in your KPIs, and the building moves to the Meeting stage.' : 'They move into your contacts with a priority and cadence.') + (myB.length > 1 ? ` All ${myB.length} of their buildings go on their contact card.` : '') + ' Anyone else on the building stays callable and shows on their card as a co-owner.' }),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Priority', pri), el('label', { class: 'f' }, 'Type', type)),
    myB.length > 1 ? el('label', { class: 'f' }, meeting ? 'Meeting is about' : 'Talked about', about) : null,
    meeting ? [el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Meeting date', mDate), el('label', { class: 'f' }, 'Time', mTime)), el('label', { class: 'f' }, 'Where', mWhere)] : null,
    el('label', { class: 'f' }, meeting ? 'Notes from the call (optional)' : 'Notes from the call', notes),
    meeting ? null : [el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Next follow-up', next), el('label', { class: 'f' }, 'Time (blank = first call block)', nextTime)),
      el('label', { class: 'f' }, 'Next step', nextNote)],
    err, el('div', { class: 'actions' }, save, el('button', { class: 'btn', type: 'button', onclick: () => openProspect(r.id) }, 'Cancel')))
  DRAWER.kind = null
  showDrawer(form)
  notes.focus()
}

/* Add / edit one prospect */
function openProspectForm(r = {}) {
  const editing = !!r.id
  const f = {}
  for (const k of ['owner_name', 'company', 'property_address', 'city', 'county', 'zip', 'product_type', 'mailing_address', 'email'])
    f[k] = el('input', { value: r[k] ?? '', required: k === 'owner_name' })
  const phones = el('input', { placeholder: 'Comma separated' })
  const notes = el('textarea', { rows: 3, text: r.notes || '' })
  const err = el('div', { class: 'err' })
  const form = el('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault()
    const row = Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value.trim() || null]))
    row.notes = notes.value.trim() || null; row.updated_at = nowIso()
    if (!row.county && row.city) row.county = CITY_COUNTY[norm(row.city)] || null
    let id = r.id
    if (editing) { const { error } = await sb.from('prospects').update(row).eq('id', id); if (error) { err.textContent = error.message; return } }
    else { row.source = 'Added by hand'; row.next_attempt_on = ymd(today()); const { data, error } = await sb.from('prospects').insert(row).select('id').single(); if (error) { err.textContent = error.message; return } id = data.id }
    const list = phones.value.split(/[,;\n]/).map(x => x.trim()).filter(x => x.replace(/\D/g, '').length >= 7)
    if (list.length) await sb.from('prospect_phones').upsert(list.map(p => ({ prospect_id: id, phone: fmtPhone(p) })), { onConflict: 'prospect_id,digits', ignoreDuplicates: true })
    refreshProspects(); openProspect(id)
  } },
    el('h2', { text: editing ? 'Edit prospect' : r._building ? 'Add an owner / manager to ' + bTitle(r._building) : 'New prospect' }),
    el('label', { class: 'f' }, 'Owner name', f.owner_name), el('label', { class: 'f' }, 'Company / entity', f.company),
    el('label', { class: 'f' }, 'Property address', f.property_address),
    el('div', { class: 'row3' }, el('label', { class: 'f' }, 'City', f.city), el('label', { class: 'f' }, 'County', f.county), el('label', { class: 'f' }, 'ZIP', f.zip)),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Property type', f.product_type), el('label', { class: 'f' }, 'Email', f.email)),
    el('label', { class: 'f' }, 'Mailing address', f.mailing_address),
    el('label', { class: 'f' }, editing ? 'Add phone numbers' : 'Phone numbers', phones),
    el('label', { class: 'f' }, 'Notes', notes),
    err, el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Save'), el('button', { class: 'btn', type: 'button', onclick: () => editing ? openProspect(r.id) : r._building ? openBuilding(r._building.id, { back: true }) : closeDrawer() }, 'Cancel')))
  DRAWER.kind = null
  showDrawer(form)
}

/* CSV import with column matching */
const IMPORT_FIELDS = [
  ['owner_name', 'Owner name', /^(owner|owner ?name|owner ?1|full ?name|name|contact ?name)$/i],
  ['first_name', 'First name', /first/i],
  ['last_name', 'Last name', /last ?name|^last$/i],
  ['company', 'Company / entity', /(company|entity|business|organization|llc)/i],
  ['property_address', 'Property address', /^(property ?address|site ?address|situs.*|address|street ?address|property ?street)$/i],
  ['city', 'Property city', /^(property ?city|site ?city|situs ?city|city)$/i],
  ['county', 'County', /county/i],
  ['zip', 'Property ZIP', /^(property ?zip|site ?zip|situs ?zip|zip|zip ?code|postal ?code)$/i],
  ['mailing_address', 'Mailing address', /mail.*(addr|street)|owner ?address/i],
  ['mailing_city', 'Mailing city', /mail.*city|owner ?city/i],
  ['mailing_state', 'Mailing state', /mail.*state|owner ?state/i],
  ['mailing_zip', 'Mailing ZIP', /mail.*zip|owner ?zip/i],
  ['email', 'Email', /e-?mail/i],
  ['product_type', 'Property type', /(property ?type|land ?use|use ?code|use$|^type$)/i],
  ['building_sf', 'Building SF', /(sq ?ft|sqft|square|building ?size|bldg ?sf|^sf$|living ?area)/i],
  ['year_built', 'Year built', /year ?built/i],
  ['parcel_id', 'Parcel ID', /(parcel|apn|folio)/i],
  ['notes', 'Notes', /note/i],
]
function openImport() {
  const file = el('input', { type: 'file', accept: '.csv,text/csv' })
  const body = el('div', { class: 'stack' })
  const wrap = el('div', { class: 'stack' },
    el('h2', { text: 'Import prospects' }),
    el('p', { class: 'muted', text: 'One owner per row. Any number of phone columns works (Phone 1, Phone 2, Mobile…). Excel: File → Save As → CSV. Owners whose number is already in your contacts are skipped, and duplicates are merged.' }),
    el('label', { class: 'f' }, 'CSV file', file), body)
  file.onchange = () => {
    const fl = file.files[0]; if (!fl) return
    body.replaceChildren(el('div', { class: 'muted', text: 'Reading file…' }))
    Papa.parse(fl, { header: true, skipEmptyLines: true, complete: res => mapStep(res, fl.name), error: e => body.replaceChildren(el('div', { class: 'err', text: e.message })) })
  }
  function mapStep(res, fname) {
    const cols = (res.meta.fields || []).filter(Boolean)
    const used = new Set(), pick = {}
    for (const [k, , re] of IMPORT_FIELDS) { const c = cols.find(c => !used.has(c) && re.test(c.trim())); if (c) { pick[k] = c; used.add(c) } }
    const isPhoneCol = c => /(phone|mobile|cell|landline|wireless|tel\b|number)/i.test(c) && !/(type|status|dnc|score|litig|carrier|line ?type|count)/i.test(c)
    const selects = {}
    const grid = el('div', { class: 'map-grid' }, IMPORT_FIELDS.map(([k, label]) => {
      selects[k] = el('select', null, el('option', { value: '', text: '— skip —' }), cols.map(c => el('option', { value: c, text: c, selected: pick[k] === c })))
      return el('label', { class: 'f' }, label, selects[k])
    }))
    const phoneBoxes = cols.map(c => el('label', { class: 'chk small' }, el('input', { type: 'checkbox', checked: isPhoneCol(c), value: c }), c))
    const source = el('input', { value: fname.replace(/\.csv$/i, '') })
    const status = el('div', { class: 'muted' })
    const go = el('button', { class: 'btn primary' }, `Import ${res.data.length.toLocaleString()} rows`)
    go.onclick = async () => {
      go.disabled = true
      const map = Object.fromEntries(Object.entries(selects).map(([k, s]) => [k, s.value]).filter(([, v]) => v))
      if (!map.owner_name && !map.first_name && !map.company) { status.textContent = 'Pick the column with the owner name.'; go.disabled = false; return }
      const pcs = phoneBoxes.map(l => l.querySelector('input')).filter(i => i.checked).map(i => i.value)
      try { await runImport(res.data, map, pcs, source.value.trim() || fname, status) } catch (x) { status.textContent = 'Import failed: ' + (x.message || x); go.disabled = false }
    }
    body.replaceChildren(
      el('div', { class: 'muted', text: `${res.data.length.toLocaleString()} rows · ${cols.length} columns. Check the matches below.` }),
      grid,
      el('div', { class: 'section-title', text: 'Phone number columns' }),
      el('div', { class: 'phone-cols' }, phoneBoxes),
      el('label', { class: 'f' }, 'Source (shown on each prospect)', source),
      status, el('div', { class: 'actions' }, go))
  }
  DRAWER.kind = null
  showDrawer(wrap)
}
async function runImport(rows, map, phoneCols, source, status) {
  const get = (r, k) => map[k] ? String(r[map[k]] ?? '').trim() : ''
  const batch = source + ' · ' + ymd(today())
  const d10 = v => String(v || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  const contactDigits = new Set(S.contacts.map(c => d10(c.phone)).filter(Boolean))
  status.textContent = 'Checking for duplicates…'
  const existing = new Set()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('prospects').select('owner_name,property_address').range(from, from + 999)
    if (error) throw error
    for (const x of data) existing.add(norm(x.owner_name) + '|' + norm(x.property_address))
    if (data.length < 1000) break
  }
  const merged = new Map(); let skippedContact = 0, skippedDup = 0, noName = 0
  for (const r of rows) {
    const owner = get(r, 'owner_name') || [get(r, 'first_name'), get(r, 'last_name')].filter(Boolean).join(' ') || get(r, 'company')
    if (!owner) { noName++; continue }
    const phones = [...new Set(phoneCols.map(c => String(r[c] ?? '').trim()).filter(p => d10(p).length === 10).map(fmtPhone))]
    if (phones.some(p => contactDigits.has(d10(p)))) { skippedContact++; continue }
    const city = get(r, 'city'), prop = get(r, 'property_address')
    const key = norm(owner) + '|' + norm(prop)
    if (existing.has(key)) { skippedDup++; continue }
    const cur = merged.get(key)
    if (cur) { cur.phones = [...new Set([...cur.phones, ...phones])]; if (cur.phones.length) cur.row.status = 'New'; continue }
    const sf = parseFloat(get(r, 'building_sf').replace(/[^\d.]/g, '')), yb = parseInt(get(r, 'year_built'), 10)
    let county = get(r, 'county').replace(/\s*county$/i, '').trim()
    if (county) county = county.replace(/\b\w/g, ch => ch.toUpperCase()).replace(/\B\w+/g, w => w.toLowerCase())
    if (!county && city) county = CITY_COUNTY[norm(city)] || null
    merged.set(key, { phones, row: {
      owner_name: owner, company: get(r, 'company') || null, property_address: prop || null, city: city || null, county: county || null, zip: get(r, 'zip') || null,
      mailing_address: get(r, 'mailing_address') || null, mailing_city: get(r, 'mailing_city') || null, mailing_state: get(r, 'mailing_state') || null, mailing_zip: get(r, 'mailing_zip') || null,
      email: get(r, 'email') || null, product_type: get(r, 'product_type') || null, building_sf: isNaN(sf) ? null : sf, year_built: isNaN(yb) ? null : yb,
      parcel_id: get(r, 'parcel_id') || null, notes: get(r, 'notes') || null, source, import_batch: batch,
      status: phones.length ? 'New' : 'Bad data' } })
  }
  const items = [...merged.values()]
  let done = 0, phonesAdded = 0
  for (let i = 0; i < items.length; i += 250) {
    const chunk = items.slice(i, i + 250)
    const { data, error } = await sb.from('prospects').insert(chunk.map(x => ({ ...x.row, next_attempt_on: x.row.next_attempt_on || ymd(today()) }))).select('id')
    if (error) throw error
    const ph = []
    data.forEach((d, j) => chunk[j].phones.forEach(p => ph.push({ prospect_id: d.id, phone: p })))
    for (let k = 0; k < ph.length; k += 1000) {
      const { error: e2 } = await sb.from('prospect_phones').upsert(ph.slice(k, k + 1000), { onConflict: 'prospect_id,digits', ignoreDuplicates: true })
      if (e2) throw e2
    }
    done += chunk.length; phonesAdded += ph.length
    status.textContent = `Imported ${done.toLocaleString()} of ${items.length.toLocaleString()}…`
  }
  closeDrawer()
  Object.assign(P, { county: '', status: 'tocall', page: 0 })
  await refreshProspects(); go('prospects')
  const extra = [skippedContact && `${skippedContact} already in contacts`, skippedDup && `${skippedDup} duplicates`, noName && `${noName} rows with no name`].filter(Boolean)
  toast(`Imported ${done.toLocaleString()} owners · ${phonesAdded.toLocaleString()} numbers` + (extra.length ? ` · skipped ${extra.join(', ')}` : ''))
}

/* Owners with no live number → CSV for BatchSkipTracing */
async function exportSkipTrace() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from('prospects').select('owner_name,company,property_address,city,zip,county,mailing_address,mailing_city,mailing_state,mailing_zip').eq('status', 'Bad data')
    if (P.county) q = P.county === 'Unknown' ? q.is('county', null) : q.eq('county', P.county)
    const { data, error } = await q.range(from, from + 999)
    if (error) { toast(error.message); return }
    rows.push(...data); if (data.length < 1000) break
  }
  if (!rows.length) { toast('No owners need skip tracing right now'); return }
  const split = n => { const parts = String(n || '').trim().split(/\s+/); return parts.length > 1 ? [parts.slice(0, -1).join(' '), parts.at(-1)] : [n || '', ''] }
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }
  const head = ['First Name', 'Last Name', 'Company', 'Property Address', 'Property City', 'Property State', 'Property Zip', 'Mailing Address', 'Mailing City', 'Mailing State', 'Mailing Zip', 'County']
  const lines = rows.map(r => { const [fn, ln] = r.company ? ['', ''] : split(r.owner_name); return [fn, ln, r.company || '', r.property_address, r.city, 'FL', r.zip, r.mailing_address, r.mailing_city, r.mailing_state, r.mailing_zip, r.county].map(q).join(',') })
  const a = el('a', { href: URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' })), download: `skip-trace-${slug(P.county || 'all')}-${ymd(today())}.csv` })
  document.body.append(a); a.click(); a.remove()
  toast(`${rows.length} owners exported for skip tracing`)
}

/* ---------- KPIs (weekly scorecard) ---------- */
// Every activity is counted from what's already logged: cold-list dials (prospect_calls) and contact conversations.
const KPI_KINDS = {
  meeting_held: 'Meeting held', bov: 'Strategic analysis delivered', listing: 'Exclusive listing signed',
  contract: 'Contract signed', closed: 'Deal closed',
}
// Cole's annual goals: [floor (survival), target (aim), game (excel)]
const YEAR_GOALS = [
  ['income', 'Net income', [60000, 80000, 100000], 'money'],
  ['closed', 'Closings', [3, 4, 5]],
  ['contract', 'Contracts signed', [4, 5, 7]],
  ['listing', 'Exclusives obtained', [5, 6, 8]],
  ['bov', 'Proposals presented (strategic analyses)', [50, 60, 80]],
  ['mheld', 'Meetings attended', [100, 120, 160]],
]
const WORK_WEEKS = 50
// Weekly tiers: calls straight from Cole's plan; meetings/proposals = annual goal ÷ 50 working weeks
const WEEK_GOALS = { dials: [200, 250, 300], mheld: [2, 2.4, 3.2], mset: [2, 2.4, 3.2], bov: [1, 1.2, 1.6] }
const TIER = ['Floor', 'Target', 'Game']
const goalYearStart = () => { try { return localStorage.getItem('goalYearStart') || '2026-09-23' } catch { return '2026-09-23' } }
function convKind(n) {
  const t = String(n || '').trim(), l = t.toLowerCase()
  if (/^(no answer|didnt answer|didn't answer)/.test(l) || /^called \(.*no answer/.test(l)) return 'na'
  if (/^left voicemail/.test(l) || /left vm/.test(l)) return 'vm'
  if (/^(meeting set|booked in-person meeting)/.test(l)) return 'mset'
  if (/^(meeting held|in-person meeting|zoom bov meeting)/.test(l)) return 'mheld'
  if (/^(strategic analysis delivered|sent follow-up email with bov|bov delivered)/.test(l)) return 'bov'
  if (/^(listing signed|exclusive listing signed|exclusive signed)/.test(l)) return 'listing'
  if (/^contract signed/.test(l)) return 'contract'
  if (/^deal closed/.test(l)) return 'closed'
  if (/^text sent/.test(l)) return 'texts'
  if (/^text received/.test(l)) return 'textin'
  if (/^(sent |replied|he emailed|she emailed|emailed)/.test(l)) return 'email'
  if (/^(ownership note|added to crm|going over the building|follow up on bov|workign with|working with|cole confirmed|played pickleball|arrived late|note:)/.test(l)) return 'note'
  if (l === 'called') return 'dial'
  return 'talk'
}
const KPI = { week: null, calls: null, loading: false, from: null }
const KPI_METRICS = [
  ['dials', 'Calls (working #s)'], ['total', 'Total dials (incl. bad #s)'], ['people', 'Owners dialed'], ['connects', 'Conversations'], ['rate', 'Contact rate'],
  ['vm', 'Voicemails left'], ['bad', 'Bad numbers'], ['mset', 'Meetings set'], ['mheld', 'Meetings attended'],
  ['bov', 'Proposals (strategic analyses)'], ['listing', 'Exclusives'], ['newc', 'New contacts'], ['texts', 'People texted'], ['textin', 'Text replies'],
]
function _unusedKpiTargets() { let t = {}; try { t = JSON.parse(localStorage.getItem('kpiTargets') || '{}') } catch { } ; return Object.fromEntries(KPI_METRICS.map(([k, , d]) => [k, t[k] ?? d])) }
const monday = d => { const x = new Date(d); const w = (x.getDay() + 6) % 7; x.setDate(x.getDate() - w); x.setHours(0, 0, 0, 0); return x }
async function loadKpiCalls(from) {
  if (KPI.loading || (KPI.calls && KPI.from && KPI.from <= from)) return
  KPI.loading = true
  const rows = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await sb.from('prospect_calls').select('prospect_id, outcome, called_at').gte('called_at', new Date(from.getTime() - 864e5).toISOString()).order('id').range(i, i + 999)
    if (error) { toast(error.message); break }
    rows.push(...data); if (data.length < 1000) break
  }
  KPI.calls = rows; KPI.from = from; KPI.loading = false
  if (S.tab === 'kpis') render({ soft: true })
}
const nyDay = ts => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
function kpiDay(day) {
  const m = { texts: 0, textin: 0, total: 0, dials: 0, people: 0, connects: 0, vm: 0, na: 0, bad: 0, mset: 0, mheld: 0, bov: 0, listing: 0, contract: 0, closed: 0, income: 0, newc: 0, email: 0 }
  const ppl = new Set()
  for (const c of KPI.calls || []) {
    if (nyDay(c.called_at) !== day) continue
    const o = c.outcome || ''
    if (/^(undo|talked)/i.test(o)) continue // conversions are counted from the contact's conversation
    m.total++ // every dial, bad numbers included — total effort
    if (/^(wrong number|disconnected)/i.test(o)) { m.bad++; continue } // bad numbers don't count toward the dial goal
    m.dials++; ppl.add('p' + c.prospect_id)
    if (/^(reached|do not call|spoke)/i.test(o)) m.connects++
    else if (/^left voicemail/i.test(o)) m.vm++
    else if (/^no answer/i.test(o)) m.na++
  }
  const seen = new Set()
  for (const v of S.convos) {
    if (v.talked_on !== day) continue
    const k = convKind(v.notes), key = v.contact_id + '|' + k
    if (seen.has(key)) continue; seen.add(key)
    if (['talk', 'na', 'vm', 'dial'].includes(k)) { m.dials++; ppl.add('c' + v.contact_id) }
    if (k === 'talk') m.connects++
    else if (k === 'vm') m.vm++
    else if (k === 'na') m.na++
    else if (k in m) m[k]++
    if (k === 'closed') { const f = String(v.notes).match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k)?/i); if (f) m.income += Number(f[1].replace(/,/g, '')) * (f[2] ? 1000 : 1) }
  }
  m.newc = S.contacts.filter(c => c.created_at && nyDay(c.created_at) === day).length
  m.people = ppl.size
  return m
}
function kpiSum(days) {
  const t = days.map(kpiDay).reduce((a, m) => { for (const k in m) a[k] = (a[k] || 0) + m[k]; return a }, {})
  t.rate = t.dials ? t.connects / t.dials : 0
  return t
}
const dayList = (start, n) => Array.from({ length: n }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return ymd(d) })
const pct = x => (x * 100).toFixed(x && x < .1 ? 1 : 0) + '%'
function kpiView() {
  const thisMon = monday(today())
  if (!KPI.week) KPI.week = thisMon
  const wk = KPI.week, earliest = new Date(Math.min(wk, thisMon)); earliest.setDate(earliest.getDate() - 7 * 7)
  loadKpiCalls(earliest)
  if (!KPI.calls) return el('div', { class: 'card empty', text: 'Loading your numbers…' })
  const days = dayList(wk, 7), weekDays = days.slice(0, 5)
  const tot = kpiSum(days)
  const prev = (() => { const d = new Date(wk); d.setDate(d.getDate() - 7); return kpiSum(dayList(d, 7)) })()
  const isThis = +wk === +thisMon
  const elapsed = isThis ? Math.min(5, Math.max(1, ((today().getDay() + 6) % 7) + 1)) : 5
  const fmtv = (k, v) => k === 'rate' ? pct(v || 0) : (v || 0).toLocaleString()
  // gold = game goal, green = target, yellow = floor, red = below floor (pro-rated by weekday for the current week)
  const status = (k, v) => {
    const g = WEEK_GOALS[k]; if (!g) return ''
    const f = isThis ? elapsed / 5 : 1
    return v >= g[2] * f ? 'game' : v >= g[1] * f ? 'hit' : v >= g[0] * f ? 'pace' : 'miss'
  }
  const cards = KPI_METRICS.filter(([k]) => !['na', 'listing'].includes(k)).map(([k, label]) => {
    const v = tot[k] || 0, st = status(k, v), d = (v - (prev[k] || 0))
    const drill = MEET_KINDS[k] ? () => openMeetingList(k, days, `${label} · week of ${fmt(ymd(wk), { month: 'short', day: 'numeric' })}`) : null
    return el('div', { class: 'kpi ' + st + (drill ? ' click' : ''), onclick: drill, title: drill ? 'Click to see who you met with' : null },
      el('div', { class: 'kpi-l', text: label + (drill ? '  ›' : '') }),
      el('div', { class: 'kpi-v', text: fmtv(k, v) }),
      el('div', { class: 'kpi-s' },
        WEEK_GOALS[k] ? el('span', { text: WEEK_GOALS[k].map((g, i) => `${TIER[i]} ${+g.toFixed(1)}`).join(' · ') }) : null,
        el('span', { class: 'muted', text: `${k === 'rate' ? (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + ' pts' : (d >= 0 ? '+' : '') + d} vs last wk` })))
  })
  const rowsDef = [['dials', 'Dials (working #s)'], ['total', 'Total dials (incl. bad #s)'], ['people', 'Owners dialed'], ['connects', 'Conversations'], ['rate', 'Contact rate'], ['vm', 'Voicemails'], ['na', 'No answer'], ['bad', 'Bad numbers'], ['mset', 'Meetings set'], ['mheld', 'Meetings held'], ['bov', 'Analyses delivered'], ['listing', 'Listings'], ['newc', 'New contacts'], ['texts', 'People texted'], ['textin', 'Text replies']]
  const perDay = weekDays.map(d => { const m = kpiDay(d); m.rate = m.dials ? m.connects / m.dials : 0; return m })
  const daily = el('table', { class: 'kpi-table' },
    el('thead', null, el('tr', null, el('th', { text: '' }), weekDays.map(d => el('th', { text: fmt(d, { weekday: 'short', month: 'numeric', day: 'numeric' }) })), el('th', { text: 'Week' }))),
    el('tbody', null, rowsDef.map(([k, label]) => el('tr', null, el('td', { text: label }), perDay.map(m => el('td', { text: m.dials || k !== 'rate' ? fmtv(k, m[k]) : '—' })), el('td', { class: 'tot', text: fmtv(k, tot[k]) })))))
  const weeks = Array.from({ length: 8 }, (_, i) => { const d = new Date(thisMon); d.setDate(d.getDate() - 7 * (7 - i)); return d })
  const wkTot = weeks.map(d => kpiSum(dayList(d, 7)))
  const trend = el('table', { class: 'kpi-table' },
    el('thead', null, el('tr', null, el('th', { text: 'Week of' }), weeks.map(d => el('th', { class: +d === +wk ? 'cur' : '', text: fmt(ymd(d), { month: 'short', day: 'numeric' }) })))),
    el('tbody', null, rowsDef.filter(([k]) => k !== 'na').map(([k, label]) => el('tr', null, el('td', { text: label }), wkTot.map((m, i) => el('td', { class: (+weeks[i] === +wk ? 'cur ' : '') + status(k, m[k]), text: fmtv(k, m[k]) }))))))
  const shift = n => { const d = new Date(KPI.week); d.setDate(d.getDate() + 7 * n); KPI.week = d; render({ soft: true }) }
  return el('div', null,
    el('div', { class: 'head' },
      el('div', null, el('h1', { text: 'KPIs' }), el('p', { class: 'muted', text: `Week of ${fmt(ymd(wk), LONG)}${isThis ? ' · this week' : ''}` })),
      el('div', { class: 'actions' },
        el('button', { class: 'btn small', onclick: () => shift(-1) }, '‹ Prev week'),
        !isThis ? el('button', { class: 'btn small', onclick: () => { KPI.week = thisMon; render({ soft: true }) } }, 'This week') : null,
        el('button', { class: 'btn small', disabled: isThis, onclick: () => shift(1) }, 'Next week ›'),
        el('button', { class: 'btn small ghost', onclick: openGoalYear }, 'Goal year'))),
    el('p', { class: 'muted', style: 'margin:-6px 0 12px;font-size:13px', text: `Gold = game · green = target · yellow = floor · red = below floor${isThis ? ` (paced for day ${elapsed} of 5)` : ''}` }),
    el('div', { class: 'kpi-grid' }, cards),
    yearSection(),
    el('div', { class: 'section-title', text: 'Day by day' }),
    el('div', { class: 'card', style: 'overflow-x:auto' }, daily),
    el('div', { class: 'section-title', text: 'Last 8 weeks' }),
    el('div', { class: 'card', style: 'overflow-x:auto' }, trend),
    el('p', { class: 'muted', style: 'font-size:12.5px;margin-top:10px', text: 'Counted automatically: every outcome you tap on the Prospects tab and every call you log on a contact. Log meetings held, strategic analyses, exclusives, contracts and closings with the milestone buttons on each contact.' }))
}
function openGoalYear() {
  const inp = el('input', { type: 'date', value: goalYearStart() })
  const form = el('form', { class: 'stack', onsubmit: e => { e.preventDefault(); try { localStorage.setItem('goalYearStart', inp.value) } catch { } ; closeDrawer(); render({ soft: true }) } },
    el('h2', { text: 'Goal year' }), el('p', { class: 'muted', text: 'Your annual goals are measured over 12 months starting on this date.' }),
    el('label', { class: 'f' }, 'Year starts', inp), el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Save')))
  DRAWER.kind = null; showDrawer(form)
}
function yearSection() {
  const start = parse(goalYearStart()), end = new Date(start); end.setFullYear(end.getFullYear() + 1); end.setDate(end.getDate() - 1)
  const T = today(), frac = Math.max(0, Math.min(1, (T - start) / (end - start + 864e5)))
  const ndays = Math.max(0, Math.min(Math.round((T - start) / 864e5) + 1, 366))
  const tot = kpiSum(dayList(start, ndays))
  const weeksIn = Math.max(1, ndays / 7)
  const fmtv = (k, v) => k === 'income' ? money(v) : (v || 0).toLocaleString()
  const rows = YEAR_GOALS.map(([k, label, g]) => {
    const v = tot[k] || 0, pace = g.map(x => x * frac)
    const st = v >= pace[2] ? 'game' : v >= pace[1] ? 'hit' : v >= pace[0] ? 'pace' : 'miss'
    const w = Math.min(100, v / g[2] * 100)
    const drill = MEET_KINDS[k] ? () => openMeetingList(k, dayList(start, ndays), `${label} · goal year so far`) : null
    return el('tr', { class: drill ? 'click' : null, onclick: drill },
      el('td', { text: label + (drill ? '  ›' : '') }),
      el('td', { class: 'tot ' + st, text: fmtv(k, v) }),
      g.map(x => el('td', { text: fmtv(k, x) })),
      el('td', null, el('div', { class: 'ybar' }, el('i', { style: `width:${w}%` }), g.map(x => el('b', { style: `left:${x / g[2] * 100}%` })))),
      el('td', { class: 'muted', text: v >= g[1] ? 'target hit' : `${fmtv(k, Math.ceil(g[1] - v))} to target` }))
  })
  const ltc = tot.listing ? tot.closed / tot.listing : null
  const avgFee = tot.closed ? tot.income / tot.closed : null
  const callsWk = tot.dials / weeksIn
  return el('div', null,
    el('div', { class: 'section-title', text: `Year goals · ${fmt(ymd(start), { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(ymd(end), { month: 'short', day: 'numeric', year: 'numeric' })} · ${Math.round(frac * 100)}% of the year gone` }),
    el('div', { class: 'card', style: 'overflow-x:auto' }, el('table', { class: 'kpi-table ytable' },
      el('thead', null, el('tr', null, ['', 'So far', 'Floor', 'Target', 'Game', 'Progress', ''].map(h => el('th', { text: h })))),
      el('tbody', null, rows,
        el('tr', null, el('td', { text: 'Calls per week (avg)' }), el('td', { class: 'tot ' + (callsWk >= 300 ? 'game' : callsWk >= 250 ? 'hit' : callsWk >= 200 ? 'pace' : 'miss'), text: Math.round(callsWk).toLocaleString() }), [200, 250, 300].map(x => el('td', { text: x })), el('td'), el('td')),
        el('tr', null, el('td', { text: 'Average net fee' }), el('td', { class: 'tot', text: avgFee ? money(avgFee) : '—' }), el('td', { text: '—' }), el('td', { text: money(20000) }), el('td', { text: money(20000) }), el('td'), el('td')),
        el('tr', null, el('td', { text: 'List-to-close ratio' }), el('td', { class: 'tot', text: ltc == null ? '—' : pct(ltc) }), [0, 1, 2].map(() => el('td', { text: '50%' })), el('td'), el('td'))))),
    el('p', { class: 'muted', style: 'font-size:12.5px', text: 'Colors compare where you are now with where each goal says you should be this far into the year.' }))
}
/* One-tap milestones on a contact (count toward KPIs, don't change the follow-up date) */
function milestoneBar(c) {
  const log = async (btn, label) => {
    let fee = ''
    if (label === 'Deal closed') { fee = prompt('Deal closed — your NET fee in dollars (e.g. 20000)', ''); if (fee === null) return; fee = fee.replace(/[^\d.]/g, '') }
    let extra = prompt(`${label} — add a note (optional)`, '')
    if (extra === null) return
    if (fee) extra = `net fee $${Number(fee).toLocaleString()}` + (extra.trim() ? ' — ' + extra.trim() : '')
    btn.disabled = true
    const { error } = await sb.from('conversations').insert({ contact_id: c.id, talked_on: ymd(today()), notes: label + (extra.trim() ? ' — ' + extra.trim() : '') })
    if (error) { toast(error.message); btn.disabled = false; return }
    if (label === 'Exclusive listing signed') for (const p of propsFor(c.id).filter(p => p.stage !== 'Dead')) await sb.from('properties').update({ stage: 'Listing', stage_updated_at: nowIso() }).eq('id', p.id)
    if (label === 'Strategic analysis delivered') for (const p of propsFor(c.id).filter(p => ['Prospect', 'Contacted', 'Meeting'].includes(p.stage))) await sb.from('properties').update({ stage: 'BOV', stage_updated_at: nowIso() }).eq('id', p.id)
    if (label === 'Contract signed') for (const p of propsFor(c.id).filter(p => p.stage === 'Listing')) await sb.from('properties').update({ stage: 'Under contract', stage_updated_at: nowIso() }).eq('id', p.id)
    if (label === 'Deal closed') for (const p of propsFor(c.id).filter(p => p.stage === 'Under contract')) await sb.from('properties').update({ stage: 'Closed', stage_updated_at: nowIso() }).eq('id', p.id)
    await Promise.all([loadTable('conversations'), loadTable('properties')])
    toast(label + ' logged'); render({ soft: true }); refreshDrawer(true)
  }
  return el('div', { class: 'milestones' },
    el('span', { class: 'muted', text: 'Milestones:' }),
    Object.values(KPI_KINDS).map(label => el('button', { class: 'btn small', onclick: e => log(e.currentTarget, label) }, '+ ' + label)))
}

/* ---------- Meetings (log meeting notes + KPI drill-down) ---------- */
const MEET_KINDS = { mheld: 'Meeting held', mset: 'Meeting set' }
// Every meeting conversation of a kind on the given days — deduped one per contact per day, same as the KPI count
function meetingsOf(kind, days) {
  const set = new Set(days), seen = new Set()
  return [...S.convos]
    .filter(v => set.has(v.talked_on) && convKind(v.notes) === kind)
    .sort((a, b) => String(b.talked_on).localeCompare(String(a.talked_on)) || b.id - a.id)
    .filter(v => { const key = v.contact_id + '|' + v.talked_on; if (seen.has(key)) return false; seen.add(key); return true })
}
// The contact's other notes from that meeting (anything else logged the same day), so the card shows the full story
const sameDayNotes = v => S.convos.filter(x => x.contact_id === v.contact_id && x.talked_on === v.talked_on && x.id !== v.id && !isText(x.notes))
function meetingCard(v, { kindLabel } = {}) {
  const c = contactById(v.contact_id)
  if (!c) return null
  const tel = telHref(c.phone), props = propsFor(c.id)
  return el('div', { class: 'card meetcard' },
    el('div', { class: 'mc-head' },
      el('span', { class: 'pri ' + (c.priority || 'C'), text: c.priority || 'C' }),
      el('div', { style: 'flex:1;min-width:0' },
        el('div', { class: 'name' }, el('b', { text: c.name }), c.contact_type ? el('span', { class: 'tag ' + c.contact_type, text: c.contact_type }) : null),
        el('div', { class: 'muted', style: 'font-size:13px', text: [c.company, fmt(v.talked_on, LONG) + (kindLabel ? ' · ' + kindLabel : '')].filter(Boolean).join(' · ') })),
      tel ? el('a', { class: 'btn small', href: tel, text: c.phone }) : null),
    v.property_id && propLabel(v.property_id) ? el('div', { style: 'margin-top:8px' }, el('span', { class: 'retag', text: '🏢 Re: ' + propLabel(v.property_id) })) : null,
    props.length ? el('div', { class: 'mc-props' }, props.map(p => el('a', { class: 'chip' + (String(p.id) === String(v.property_id) ? ' on' : ''), onclick: () => openProperty(p.id) }, `${p.address || p.name}${p.stage ? ' · ' + p.stage : ''}`))) : null,
    el('div', { class: 'mc-notes', text: v.notes }),
    sameDayNotes(v).map(x => el('div', { class: 'mc-notes extra', text: x.notes })),
    c.next_follow_up ? el('div', { class: 'muted', style: 'font-size:13px;margin-top:8px', text: `Next: ${fmt(c.next_follow_up, LONG)}${c.next_time ? ' · ' + fmtTime(c.next_time) : ''}${c.next_note ? ' — ' + c.next_note : ''}` }) : null,
    el('div', { class: 'actions', style: 'margin-top:10px' },
      el('button', { class: 'btn small primary', onclick: () => openContact(c.id) }, 'Open contact card'),
      el('button', { class: 'btn small', onclick: () => openMeetingForm({ contactId: c.id }) }, '+ Add meeting notes')))
}
// Drawer opened from a KPI: everyone you met with in that period, with their card and the meeting notes
function openMeetingList(kind, days, title) {
  const rows = meetingsOf(kind, days)
  DRAWER.kind = 'meetings'; DRAWER.id = null
  showDrawer(el('div', null,
    el('h2', { text: title }),
    el('p', { class: 'muted', text: rows.length ? `${rows.length} ${rows.length === 1 ? 'person' : 'people'}` : 'No meetings logged in this period.' }),
    el('div', { class: 'stack' }, rows.map(v => meetingCard(v)))))
}
function meetingsView() {
  const T = ymd(today())
  const upcoming = S.contacts.filter(c => c.next_follow_up && c.next_follow_up >= T && /^meeting/i.test(c.next_note || '')).sort(byWhen)
  const all = [...S.convos].filter(v => ['mheld', 'mset'].includes(convKind(v.notes)))
  const days = [...new Set(all.map(v => v.talked_on))]
  const held = meetingsOf('mheld', days), set = meetingsOf('mset', days)
  const [tab, setTab] = [S.meetTab || 'held', t => { S.meetTab = t; render({ soft: true }) }]
  const list = tab === 'held' ? held : set
  return el('div', null,
    el('div', { class: 'head' },
      el('div', null, el('h1', { text: 'Meetings' }), el('p', { class: 'muted', text: `${held.length} held · ${set.length} set · ${upcoming.length} coming up` })),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: () => openMeetingForm({}) }, '+ Log meeting'))),
    el('div', { class: 'section-title', text: `Coming up (${upcoming.length})` }),
    el('div', { class: 'card' }, upcoming.length ? el('ul', { class: 'list' }, upcoming.map(c => contactRow(c))) : el('div', { class: 'empty', text: 'No meetings on the books.' })),
    el('div', { class: 'filters', style: 'margin-top:18px' },
      el('button', { class: 'chip' + (tab === 'held' ? ' on' : ''), onclick: () => setTab('held') }, `Meetings held (${held.length})`),
      el('button', { class: 'chip' + (tab === 'set' ? ' on' : ''), onclick: () => setTab('set') }, `Meetings set (${set.length})`)),
    el('div', { class: 'stack', style: 'margin-top:10px' }, list.length ? list.map(v => meetingCard(v)) : el('div', { class: 'card empty', text: 'Nothing logged yet — tap “+ Log meeting”.' })))
}
function openMeetingForm({ contactId } = {}) {
  const T = today()
  const who = contactSelect(contactId || '')
  who.firstChild.textContent = '— Pick who you met with —'
  const kind = el('select', null, el('option', { value: 'held', text: 'Meeting held (I met with them)' }), el('option', { value: 'set', text: 'Meeting set (booked for later)' }))
  const date = el('input', { type: 'date', value: ymd(T) })
  const time = el('input', { type: 'time' })
  const where = el('input', { placeholder: 'At the property, their office, Zoom…' })
  const aboutWrap = el('label', { class: 'f' }, 'Meeting is about')
  let about = propertyPicker(contactId || '')
  aboutWrap.append(about)
  const syncAbout = () => { const n = propertyPicker(who.value); about.replaceWith(n); about = n; aboutWrap.classList.toggle('hidden', !propsFor(who.value).length) }
  who.addEventListener('change', syncAbout)
  if (!propsFor(contactId || '').length) aboutWrap.classList.add('hidden')
  const notes = el('textarea', { rows: 7, placeholder: 'What you learned — goals, timing, debt, tenants, other buildings, buy box, rapport notes…' })
  const nextDate = el('input', { type: 'date', value: ymd(addBusinessDays(T, 2)) })
  const nextTime = el('input', { type: 'time' })
  const nextStep = el('input', { placeholder: 'e.g. Deliver strategic analysis of the building' })
  const pri = el('select', null, el('option', { value: '', text: 'Keep current' }), ['A', 'B', 'C'].map(p => el('option', { value: p, text: p })))
  const dateLbl = el('span', { text: 'Date you met' })
  const nextBox = el('div', { class: 'stack' },
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Follow-up date', nextDate), el('label', { class: 'f' }, 'Time (optional)', nextTime)),
    el('label', { class: 'f' }, 'Next step', nextStep))
  kind.onchange = () => {
    const isSet = kind.value === 'set'
    dateLbl.textContent = isSet ? 'Meeting date' : 'Date you met'
    if (isSet && date.value === ymd(T)) date.value = ymd(addBusinessDays(T, 2))
    nextBox.classList.toggle('hidden', isSet)
  }
  const err = el('div', { class: 'err' })
  const save = el('button', { class: 'btn primary', type: 'submit' }, 'Save meeting')
  const form = el('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault()
    const c = contactById(who.value)
    if (!c) { err.textContent = 'Pick who you met with.'; return }
    const isSet = kind.value === 'set'
    if (!isSet && !notes.value.trim()) { err.textContent = 'Add your notes from the meeting.'; return }
    save.disabled = true; err.textContent = ''
    const t = time.value ? ' at ' + fmtTime(time.value) : ''
    const place = where.value.trim() ? ' — ' + where.value.trim() : ''
    const body = notes.value.trim() ? ' — ' + notes.value.trim() : ''
    try {
      if (isSet) {
        const when = `${fmt(date.value, { weekday: 'short', month: 'short', day: 'numeric' })}${t}${place}`
        await logCall(c, { note: 'Meeting set for ' + when + body, talked: ymd(T), priority: pri.value || c.priority || 'C', next: date.value, nextTime: time.value || null, nextNote: 'MEETING ' + when, meeting: true, propertyId: about.value || null })
      } else {
        await logCall(c, { note: 'Meeting held' + place + body, talked: date.value, priority: pri.value || c.priority || 'C', next: nextDate.value || null, nextTime: nextTime.value || null, nextNote: nextStep.value.trim() || 'Follow up from meeting ' + fmt(date.value), meeting: true, propertyId: about.value || null })
      }
      toast(isSet ? 'Meeting set' : 'Meeting logged'); closeDrawer(); render({ soft: true })
    } catch (x) { err.textContent = 'Couldn’t save: ' + (x.message || x); save.disabled = false }
  } },
    el('h2', { text: 'Log a meeting' }),
    el('label', { class: 'f' }, 'Who', who),
    el('label', { class: 'f' }, 'Type', kind),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, dateLbl, date), el('label', { class: 'f' }, 'Time (optional)', time)),
    el('label', { class: 'f' }, 'Where', where),
    aboutWrap,
    el('label', { class: 'f' }, 'Meeting notes', notes),
    el('label', { class: 'f' }, 'Priority', pri),
    nextBox, err, el('div', { class: 'actions' }, save))
  DRAWER.kind = 'meetform'; DRAWER.id = null
  showDrawer(form)
}


/* ---------- Notes (general notes when you didn't talk — never counted as a call) ---------- */
const isNote = n => /^note:/i.test(String(n || '').trim())
const noteBody = n => String(n || '').trim().replace(/^note:\s*/i, '')
// A note + optional new follow-up. Doesn't touch "last talked" or priority, and doesn't count toward call KPIs.
function noteForm(c, { hidden, onDone } = {}) {
  const who = c ? null : contactSelect('')
  if (who) who.firstChild.textContent = '— Pick a contact —'
  const date = el('input', { type: 'date', value: ymd(today()), oninput: markDirty })
  const text = el('textarea', { rows: 4, placeholder: 'Anything worth remembering — drove by the building, saw a listing, sent a mailer, heard he’s traveling…', oninput: markDirty })
  const cur = () => c || contactById(who?.value)
  const fDate = el('input', { type: 'date', value: c?.next_follow_up || '', oninput: markDirty })
  const fTime = el('input', { type: 'time', value: c?.next_time ? String(c.next_time).slice(0, 5) : '', oninput: markDirty })
  const fStep = el('input', { placeholder: 'What to do that day', value: c?.next_note || '', oninput: markDirty })
  if (who) who.onchange = () => { const x = cur(); fDate.value = x?.next_follow_up || ''; fTime.value = x?.next_time ? String(x.next_time).slice(0, 5) : ''; fStep.value = x?.next_note || '' }
  const err = el('div', { class: 'err' })
  const save = el('button', { class: 'btn primary', type: 'button' }, 'Save note')
  save.onclick = async () => {
    const x = cur()
    if (!x) { err.textContent = 'Pick a contact.'; return }
    if (!text.value.trim()) { err.textContent = 'Write the note.'; return }
    save.disabled = true; err.textContent = ''
    try {
      const { error } = await sb.from('conversations').insert({ contact_id: x.id, talked_on: date.value || ymd(today()), notes: 'Note: ' + text.value.trim() })
      if (error) throw error
      const patch = {}
      if ((fDate.value || null) !== (x.next_follow_up || null)) patch.next_follow_up = fDate.value || null
      if ((fTime.value || null) !== (x.next_time ? String(x.next_time).slice(0, 5) : null)) patch.next_time = fTime.value || null
      if (fStep.value.trim() !== (x.next_note || '')) patch.next_note = fStep.value.trim() || null
      if (Object.keys(patch).length) { patch.updated_at = nowIso(); const { error: e2 } = await sb.from('contacts').update(patch).eq('id', x.id); if (e2) throw e2 }
      await Promise.all([loadTable('conversations'), Object.keys(patch).length ? loadTable('contacts') : null])
      toast('Note saved' + (patch.next_follow_up ? ` · follow-up ${fmt(patch.next_follow_up, { weekday: 'short', month: 'short', day: 'numeric' })}` : ''))
      if (onDone) onDone(); else { render({ soft: true }); refreshDrawer(true) }
    } catch (x2) { err.textContent = 'Couldn’t save: ' + (x2.message || x2); save.disabled = false }
  }
  return el('div', { class: 'stack' + (hidden ? ' hidden' : '') },
    who ? el('label', { class: 'f' }, 'Contact', who) : null,
    el('label', { class: 'f' }, 'Date', date),
    el('label', { class: 'f' }, 'Note', text),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Follow-up date (change to move it)', fDate), el('label', { class: 'f' }, 'Time (blank = first call block)', fTime)),
    el('label', { class: 'f' }, 'Next step', fStep),
    el('p', { class: 'muted', style: 'font-size:12.5px;margin:0', text: 'Notes don’t count as a call and don’t change “last talked.”' }),
    err, el('div', { class: 'actions' }, save))
}
function openNoteForm() {
  DRAWER.kind = 'noteform'; DRAWER.id = null
  showDrawer(el('div', { class: 'stack' }, el('h2', { text: 'Add a note' }), noteForm(null, { onDone: () => { closeDrawer(); render({ soft: true }) } })))
}
function notesView() {
  const q = (S.noteQ || '').toLowerCase()
  const all = S.convos.filter(v => isNote(v.notes)).sort((a, b) => String(b.talked_on).localeCompare(String(a.talked_on)) || b.id - a.id)
  const rows = all.filter(v => { if (!q) return true; const c = contactById(v.contact_id); return (noteBody(v.notes) + ' ' + (c?.name || '') + ' ' + (c?.address || '')).toLowerCase().includes(q) })
  return el('div', null,
    el('div', { class: 'head' },
      el('div', null, el('h1', { text: 'Notes' }), el('p', { class: 'muted', text: `${all.length} note${all.length === 1 ? '' : 's'} · general notes when you didn’t talk to them` })),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: openNoteForm }, '+ Add note'))),
    el('input', { class: 'search', placeholder: 'Search notes or names…', value: S.noteQ || '', 'data-keep': 'noteq', oninput: e => { S.noteQ = e.target.value; render({ soft: true }) } }),
    el('div', { class: 'card', style: 'margin-top:10px' }, rows.length ? el('ul', { class: 'list' }, rows.map(v => {
      const c = contactById(v.contact_id)
      return el('li', { class: 'item', onclick: () => c && openContact(c.id) },
        el('span', { class: 'pri ' + (c?.priority || 'C'), text: c?.priority || 'C' }),
        el('div', { class: 'who' },
          el('div', { class: 'name', text: c?.name || v.contact_id }),
          el('div', { class: 'sub', style: 'white-space:normal', text: noteBody(v.notes) })),
        el('div', { class: 'when' }, fmt(v.talked_on, { month: 'short', day: 'numeric' }),
          c?.next_follow_up ? el('div', { class: 'muted', style: 'font-size:12px', text: 'Next ' + fmt(c.next_follow_up, { month: 'short', day: 'numeric' }) }) : null))
    })) : el('div', { class: 'empty', text: q ? 'No notes match.' : 'No notes yet — tap “+ Add note”, or use “Add a note” on any contact card.' })))
}


/* Follow-up on a prospect card — for a good conversation where you want to call back on a set day (stays a prospect) */
function prospectFollowUp(r) {
  const has = !!(r.callback_note || r.callback_time)
  const date = el('input', { type: 'date', value: has ? r.next_attempt_on : ymd(addBusinessDays(today(), 2)) })
  const time = el('input', { type: 'time', value: r.callback_time ? String(r.callback_time).slice(0, 5) : '' })
  const what = el('input', { placeholder: 'What to do — e.g. call back after he talks to his partner', value: r.callback_note || '' })
  const err = el('div', { class: 'err' })
  const save = el('button', { class: 'btn primary small', type: 'button' }, has ? 'Update follow-up' : 'Set follow-up')
  save.onclick = async () => {
    if (!date.value) { err.textContent = 'Pick a date.'; return }
    save.disabled = true; err.textContent = ''
    const patch = { next_attempt_on: date.value, callback_time: time.value || null, callback_note: what.value.trim() || 'Follow up', updated_at: nowIso() }
    if (['New', 'Bad data'].includes(r.status)) patch.status = 'Attempted'
    const { error } = await sb.from('prospects').update(patch).eq('id', r.id)
    if (error) { err.textContent = error.message; save.disabled = false; return }
    toast(`Follow-up set for ${fmt(date.value, { weekday: 'short', month: 'short', day: 'numeric' })}${time.value ? ' at ' + fmtTime(time.value) : ''}`)
    refreshProspects(); openProspect(r.id)
  }
  const clear = has ? el('button', { class: 'btn small ghost', type: 'button', onclick: async e => {
    e.currentTarget.disabled = true
    const { error } = await sb.from('prospects').update({ callback_time: null, callback_note: null, updated_at: nowIso() }).eq('id', r.id)
    if (error) { toast(error.message); return }
    toast('Follow-up cleared'); refreshProspects(); openProspect(r.id)
  } }, 'Clear') : null
  return el('div', { class: 'box stack', style: 'margin-top:14px' },
    el('h4', { style: 'margin:0', text: has ? '📅 Follow-up' : '📅 Good conversation? Set a follow-up' }),
    el('div', { class: 'row2' }, el('label', { class: 'f' }, 'Date', date), el('label', { class: 'f' }, 'Time (optional)', time)),
    el('label', { class: 'f' }, 'Next step', what),
    el('p', { class: 'muted', style: 'font-size:12.5px;margin:0', text: 'They stay on your prospect list and jump to the top of “To call” that day. Use “Talked ✓” instead to make them a contact.' }),
    err, el('div', { class: 'actions' }, save, clear))
}


/* Delete a prospect (and its numbers). Past dials stay in the call log so KPIs don't change. */
async function deleteProspect(r, btn) {
  const n = (r.prospect_phones || []).length
  if (!confirm(`Delete ${r.owner_name} from your prospect list?\n\nThis removes them and their ${n} number${n === 1 ? '' : 's'} from every building they're on. Calls you already made still count in your KPIs. This can't be undone.`)) return
  btn.disabled = true
  const left = BCTX.b ? bPeople(BCTX.b).filter(x => x.id !== r.id && x.status !== 'Removed') : []
  const { error } = await sb.from('prospects').delete().eq('id', r.id)
  if (error) { toast('Couldn’t delete: ' + error.message); btn.disabled = false; return }
  if (left.length) { toast(`${r.owner_name} deleted`); refreshProspects(); openBuilding(BCTX.id, { back: true }) }
  else goNextProspect(null, `${r.owner_name} deleted`)
}


/* Co-owners: other owners/managers on this contact's buildings (from the prospect list), shown apart from the contact */
const COOWN = {}
function coOwnersSection(c) {
  const props = propsFor(c.id)
  if (!props.length) return null
  const key = c.id + '|' + props.map(p => p.id).join(',')
  const cache = COOWN[c.id]
  if (!cache || cache.key !== key) {
    COOWN[c.id] = { key, rows: null }
    const keys = [...new Set(props.map(p => bkeyOf(p.address, p.city)))]
    sb.from('prospect_buildings').select('id, address, city, property_name, prospect_building_people(role, verified, prospects(id, owner_name, title, company, status, converted_contact_id, prospect_phones(phone, status)))').in('bkey', keys)
      .then(({ data }) => { if (COOWN[c.id]?.key !== key) return; COOWN[c.id].rows = data || []; if (DRAWER.kind === 'contact' && DRAWER.id === c.id) refreshDrawer() })
    return null
  }
  if (!cache.rows) return null
  const items = []
  for (const b of cache.rows) for (const x of b.prospect_building_people || []) {
    const r = x.prospects
    if (!r || r.converted_contact_id === c.id || r.status === 'Removed') continue
    items.push({ b, r, role: x.role, verified: x.verified })
  }
  if (!items.length) return null
  return el('div', { class: 'coowners' },
    el('div', { class: 'section-title', style: 'margin-top:0', text: `Co-owners & managers (${items.length})` }),
    el('p', { class: 'muted', style: 'font-size:12.5px;margin:0 0 4px', text: `Other people on ${c.name.split(' ')[0]}’s buildings — not ${c.name.split(' ')[0]}.` }),
    items.map(({ b, r, role, verified }) => {
      const live = (r.prospect_phones || []).filter(p => !PHONE_BAD.includes(p.status))
      return el('div', { class: 'coowner' },
        el('div', { class: 'ph-head' }, el('span', { class: 'cotag', text: 'Co-owner' }), el('b', { text: r.owner_name }), r.title || role ? el('span', { class: 'muted', text: r.title || role }) : null, verifyTag(verified),
          r.status === 'Converted' ? el('span', { class: 'ptag converted', text: 'Contact' }) : el('span', { class: 'ptag ' + slug(r.status), text: r.status })),
        el('div', { class: 'muted', style: 'font-size:12.5px', text: '🏢 ' + [bTitle(b), b.city].filter(Boolean).join(', ') + (r.company ? ' · ' + r.company : '') }),
        live.length ? el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:4px' }, live.map(p => el('a', { class: 'tel', href: telHref(p.phone), text: p.phone }))) : el('div', { class: 'muted', style: 'font-size:12.5px', text: 'No working numbers' }),
        el('div', { class: 'actions', style: 'margin-top:6px' },
          r.status === 'Converted' && r.converted_contact_id ? el('button', { class: 'btn small', onclick: () => openContact(r.converted_contact_id) }, 'Open their contact card') : el('button', { class: 'btn small', onclick: () => { go('prospects'); openBuilding(b.id) } }, 'Call from the building card')))
    }))
}

boot()
