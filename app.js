const $ = s => document.querySelector(s)
const $$ = s => Array.from(document.querySelectorAll(s))
const state = { ready: false }
const stores = { invoices: 'invoices', inventory: 'inventory', receipts: 'receipts', customers: 'customers', settings: 'settings', assets: 'assets' }
const buckets = { inventory: 'inventory', receipts: 'receipts' }
let db
async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kleingewerbe-db', 2)
    req.onupgradeneeded = e => {
      const d = e.target.result
      if (!d.objectStoreNames.contains(stores.invoices)) d.createObjectStore(stores.invoices, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(stores.inventory)) d.createObjectStore(stores.inventory, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(stores.receipts)) d.createObjectStore(stores.receipts, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(stores.customers)) d.createObjectStore(stores.customers, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(stores.settings)) d.createObjectStore(stores.settings, { keyPath: 'key' })
      if (!d.objectStoreNames.contains(stores.assets)) d.createObjectStore(stores.assets, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const s = t.objectStore(store)
    const r = fn(s)
    t.oncomplete = () => resolve(r)
    t.onerror = () => reject(t.error)
  })
}
async function put(store, val) { return tx(store, 'readwrite', s => s.put(val)) }
async function getAll(store) { return new Promise((resolve, reject) => {
  const t = db.transaction(store, 'readonly')
  const s = t.objectStore(store)
  const req = s.getAll()
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
}) }
async function del(store, key) { return tx(store, 'readwrite', s => s.delete(key)) }
function uid() { return Math.random().toString(36).slice(2) }
function fmtMoney(n) { return Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n || 0) }
let sbClient
async function getSupabase() {
  if (sbClient) return sbClient
  const url = await getSetting('sbUrl')
  const key = await getSetting('sbKey')
  if (!url || !key) return null
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
  sbClient = createClient(url, key)
  return sbClient
}
function projectFolderName() {
  const el = document.querySelector('#sb-project')
  const p = (el && el.value ? el.value : (typeof window !== 'undefined' ? 'Rechnung Katha' : 'rechnung-katha'))
  return (p || 'Rechnung Katha').toLowerCase().replace(/\s+/g, '-')
}
async function uploadToBucket(bucket, path, blob) {
  const s = await getSupabase()
  if (!s || !blob) return null
  const full = projectFolderName() + '/' + path
  const { error } = await s.storage.from(bucket).upload(full, blob, { upsert: true })
  if (error) return null
  const { data } = s.storage.from(bucket).getPublicUrl(full)
  return data.publicUrl
}
async function uploadWithInfo(bucket, path, blob) {
  const s = await getSupabase()
  if (!s || !blob) return { url: null, error: 'Client oder Datei fehlt' }
  const full = projectFolderName() + '/' + path
  const res = await s.storage.from(bucket).upload(full, blob, { upsert: true })
  if (res.error) return { url: null, error: res.error.message }
  const pub = s.storage.from(bucket).getPublicUrl(full)
  return { url: pub.data.publicUrl, error: null }
}
async function testSupabase() {
  const s = await getSupabase()
  const el = document.querySelector('#sb-status')
  if (!el) return
  if (!s) { el.textContent = 'Nicht konfiguriert'; return }
  const url = await getSetting('sbUrl')
  const key = await getSetting('sbKey')
  const refHost = new URL(url).hostname.split('.')[0]
  const payload = decodeJwt(key)
  if (!payload) { el.textContent = 'Ungültiger Key'; return }
  if (payload.ref && payload.ref !== refHost) {
    el.textContent = 'Key gehört zu anderem Projekt (' + payload.ref + ')'
    return
  }
  const blob = new Blob(['ok'], { type: 'text/plain' })
  const res = await uploadWithInfo(buckets.inventory, 'health/ping.txt', blob)
  if (res.url) el.textContent = 'Verbunden'
  else {
    const msg = (res.error || '').toLowerCase()
    if (msg.includes('not found')) el.textContent = 'Bucket inventory fehlt oder keine Rechte'
    else if (msg.includes('permission')) el.textContent = 'Keine Insert-Rechte (Policy)'
    else if (msg.includes('row-level') || msg.includes('rls')) el.textContent = 'RLS blockiert Insert – Policies setzen'
    else if (msg.includes('signature')) el.textContent = 'Key ungültig (signature verification failed)'
    else el.textContent = 'Fehler: ' + (res.error || 'Unbekannt')
  }
}
function decodeJwt(token) {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    }).join(''))
    return JSON.parse(jsonPayload)
  } catch { return null }
}
function show(id) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id))
  $$('.view').forEach(v => v.classList.toggle('visible', v.id === 'view-' + id))
  location.hash = id
}
function modal(content) {
  const m = $('#modal')
  m.innerHTML = ''
  const sheet = document.createElement('div')
  sheet.className = 'sheet'
  sheet.appendChild(content)
  m.classList.remove('hidden')
  m.appendChild(sheet)
  m.onclick = e => { if (e.target === m) m.classList.add('hidden') }
}
function invoiceRow(inv) {
  const el = document.createElement('div')
  el.className = 'row'
  const t = document.createElement('div')
  t.className = 'title'
  t.textContent = inv.customer + ' • ' + fmtMoney(inv.total)
  const a = document.createElement('div')
  const p = document.createElement('button')
  p.textContent = 'Drucken'
  p.onclick = () => printInvoice(inv)
  const dBtn = document.createElement('button')
  dBtn.textContent = 'Löschen'
  dBtn.onclick = async () => { await del(stores.invoices, inv.id); await renderInvoices() }
  a.append(p, dBtn)
  el.append(t, a)
  return el
}
async function renderInvoices() {
  const list = $('#invoice-list')
  const items = await getAll(stores.invoices)
  list.innerHTML = ''
  items.sort((a,b)=>b.date-a.date).forEach(i => list.appendChild(invoiceRow(i)))
}
async function renderInventory() {
  const list = $('#inventory-list')
  const items = await getAll(stores.inventory)
  list.innerHTML = ''
  items.sort((a,b)=>a.name.localeCompare(b.name)).forEach(it => {
    const el = document.createElement('div')
    el.className = 'row'
    const img = document.createElement('img')
    img.className = 'avatar'
    if (it.photo) img.src = URL.createObjectURL(it.photo)
    else if (it.photoUrl) img.src = it.photoUrl
    const t = document.createElement('div')
    t.className = 'title'
    t.textContent = it.name + ' • ' + it.stock + ' • ' + fmtMoney(it.price)
    const a = document.createElement('div')
    const eBtn = document.createElement('button')
    eBtn.textContent = 'Bearbeiten'
    eBtn.onclick = () => editItem(it)
    const dBtn = document.createElement('button')
    dBtn.textContent = 'Löschen'
    dBtn.onclick = async () => { await del(stores.inventory, it.id); await renderInventory() }
    a.append(eBtn, dBtn)
    el.append(img, t, a)
    list.appendChild(el)
  })
}
async function renderReceipts() {
  const grid = $('#receipts-grid')
  const items = await getAll(stores.receipts)
  grid.innerHTML = ''
  items.sort((a,b)=>b.date-a.date).forEach(r => {
    const card = document.createElement('div')
    card.className = 'thumb'
    const img = document.createElement('img')
    img.src = r.blob ? URL.createObjectURL(r.blob) : (r.imageUrl || '')
    const bar = document.createElement('div')
    bar.className = 'row'
    const t = document.createElement('div')
    t.textContent = r.vendor + ' • ' + fmtMoney(r.amount)
    const dBtn = document.createElement('button')
    dBtn.textContent = 'Löschen'
    dBtn.onclick = async () => { await del(stores.receipts, r.id); await renderReceipts() }
    bar.append(t, dBtn)
    card.append(img, bar)
    grid.appendChild(card)
  })
}
function newInvoiceForm() {
  const wrap = document.createElement('div')
  const h = document.createElement('h2')
  h.textContent = 'Neue Rechnung'
  const customer = customerField()
  const date = field('Datum', 'date')
  date.querySelector('input').valueAsDate = new Date()
  const itemsWrap = document.createElement('div')
  itemsWrap.className = 'field'
  const label = document.createElement('label')
  label.textContent = 'Positionen'
  const itemsList = document.createElement('div')
  itemsList.className = 'list'
  const addRowBtn = document.createElement('button')
  addRowBtn.textContent = 'Position hinzufügen'
  addRowBtn.onclick = () => addInvoiceRow(itemsList)
  const totalRow = document.createElement('div')
  totalRow.className = 'row'
  const tv = document.createElement('div')
  tv.className = 'title'
  tv.textContent = 'Summe'
  const tval = document.createElement('div')
  tval.id = 'invoice-total'
  totalRow.append(tv, tval)
  const actions = document.createElement('div')
  actions.className = 'toolbar'
  const save = document.createElement('button')
  save.className = 'primary'
  save.textContent = 'Speichern'
  save.onclick = async () => {
    const inv = await buildInvoice(customer, date, itemsList)
    await put(stores.invoices, inv)
    for (const it of inv.items) {
      const cur = await new Promise((resolve, reject) => {
        const t = db.transaction(stores.inventory, 'readonly')
        const s = t.objectStore(stores.inventory)
        const req = s.get(it.id)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      if (cur) {
        const ns = Math.max(0, (+cur.stock || 0) - it.qty)
        await put(stores.inventory, { ...cur, stock: ns })
      }
    }
    await renderInvoices()
    $('#modal').classList.add('hidden')
  }
  actions.append(save)
  itemsWrap.append(label, itemsList, addRowBtn)
  wrap.append(h, customer, date, itemsWrap, totalRow, actions)
  return wrap
}
function field(name, type, opts={}) {
  const f = document.createElement('div')
  f.className = 'field'
  const l = document.createElement('label')
  l.textContent = name
  const i = document.createElement(type==='textarea'?'textarea':'input')
  i.type = type
  if (opts.placeholder) i.placeholder = opts.placeholder
  f.append(l, i)
  return f
}
function imagePicker(initialBlob) {
  const f = document.createElement('div')
  f.className = 'field'
  const l = document.createElement('label')
  l.textContent = 'Foto'
  const i = document.createElement('input')
  i.type = 'file'
  i.accept = 'image/*'
  i.capture = 'environment'
  const preview = document.createElement('div')
  preview.className = 'thumb'
  preview.style.maxWidth = '120px'
  let blob = initialBlob || null
  const render = () => {
    preview.innerHTML = ''
    if (!blob) return
    const img = document.createElement('img')
    img.src = URL.createObjectURL(blob)
    preview.appendChild(img)
  }
  render()
  i.onchange = async e => {
    const f0 = e.target.files[0]
    if (!f0) return
    blob = await f0.arrayBuffer().then(b => new Blob([b], { type: f0.type }))
    render()
  }
  f.append(l, i, preview)
  f.getBlob = () => blob
  return f
}
async function addInvoiceRow(listEl) {
  const invItems = await getAll(stores.inventory)
  const row = document.createElement('div')
  row.className = 'grid-2'
  const sel = document.createElement('select')
  const qty = document.createElement('input')
  qty.type = 'number'
  qty.min = '1'
  qty.value = '1'
  invItems.forEach(it => {
    const o = document.createElement('option')
    o.value = it.id
    o.textContent = it.name + ' • ' + fmtMoney(it.price)
    sel.appendChild(o)
  })
  const price = document.createElement('input')
  price.type = 'number'
  price.step = '0.01'
  const total = document.createElement('div')
  total.className = 'row'
  const t = document.createElement('div')
  t.className = 'title'
  t.textContent = 'Zwischensumme'
  const tv = document.createElement('div')
  row.append(sel, qty)
  listEl.appendChild(row)
  const update = () => {
    const item = invItems.find(i => i.id === sel.value)
    price.value = item ? item.price : 0
    const sub = (+qty.value || 0) * (+price.value || 0)
    tv.textContent = fmtMoney(sub)
    const sum = Array.from(listEl.querySelectorAll('.grid-2')).reduce((acc, r) => {
      const q = +r.children[1].value || 0
      const id = r.children[0].value
      const it = invItems.find(i => i.id === id)
      const pr = it ? +it.price : 0
      return acc + q * pr
    }, 0)
    $('#invoice-total').textContent = fmtMoney(sum)
  }
  sel.onchange = update
  qty.oninput = update
  update()
}
async function buildInvoice(customerField, dateField, listEl) {
  const items = []
  const invItems = await getAll(stores.inventory)
  Array.from(listEl.querySelectorAll('.grid-2')).forEach(r => {
    const id = r.children[0].value
    const qty = +r.children[1].value || 0
    const found = invItems.find(i => i.id === id)
    const price = found ? +found.price : 0
    const name = found ? found.name : id
    items.push({ id, name, qty, price, total: qty * price })
  })
  const custSel = customerField.querySelector('select')
  const custName = custSel ? custSel.selectedOptions[0].textContent : customerField.querySelector('input').value.trim()
  const inv = { id: uid(), customer: custName.trim(), date: dateField.querySelector('input').valueAsNumber || Date.now(), items, total: items.reduce((acc, it) => acc + it.total, 0) }
  return inv
}
async function editItem(item) {
  const wrap = document.createElement('div')
  const h = document.createElement('h2')
  h.textContent = 'Artikel'
  const name = field('Name', 'text')
  name.querySelector('input').value = item.name
  const price = field('Preis EUR', 'number')
  price.querySelector('input').step = '0.01'
  price.querySelector('input').value = item.price
  const stock = field('Bestand', 'number')
  stock.querySelector('input').value = item.stock
  const photoPicker = imagePicker(item.photo)
  const actions = document.createElement('div')
  actions.className = 'toolbar'
  const save = document.createElement('button')
  save.className = 'primary'
  save.textContent = 'Speichern'
  save.onclick = async () => {
    const it = { id: item.id, name: name.querySelector('input').value.trim(), price: +price.querySelector('input').value || 0, stock: +stock.querySelector('input').value || 0, photo: photoPicker.getBlob() }
    await put(stores.inventory, it)
    const url = await uploadToBucket(buckets.inventory, 'items/' + it.id + '.jpg', it.photo)
    if (url) await put(stores.inventory, { ...it, photoUrl: url })
    $('#modal').classList.add('hidden')
    await renderInventory()
  }
  actions.append(save)
  wrap.append(h, name, price, stock, photoPicker, actions)
  modal(wrap)
}
function newItemForm() {
  const wrap = document.createElement('div')
  const h = document.createElement('h2')
  h.textContent = 'Neuer Artikel'
  const name = field('Name', 'text')
  const price = field('Preis EUR', 'number')
  price.querySelector('input').step = '0.01'
  const stock = field('Bestand', 'number')
  const photoPicker = imagePicker()
  const actions = document.createElement('div')
  actions.className = 'toolbar'
  const save = document.createElement('button')
  save.className = 'primary'
  save.textContent = 'Speichern'
  save.onclick = async () => {
    const it = { id: uid(), name: name.querySelector('input').value.trim(), price: +price.querySelector('input').value || 0, stock: +stock.querySelector('input').value || 0, photo: photoPicker.getBlob() }
    await put(stores.inventory, it)
    const url = await uploadToBucket(buckets.inventory, 'items/' + it.id + '.jpg', it.photo)
    if (url) await put(stores.inventory, { ...it, photoUrl: url })
    $('#modal').classList.add('hidden')
    await renderInventory()
  }
  actions.append(save)
  wrap.append(h, name, price, stock, photoPicker, actions)
  return wrap
}
function newReceipt() {
  $('#receipt-input').click()
}
async function handleReceiptFile(file) {
  const imgBlob = await file.arrayBuffer().then(b => new Blob([b], { type: file.type }))
  const wrap = document.createElement('div')
  const h = document.createElement('h2')
  h.textContent = 'Beleg'
  const vendor = field('Lieferant', 'text')
  const amount = field('Betrag EUR', 'number')
  amount.querySelector('input').step = '0.01'
  const actions = document.createElement('div')
  actions.className = 'toolbar'
  const save = document.createElement('button')
  save.className = 'primary'
  save.textContent = 'Speichern'
  save.onclick = async () => {
    const rec = { id: uid(), vendor: vendor.querySelector('input').value.trim(), amount: +amount.querySelector('input').value || 0, date: Date.now(), blob: imgBlob }
    await put(stores.receipts, rec)
    const url = await uploadToBucket(buckets.receipts, 'receipts/' + rec.id + '.jpg', rec.blob)
    if (url) await put(stores.receipts, { ...rec, imageUrl: url })
    $('#modal').classList.add('hidden')
    await renderReceipts()
  }
  actions.append(save)
  wrap.append(h, vendor, amount, actions)
  modal(wrap)
}
async function printInvoice(inv) {
  const w = window.open('', '_blank')
  const name = (await getSetting('businessName')) || 'Fräulein Franken'
  const tagline = (await getSetting('tagline')) || 'Geschenke für dich'
  const address = (await getSetting('address')) || 'Kölner Str. 13, 50226 Frechen'
  const logoUrl = '/logo.png'
  w.document.write('<html><head><title>Rechnung</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:system-ui;padding:24px}header{display:flex;gap:16px;align-items:center;margin-bottom:16px}header img{width:96px;height:96px;object-fit:contain}h1{margin:0 0 6px}small{color:#666}table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border:1px solid #ddd;padding:8px;text-align:left}footer{margin-top:18px;color:#333}</style></head><body>')
  w.document.write('<header>')
  w.document.write('<img src="' + logoUrl + '" alt="Logo">')
  w.document.write('<div><h1>' + name + '</h1><small>' + tagline + '</small><div>' + address + '</div></div>')
  w.document.write('</header>')
  w.document.write('<div><b>Rechnung</b></div>')
  w.document.write('<div>Kunde: ' + inv.customer + '</div>')
  w.document.write('<div>Datum: ' + new Date(inv.date).toLocaleDateString('de-DE') + '</div>')
  w.document.write('<table><thead><tr><th>Position</th><th>Menge</th><th>Einzelpreis</th><th>Summe</th></tr></thead><tbody>')
  inv.items.forEach(it => { w.document.write('<tr><td>' + it.name + '</td><td>' + it.qty + '</td><td>' + fmtMoney(it.price) + '</td><td>' + fmtMoney(it.total) + '</td></tr>') })
  w.document.write('</tbody></table>')
  w.document.write('<footer><b>Gesamtsumme: ' + fmtMoney(inv.total) + '</b></footer>')
  w.document.write('</body></html>')
  w.document.close()
  w.focus()
  w.print()
}
async function backup() {
  const invoices = await getAll(stores.invoices)
  const inventory = await getAll(stores.inventory)
  const receipts = await getAll(stores.receipts)
  const data = { invoices, inventory, receipts }
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'backup.json'
  a.click()
  URL.revokeObjectURL(url)
}
async function restore(file) {
  const json = await file.text().then(t => JSON.parse(t))
  for (const it of json.inventory || []) await put(stores.inventory, it)
  for (const inv of json.invoices || []) await put(stores.invoices, inv)
  for (const r of json.receipts || []) {
    let blob
    if (r.blob && r.blob.data) blob = new Blob([new Uint8Array(r.blob.data)], { type: r.blob.type || 'image/jpeg' })
    else blob = r.blob
    await put(stores.receipts, { ...r, blob })
  }
  await renderInventory(); await renderInvoices(); await renderReceipts()
}
function bindUI() {
  $$('.tab').forEach(b => b.onclick = () => show(b.dataset.tab))
  $('#new-invoice').onclick = () => modal(newInvoiceForm())
  $('#new-item').onclick = () => modal(newItemForm())
  $('#new-receipt').onclick = () => newReceipt()
  $('#receipt-input').onchange = e => { const f = e.target.files[0]; if (f) handleReceiptFile(f) }
  $('#export-invoices').onclick = async () => {
    const data = await getAll(stores.invoices)
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'invoices.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  $('#export-inventory').onclick = async () => {
    const data = await getAll(stores.inventory)
    const mapped = data.map(it => ({ ...it, photo: undefined }))
    const blob = new Blob([JSON.stringify(mapped)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'inventory.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  $('#export-receipts').onclick = async () => {
    const data = await getAll(stores.receipts)
    const mapped = data.map(r => ({ ...r, blob: undefined }))
    const blob = new Blob([JSON.stringify(mapped)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'receipts.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  $('#backup-all').onclick = backup
  $('#restore-all').onclick = () => $('#restore-file').files[0] && restore($('#restore-file').files[0])
  $('#biz-save').onclick = async () => {
    await setSetting('businessName', $('#biz-name').value.trim())
    await setSetting('tagline', $('#biz-tagline').value.trim())
    await setSetting('address', $('#biz-address').value.trim())
  }
  $('#sb-save').onclick = async () => {
    await setSetting('sbUrl', $('#sb-url').value.trim())
    await setSetting('sbKey', $('#sb-key').value.trim())
    await setSetting('sbProject', $('#sb-project').value.trim())
    sbClient = null
  }
  $('#sb-test').onclick = () => testSupabase()
  $('#sb-link').onclick = async () => {
    const url = $('#sb-url').value.trim() || await getSetting('sbUrl') || ''
    const key = $('#sb-key').value.trim() || await getSetting('sbKey') || ''
    const proj = $('#sb-project').value.trim() || await getSetting('sbProject') || 'Rechnung Katha'
    const base = location.origin + location.pathname
    const link = base + '?sbUrl=' + encodeURIComponent(url) + '&sbKey=' + encodeURIComponent(key) + '&sbProject=' + encodeURIComponent(proj)
    const wrap = document.createElement('div')
    const h = document.createElement('h2')
    h.textContent = 'Setup-Link'
    const field = document.createElement('div')
    field.className = 'field'
    const lab = document.createElement('label')
    lab.textContent = 'Link'
    const inp = document.createElement('input')
    inp.type = 'text'
    inp.value = link
    const actions = document.createElement('div')
    actions.className = 'toolbar'
    const copy = document.createElement('button')
    copy.textContent = 'Kopieren'
    copy.onclick = () => { inp.select(); document.execCommand('copy') }
    actions.append(copy)
    field.append(lab, inp)
    wrap.append(h, field, actions)
    modal(wrap)
  }
  $('#sb-share').onclick = async () => {
    const url = $('#sb-url').value.trim() || await getSetting('sbUrl') || ''
    const key = $('#sb-key').value.trim() || await getSetting('sbKey') || ''
    const proj = $('#sb-project').value.trim() || await getSetting('sbProject') || 'Rechnung Katha'
    const base = location.origin + location.pathname
    const link = base + '?sbUrl=' + encodeURIComponent(url) + '&sbKey=' + encodeURIComponent(key) + '&sbProject=' + encodeURIComponent(proj)
    if (navigator.share) {
      try { await navigator.share({ title: 'Cloud Setup', text: 'Setup-Link', url: link }) } catch {}
    } else {
      alert(link)
    }
  }
}
async function init() {
  db = await openDB()
  bindUI()
  const tab = location.hash.replace('#','') || 'invoices'
  show(tab)
  await bootstrapSupabaseFromQuery()
  await seedDefaults()
  await loadSettings()
  await renderInventory(); await renderInvoices(); await renderReceipts()
}
async function bootstrapSupabaseFromQuery() {
  const sp = new URL(location.href).searchParams
  const url = sp.get('sbUrl')
  const key = sp.get('sbKey')
  const proj = sp.get('sbProject') || 'Rechnung Katha'
  if (url && key) {
    await setSetting('sbUrl', url)
    await setSetting('sbKey', key)
    await setSetting('sbProject', proj)
    sbClient = null
    history.replaceState(null, '', location.pathname + location.hash)
  }
}
async function seedDefaults() {
  const customers = await getAll(stores.customers)
  if (!customers.find(c => c.name === 'Barverkauf')) await put(stores.customers, { id: uid(), name: 'Barverkauf' })
  const bn = await getSetting('businessName')
  if (!bn) {
    await setSetting('businessName', 'Fräulein Franken')
    await setSetting('tagline', 'Geschenke für dich')
    await setSetting('address', 'Kölner Str. 13, 50226 Frechen')
  }
  const proj = await getSetting('sbProject')
  if (!proj) await setSetting('sbProject', 'Rechnung Katha')
}
async function loadSettings() {
  $('#biz-name').value = (await getSetting('businessName')) || ''
  $('#biz-tagline').value = (await getSetting('tagline')) || ''
  $('#biz-address').value = (await getSetting('address')) || ''
  $('#sb-url').value = (await getSetting('sbUrl')) || ''
  $('#sb-key').value = (await getSetting('sbKey')) || ''
  const proj = await getSetting('sbProject')
  if (document.querySelector('#sb-project')) document.querySelector('#sb-project').value = proj || 'Rechnung Katha'
}
function customerField() {
  const wrap = document.createElement('div')
  wrap.className = 'field'
  const l = document.createElement('label')
  l.textContent = 'Kunde'
  const row = document.createElement('div')
  row.className = 'row'
  const sel = document.createElement('select')
  const add = document.createElement('button')
  add.textContent = '+'
  add.onclick = async () => {
    const f = document.createElement('div')
    const h = document.createElement('h2')
    h.textContent = 'Neuer Kunde'
    const name = field('Name', 'text')
    const actions = document.createElement('div')
    actions.className = 'toolbar'
    const save = document.createElement('button')
    save.className = 'primary'
    save.textContent = 'Speichern'
    save.onclick = async () => {
      const val = name.querySelector('input').value.trim()
      if (!val) return
      const c = { id: uid(), name: val }
      await put(stores.customers, c)
      await fillCustomers(sel)
      Array.from(sel.options).forEach(o => { if (o.textContent === val) sel.value = o.value })
      $('#modal').classList.add('hidden')
    }
    actions.append(save)
    f.append(h, name, actions)
    modal(f)
  }
  row.append(sel, add)
  wrap.append(l, row)
  fillCustomers(sel)
  return wrap
}
async function fillCustomers(sel) {
  const list = await getAll(stores.customers)
  sel.innerHTML = ''
  list.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o) })
}
init()
async function getSetting(key) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores.settings, 'readonly')
    const s = t.objectStore(stores.settings)
    const req = s.get(key)
    req.onsuccess = () => resolve(req.result ? req.result.value : undefined)
    req.onerror = () => reject(req.error)
  })
}
async function setSetting(key, value) { return tx(stores.settings, 'readwrite', s => s.put({ key, value })) }
async function getAsset(key) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores.assets, 'readonly')
    const s = t.objectStore(stores.assets)
    const req = s.get(key)
    req.onsuccess = () => resolve(req.result ? req.result.blob : undefined)
    req.onerror = () => reject(req.error)
  })
}
async function setAsset(key, blob) { return tx(stores.assets, 'readwrite', s => s.put({ key, blob })) }