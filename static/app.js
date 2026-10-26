const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Reuse one formatter: search renders call num() hundreds of times per pass.
const numberFormatter = new Intl.NumberFormat('de-DE', {maximumFractionDigits:2});
const num = n => { const value=Number(n); return Number.isFinite(value) ? numberFormatter.format(value) : '—'; };
// Search grids rebuild sizeable DOM trees. Debouncing keeps fast typing to one
// render after the user pauses, while non-search controls remain immediate.
function debounce(fn, wait=140) {
  let timer = 0;
  const wrapped = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}
const cash = n => { if(n===null||n===undefined||n==='')return '—'; const value=Number(n); return Number.isFinite(value) ? `${num(value)} $` : '—'; };
const date = n => { if(n==null||n==='')return 'Noch keine Daten'; const value=typeof n==='number'||/^\d+(?:\.\d+)?$/.test(String(n))?Number(n)*1000:Date.parse(n); return Number.isFinite(value)?new Date(value).toLocaleString('de-DE'):'Noch keine Daten'; };
// Keep icon recovery compatible with the strict CSP. Inline `onerror` handlers
// are blocked by the policy, so one delegated listener handles every lazy icon
// rendered by the search grids and detail views.
document.addEventListener('error', event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
  if (!img.dataset.tried && img.src !== img.dataset.fallback) {
    img.dataset.tried = '1';
    img.src = img.dataset.fallback;
    return;
  }
  img.hidden = true;
  if (img.nextElementSibling) img.nextElementSibling.hidden = false;
}, true);
const allowedIconHosts=new Set(['img.mc-api.io','items.opsucht.net','mc-api.io']);
// OPSUCHT currently serves the dashboard over HTTP.  Accept both protocols
// for the allow-listed icon hosts so custom OPSHARD icons are not silently
// replaced by the generic fallback.  The host allow-list still prevents
// arbitrary remote image URLs from being injected into the UI.
const iconUrl=(value)=>{const raw=String(value||'').trim();if(raw.startsWith('/'))return raw;try{const parsed=new URL(raw,location.origin);return (parsed.protocol==='https:'||parsed.protocol==='http:')&&allowedIconHosts.has(parsed.hostname)?parsed.href:'';}catch{return ''}};
const image = (url, fallback='') => {const primary=iconUrl(url),safeFallback=iconUrl(fallback)||'/static/opsucht-mark.svg';if(!primary)return `<img src="${esc(safeFallback)}" loading="lazy" alt="" data-fallback="/static/opsucht-mark.svg"><span class="icon-fallback" aria-hidden="true" hidden>◇</span>`;return `<img src="${esc(primary)}" loading="lazy" alt="" data-fallback="${esc(safeFallback)}"><span class="icon-fallback" aria-hidden="true" hidden>◇</span>`;};
const empty = text => `<div class="empty">${esc(text)}</div>`;
const state = {page:'overview', market:[], abcPrices:[], abcCategory:'', abcQuantities:{}, auctions:[], categories:[], catalog:[], values:[], rules:[], alerts:[], rates:[], status:{}, profiles:{}, marketCategory:'', merchantCategory:'', auctionCategoryRoot:'', auctionCategorySub:'', auctionCategoryType:'', auctionEnchantFilter:'', auctionEnchantQuery:'', valueCategoryRoot:'', catalogCategoryRoot:'', catalogSource:'all', shown:60, abcShown:60, catalogShown:60, merchantShown:12, token:localStorage.getItem('radar-user-token')||'', user:null, userRules:[], userAlerts:[], minecraftChallenge:null, activeHistory:null, loadedAt:{}, cacheMeta:{}};

// Market and ABC data remain useful when the phone temporarily has no network.
// Successful public responses are cached; auctions are deliberately excluded
// so an offline view never looks like a live listing.
const PRICE_CACHE_PREFIX='opsucht-price-cache-v1:';
function readPriceCache(key){try{const raw=localStorage.getItem(PRICE_CACHE_PREFIX+key);const parsed=JSON.parse(raw||'');if(!Array.isArray(parsed?.data)||!Number.isFinite(Number(parsed.savedAt)))return null;return {data:parsed.data,savedAt:Number(parsed.savedAt)};}catch{return null;}}
function writePriceCache(key,data){if(!Array.isArray(data)||!data.length)return;try{localStorage.setItem(PRICE_CACHE_PREFIX+key,JSON.stringify({savedAt:Date.now(),data}));}catch{}}
function renderCacheNotice(pageName){const host=document.querySelector('#'+pageName);if(!host)return;let note=host.querySelector('.offline-cache-note');const cachedAt=state.cacheMeta[pageName];if(!cachedAt){if(note)note.remove();return;}if(!note){note=document.createElement('div');note.className='offline-cache-note';const anchor=host.querySelector('.toolbar')||host.firstElementChild;host.insertBefore(note,anchor||null);}note.textContent=`Offline gespeicherte Preisdaten · zuletzt online ${date(cachedAt)}. Aktualisieren sobald WLAN verfügbar ist.`;}

// Optional telemetry is opt-in and intentionally separate from login state.
// Events are coarse, non-identifying and queued locally while offline.
const TELEMETRY_CONSENT_KEY = 'opsucht-telemetry-consent-v1';
const TELEMETRY_QUEUE_KEY = 'opsucht-telemetry-queue-v1';
const telemetryStartedAt = Date.now();
function createTelemetrySessionBucket(){
  try {
    const uuid = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function' ? globalThis.crypto.randomUUID() : '';
    const cleaned = String(uuid).replace(/[^a-z0-9]/gi,'').toLowerCase();
    if(cleaned.length >= 8) return `s${cleaned}`.slice(0,48);
  } catch {}
  const time = Date.now().toString(36), random = Math.random().toString(36).slice(2,12);
  return `s${time}${random}`.replace(/[^a-z0-9_-]/gi,'').slice(0,48);
}
const telemetrySessionId = createTelemetrySessionBucket();
let telemetryActiveSince = document.hidden ? null : telemetryStartedAt;
let telemetryOnlineSince = navigator.onLine === false ? null : telemetryStartedAt;
const telemetryUsage = {activeSeconds:0,onlineSeconds:0,pageViews:0,visibilityChanges:0,onlineEvents:0,offlineEvents:0};
let telemetryFlushBusy = false;
let telemetryFlushTimer = 0;
let telemetryFlushScheduled = false;
function telemetryConsent(){return localStorage.getItem(TELEMETRY_CONSENT_KEY)==='granted';}
function telemetryQueue(){try{const now=Date.now(),q=JSON.parse(localStorage.getItem(TELEMETRY_QUEUE_KEY)||'[]');return Array.isArray(q)?q.filter(item=>now-Date.parse(item?.at||0)<30*86400000).slice(-80):[];}catch{return[];}}
function telemetryConnection(){const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;if(!c)return undefined;const effectiveType=String(c.effectiveType||'').slice(0,16),type=String(c.type||'').slice(0,16);const result={};if(effectiveType)result.effectiveType=effectiveType;if(type)result.type=type;if(c.saveData!==undefined)result.saveData=Boolean(c.saveData);if(Number.isFinite(Number(c.downlink)))result.downlink=Math.min(100,Number(c.downlink));return Object.keys(result).length?result:undefined;}
function telemetryCellular(){const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;return String(c?.type||'').toLowerCase()==='cellular';}
function telemetryDataSaver(){const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;const effective=String(c?.effectiveType||'').toLowerCase();return Boolean(c?.saveData)||telemetryCellular()||['slow-2g','2g','3g'].includes(effective);}
function telemetryOptional(value,max=64){const text=String(value??'').trim();return text&&text.toLowerCase()!=='unknown'?text.slice(0,max):undefined;}
function deviceTelemetry(){
  const ua=String(navigator.userAgent||''), platform=String(navigator.userAgentData?.platform||navigator.platform||'unknown');
  const mobile=Boolean(navigator.userAgentData?.mobile||/Android|iPhone|iPad|Mobile/i.test(ua));
  let model='unknown', manufacturer='unknown', modelCode='';
  const android=ua.match(/Android[^;)]*;\s*(?:[a-z]{2,3}-[A-Z]{2,3};\s*)?(?:wv;\s*)?([^;)]+?)\s+Build\//i);
  if(android){model=android[1].trim();modelCode=model;const m=model.toLowerCase();manufacturer=/samsung|sm-[a-z0-9-]+/.test(m)?'samsung':/pixel|google/.test(m)?'google':/xiaomi|redmi|poco/.test(m)?'xiaomi':/huawei|honor/.test(m)?'huawei':/oneplus/.test(m)?'oneplus':/nothing|a059/.test(m)?'nothing':'android';}
  else if(/iPhone/i.test(ua)){manufacturer='apple';model='iphone';} else if(/iPad/i.test(ua)){manufacturer='apple';model='ipad';}
  else {manufacturer=/Macintosh/i.test(ua)?'apple':/Windows/i.test(ua)?'microsoft':/Linux/i.test(ua)?'linux':'unknown';model=mobile?'mobile':'desktop';}
  const known={a059:{manufacturer:'nothing',model:'phone-3a',displayName:'Nothing Phone 3a'}};
  const mapped=known[String(modelCode||model).toLowerCase()];
  if(mapped){manufacturer=mapped.manufacturer;model=mapped.model;}
  if(manufacturer==='unknown')manufacturer='device';
  if(model==='unknown')model='generic';
  const browser=/Edg\//.test(ua)?'edge':/Firefox\//.test(ua)?'firefox':/Chrome\//.test(ua)?'chrome':/Safari\//.test(ua)?'safari':'other';
  const orientation=screen.orientation?.type||((innerWidth||0)>=(innerHeight||0)?'landscape':'portrait');
  const mm = query => typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(query).matches === true;
  const payload={consent:true,sessionBucket:telemetrySessionId,manufacturer,model,...(modelCode?{modelCode}:{}),...(mapped?.displayName?{displayName:mapped.displayName}:{}),platform,os:platform,browser,mobile,appVersion:'web',locale:telemetryOptional(navigator.language,16),timezone:telemetryOptional(Intl.DateTimeFormat().resolvedOptions().timeZone,48),viewport:{width:Math.min(10000,innerWidth||0),height:Math.min(10000,innerHeight||0)},screen:{width:Math.min(10000,screen.width||0),height:Math.min(10000,screen.height||0),dpr:Math.min(10,devicePixelRatio||1),colorDepth:Math.min(64,screen.colorDepth||0),orientation},deviceMemory:Number.isFinite(Number(navigator.deviceMemory))?Math.min(64,Number(navigator.deviceMemory)):undefined,hardwareConcurrency:Number.isFinite(Number(navigator.hardwareConcurrency))?Math.min(128,Number(navigator.hardwareConcurrency)):undefined,maxTouchPoints:Number.isFinite(Number(navigator.maxTouchPoints))?Math.min(20,Number(navigator.maxTouchPoints)):0,reducedMotion:mm('(prefers-reduced-motion: reduce)'),colorScheme:mm('(prefers-color-scheme: dark)')?'dark':'light',connection:telemetryConnection(),mobileData:telemetryCellular(),dataSaver:telemetryDataSaver()};
  for(const key of ['platform','os','browser','appVersion','manufacturer','model'])if(String(payload[key]||'').toLowerCase()==='unknown')delete payload[key];
  return payload;
}
function usageSnapshot(){const now=Date.now();let active=telemetryUsage.activeSeconds,online=telemetryUsage.onlineSeconds;if(telemetryActiveSince!==null)active+=(now-telemetryActiveSince)/1000;if(telemetryOnlineSince!==null)online+=(now-telemetryOnlineSince)/1000;return {activeSeconds:Math.min(86400,Math.round(active)),onlineSeconds:Math.min(86400,Math.round(online)),pageViews:telemetryUsage.pageViews,visibilityChanges:telemetryUsage.visibilityChanges,onlineEvents:telemetryUsage.onlineEvents,offlineEvents:telemetryUsage.offlineEvents,sessionStartedAt:new Date(telemetryStartedAt).toISOString()};}
function queueTelemetry(event, extra={}){if(!telemetryConsent())return;const item={...deviceTelemetry(),event:String(event).slice(0,32),at:new Date().toISOString(),...usageSnapshot(),...extra};const q=telemetryQueue();q.push(item);try{localStorage.setItem(TELEMETRY_QUEUE_KEY,JSON.stringify(q.slice(-80)));}catch{};if(!telemetryDataSaver()){if(!telemetryFlushScheduled){telemetryFlushScheduled=true;const schedule=typeof globalThis.queueMicrotask==='function'?globalThis.queueMicrotask:fn=>Promise.resolve().then(fn);schedule(()=>{telemetryFlushScheduled=false;flushTelemetry();});}}else if(!telemetryFlushTimer)telemetryFlushTimer=setTimeout(()=>{telemetryFlushTimer=0;flushTelemetry();},15000);}
async function flushTelemetry(){if(telemetryFlushBusy||!telemetryConsent()||navigator.onLine===false)return;let q=telemetryQueue();if(!q.length)return;telemetryFlushBusy=true;try{const batch=telemetryDataSaver()?q.slice(0,3):q;for(const item of batch){if(navigator.onLine===false)break;const r=await fetch('/api/telemetry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item),keepalive:true});if(!r.ok)break;q.shift();}try{localStorage.setItem(TELEMETRY_QUEUE_KEY,JSON.stringify(q));}catch{}}catch{}finally{telemetryFlushBusy=false;}}
function telemetryError(error, context){if(!telemetryConsent())return;const message=String(error?.name||error||'Error').replace(/[^a-zA-Z0-9._-]/g,'').slice(0,32)||'Error';queueTelemetry('error',{errorType:message,errorContext:String(context||'unknown').replace(/[^a-zA-Z0-9._-]/g,'').slice(0,32)});}
function telemetryPerformance(){if(!telemetryConsent())return;let nav=null;try{nav=typeof performance?.getEntriesByType==='function'?performance.getEntriesByType('navigation')[0]:null;}catch{};const timing=globalThis.performance?.timing;const loadMs=nav?.loadEventEnd||((timing?.loadEventEnd&&timing?.navigationStart)?timing.loadEventEnd-timing.navigationStart:0);const domReadyMs=nav?.domContentLoadedEventEnd||((timing?.domContentLoadedEventEnd&&timing?.navigationStart)?timing.domContentLoadedEventEnd-timing.navigationStart:0);const transferKb=nav?.transferSize?Math.round(nav.transferSize/1024):undefined;queueTelemetry('performance',{loadMs:Math.min(60000,Math.max(0,Math.round(loadMs))),domReadyMs:Math.min(60000,Math.max(0,Math.round(domReadyMs))),...(transferKb!==undefined?{transferKb:Math.min(10240,transferKb)}:{}),summary:true});}
const telemetryFeatureIds=new Set(['market','abc','auctions','catalog','values','merchant','auth','rules','consent-accept','consent-reject','privacy-settings','privacy-save','privacy-delete','minecraft-link','minecraft-unlink']);
document.addEventListener('click',event=>{if(!telemetryConsent())return;const control=event.target.closest?.('button,[data-page],[data-goto]');if(!control)return;const id=control.id||control.dataset.page||control.dataset.goto;if(id&&telemetryFeatureIds.has(id))queueTelemetry('feature',{feature:id});},{passive:true});
addEventListener('error',event=>telemetryError(event.error||event.message,'window'),true);
addEventListener('unhandledrejection',event=>telemetryError(event.reason,'promise'));
function sendTelemetry(){queueTelemetry('session_start');}
function initPrivacyControls(){
  const banner=$('#consent-banner'),dialog=$('#privacy-dialog'),toggle=$('#telemetry-consent');
  const show=()=>{if(banner)banner.hidden=false;};
  const apply=granted=>{if(granted)localStorage.setItem(TELEMETRY_CONSENT_KEY,'granted');else{localStorage.removeItem(TELEMETRY_CONSENT_KEY);localStorage.removeItem(TELEMETRY_QUEUE_KEY);}if(banner)banner.hidden=true;if(toggle)toggle.checked=granted;if(granted){sendTelemetry();if(!telemetryDataSaver())flushTelemetry();}};
  if(!localStorage.getItem(TELEMETRY_CONSENT_KEY))show();
  $('#consent-accept')?.addEventListener('click',()=>apply(true)); $('#consent-reject')?.addEventListener('click',()=>apply(false));
  $('#privacy-settings')?.addEventListener('click',()=>{if(!dialog)return;toggle.checked=telemetryConsent();dialog.showModal();}); $('#privacy-close')?.addEventListener('click',()=>dialog?.close());
  $('#privacy-save')?.addEventListener('click',()=>{apply(Boolean(toggle?.checked));dialog?.close();});
  $('#privacy-delete')?.addEventListener('click',()=>{apply(false);if(toggle)toggle.checked=false;dialog?.close();show();toast('Optionale Statistik und lokale Warteschlange wurden gelöscht.');});
  if(telemetryConsent()&&!telemetryDataSaver())flushTelemetry();
  if(telemetryConsent()) { setTimeout(telemetryPerformance, 0); addEventListener('load', telemetryPerformance, {once:true}); }
  addEventListener('online',()=>{telemetryUsage.onlineEvents++;telemetryOnlineSince=Date.now();queueTelemetry('network',{state:'online'});if(!telemetryDataSaver())flushTelemetry();},{passive:true});
  addEventListener('offline',()=>{const now=Date.now();if(telemetryOnlineSince!==null){telemetryUsage.onlineSeconds+=(now-telemetryOnlineSince)/1000;telemetryOnlineSince=null;}telemetryUsage.offlineEvents++;queueTelemetry('network',{state:'offline'});},{passive:true});
  addEventListener('visibilitychange',()=>{const now=Date.now();telemetryUsage.visibilityChanges++;if(document.hidden){if(telemetryActiveSince!==null){telemetryUsage.activeSeconds+=(now-telemetryActiveSince)/1000;telemetryActiveSince=null;}queueTelemetry('session_pause',{state:'hidden'});}else{telemetryActiveSince=now;queueTelemetry('visibility',{state:'visible'});}}, {passive:true});
  addEventListener('pagehide',()=>{const now=Date.now();if(telemetryActiveSince!==null){telemetryUsage.activeSeconds+=(now-telemetryActiveSince)/1000;telemetryActiveSince=null;}if(telemetryOnlineSince!==null){telemetryUsage.onlineSeconds+=(now-telemetryOnlineSince)/1000;telemetryOnlineSince=null;}queueTelemetry('session_end',{sessionEndedAt:new Date(now).toISOString()});},{passive:true});
}// Incremented for every modal request so a slower response cannot overwrite a
// detail view that the user has already replaced with another item.
let detailRequestId = 0;
let toastTimer;
function toast(text, error=false) { $('#toast').textContent=text; $('#toast').classList.toggle('error',error); $('#toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,6000); }
async function api(path, method='GET', body) {
  const requestStartedAt=performance.now();
  const options = {method,headers:{}};
  if (state.token) options.headers.Authorization='Bearer '+state.token;
  if (method !== 'GET') { options.headers['Content-Type']='application/json'; options.body=JSON.stringify(body ?? {}); }
  // A broken upstream must not leave the UI waiting forever or block the next refresh.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  options.signal = controller.signal;
  let r;
  try { r = await fetch('/api/'+path, options); }
  catch (error) {
    telemetryError(error,'api');
    if (error?.name === 'AbortError') throw Error('Anfrage dauerte zu lange. Bitte später erneut versuchen.');
    throw Error('Server nicht erreichbar. Bitte Verbindung prüfen.');
  } finally { clearTimeout(timeout); }
  const data = await r.json().catch(()=>({error:r.status === 401 ? 'Admin-Token erforderlich.' : 'Anfrage fehlgeschlagen.'}));
  if (telemetryConsent() && (r.status>=400 || performance.now()-requestStartedAt>3000)) queueTelemetry('api_result',{apiStatus:Math.min(599,r.status),apiDurationMs:Math.min(60000,Math.round(performance.now()-requestStartedAt))});
  if (!r.ok) { const error = Error(data.error || 'Anfrage fehlgeschlagen'); error.status = r.status; throw error; }
  return data;
}
const arrayOrEmpty = value => Array.isArray(value) ? value : [];
function enhanceAccessibility() {
  document.querySelectorAll('nav button[data-page]').forEach(button => {
    button.setAttribute('aria-current', button.classList.contains('selected') ? 'page' : 'false');
  });
  document.querySelectorAll('input, select').forEach(control => {
    if (control.getAttribute('aria-label') || control.id === 'admin-token') return;
    const label = control.closest('label')?.firstChild?.textContent?.trim() || control.getAttribute('placeholder');
    if (label) control.setAttribute('aria-label', label.replace(/\s+…$/, ''));
  });
}
const pages = {
  overview:['Dein Markt. Im Blick.','Preise verfolgen. Werte verstehen. Gute Angebote zuerst sehen.','Übersicht'],
  market:['Die Wirtschaft in Zahlen.','Alle Marktitems, aktuelle Orderseiten und historische Handelspreise.','Marktpreise'],
  abc:['Preisübersicht.','Alle veröffentlichten Referenzkurse mit Mengenrechner für Ankauf und Verkauf.','Preisübersicht'],
  auctions:['Alle Auktionen im Blick.','Live-Gebote, Sofortkauf, Bieter und Itemdetails – aus dem aktuellen OPSUCHT-Auktionshaus.','Auktionshaus'],
  catalog:['Katalog erfasster Items.','Marktmaterialien plus Items aus aktiven und archivierten öffentlichen Auktionen.','Item-Katalog'],
  values:['Was ist dein Item wert?','Echte Verkäufe statt Bauchgefühl. Die Datenbasis wächst mit jedem Handel.','Itemwerte'],
  rules:['Gute Preise. Direkt in Discord.','Deine Regeln entscheiden, wann das Radar einen Ping verschickt.','Alarme & Webhook'],
  auth:['Deine Alarme. Dein Discord.','Eigener Webhook, eigene Preisgrenzen und nur deine persönlichen Treffer.','Discord-Alarme'],
  merchant:['Mehr Währung fürs Geld.','Umtauschkurse vergleichen und deine Rohstoffkosten kalkulieren.','Händler-Rechner']
};
function page(name, options={}) {
  // Published market/ABC/OPSHARD rates are public. Auction-derived item
  // valuations and their histories remain account-only.
  const loginOnlyPages = new Set(['catalog','values']);
  if (loginOnlyPages.has(name) && !state.token) {
    toast('Für geschätzte Itemwerte aus Auktionsverkäufen bitte zuerst anmelden.', true);
    name = 'auth';
    options = { ...options, load: false };
  }
  state.page=name;
  if (telemetryConsent()) { telemetryUsage.pageViews++; queueTelemetry('page_view',{page:String(name).slice(0,32)}); }
  document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==name);
  document.querySelectorAll('nav button').forEach(b=>{const selected=b.dataset.page===name;b.classList.toggle('selected',selected);b.setAttribute('aria-current',selected?'page':'false');});
  $('#title').textContent=pages[name][0]; $('#subtitle').textContent=pages[name][1]; $('#crumb').textContent=pages[name][2];
  if(options.load!==false){
    // Reuse the last complete render immediately while the refresh runs in the
    // background. This makes tab buttons feel instant even for the large
    // catalog/value payloads.
    if(name==='market'&&state.market.length)renderMarket();
    else if(name==='abc'&&state.abcPrices.length)renderAbc();
    else if(name==='auctions'&&state.auctions.length)renderAuctions();
    else if(name==='catalog'&&state.catalog.length)renderCatalog();
    else if(name==='values'&&state.values.length)renderValues();
    else if(name==='merchant'&&state.rates.length)renderRates();
    load().catch(e=>toast(e.message,true));
  }
}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>page(b.dataset.page)));
document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>page(b.dataset.goto)));
function renderStatus() {
  const s=state.status;
  const maintenance=s.maintenance&&s.maintenance.enabled?s.maintenance:null;
  let banner=document.querySelector('#maintenance-banner');
  if(maintenance){
    if(!banner){banner=document.createElement('div');banner.id='maintenance-banner';banner.className='maintenance-banner';document.body.prepend(banner);}
    banner.innerHTML=`<strong>Geplante Wartung</strong><span>${esc(maintenance.message||'Einige Funktionen können vorübergehend eingeschränkt sein.')}</span>`;
    banner.hidden=false;
  } else if(banner) banner.hidden=true;
  const stale=!s.auctions_updated || Date.now()/1000-s.auctions_updated>90;
  const ownerTab=document.querySelector('nav [data-page="rules"]');
  if(ownerTab) ownerTab.hidden=Boolean(s.public_site);
  for(const id of ['owner-recent-alerts','owner-rule-preview','owner-manage-button']){const el=$('#'+id);if(el)el.hidden=Boolean(s.public_site);}
  if(s.public_site&&$('#hero-description')) $('#hero-description').textContent='Öffentliche Live-Daten zu Marktpreisen, Auktionen, Itemvarianten und Händlerkursen. Deine persönlichen Alerts und die Webhook-Verbindung bleiben privat.';
  const maintenanceToggle=$('#maintenance-enabled'),maintenanceMessage=$('#maintenance-message'),maintenanceTag=$('#maintenance-status');if(maintenanceToggle&&s.maintenance){maintenanceToggle.checked=Boolean(s.maintenance.enabled);maintenanceMessage.value=s.maintenance.message||'';maintenanceTag.textContent=s.maintenance.enabled?'AKTIV':'AUS';maintenanceTag.classList.toggle('tag-active',Boolean(s.maintenance.enabled));}
  $('#live').textContent=s.stream ? '● DATEN AKTUELL' : stale ? '● VERBINDUNG PRÜFEN' : '● AKTUALISIERUNG AKTIV';
  $('#side-status').textContent=s.stream ? 'Auktionsfeed verbunden' : 'Aktualisierung / Wiederverbindung';
  let sponsor=document.querySelector('#sponsor-slot');
  if(s.sponsor?.enabled){
    if(!sponsor){sponsor=document.createElement('article');sponsor.id='sponsor-slot';sponsor.className='sponsor-card';const overview=document.querySelector('#overview');overview?.append(sponsor);}
    sponsor.innerHTML=`<small>COMMUNITY-SPONSOR</small><h3>${esc(s.sponsor.title||'Unterstützer')}</h3><p>${esc(s.sponsor.text||'Unterstützt OPSUCHT Market')}</p><a href="${esc(s.sponsor.url)}" target="_blank" rel="noopener sponsored">Mehr erfahren ↗</a>`;
    sponsor.hidden=false;
  } else if(sponsor) sponsor.hidden=true;
  $('#stats').innerHTML=[['Marktitems',s.market_items ?? 0,'Alle handelbaren Materialien'],['Aktive Auktionen',s.active_auctions ?? 0,'Live + Snapshot-Abgleich'],['Bestätigte Verkäufe',s.sales ?? 0,'Grundlage deiner Itemwerte'],['Verlaufspunkte',s.history_points ?? 0,'Historische Trades archiviert']].map(([label,value,caption])=>`<div class="stat"><small>${label}</small><b>${num(value)}</b><span>${caption}</span></div>`).join('');
  const marketItems=Number(s.market_items)||0,historyItems=Number(s.history_items)||0;
  const progress=marketItems ? Math.round(100*historyItems/marketItems) : 0;
  $('#collection').innerHTML=`<div class="metric"><span>Markt zuletzt aktualisiert</span><b>${date(s.market_updated)}</b></div><div class="metric"><span>Auktionsabgleich</span><b>${date(s.auctions_updated)}</b></div><div class="metric"><span>Eigene Kursmessungen</span><b>${num(s.snapshots||0)}</b></div><div class="progress"><div style="width:${Math.min(Math.max(progress,0),100)}%"></div></div><div class="muted">Historien: ${num(historyItems)} / ${num(marketItems)} Materialien (${progress} %)</div>${Object.entries(s.errors||{}).map(([k,v])=>`<p class="error note">${esc(k)}: ${esc(v)}</p>`).join('')}`;
  const watched=s.watched_player?`<div class="metric"><span>Spieler-Outbid-Watcher · ${esc(s.watched_player.name)}</span><b>${s.watched_player.resolved?'🟢 UUID gefunden':'🟠 UUID nicht gefunden'}</b></div>`:'';
  if($('#discord-status'))$('#discord-status').innerHTML=`<div class="metric"><span>Webhook</span><b>${s.webhook_configured?'🟢 Konfiguriert':'⚪ Nicht konfiguriert'}</b></div><div class="metric"><span>Ping-Ziel</span><b>${esc(s.ping_target)}</b></div><div class="metric"><span>Panel-Bot</span><b>${s.bot_connected?'🟢 Verbunden':s.bot_configured?'🟡 Verbindet':'Bot-Token fehlt'}</b></div>${watched}<p class="note">Der Webhook ist privat und wird nur für deine persönlichen Preis- und Bieter-Alarme genutzt. Für klickbare Discord-Panels brauchst du zusätzlich einen Bot-Token.</p>`;
  renderAuthState();
}
function setUserToken(token){state.token=token||'';if(token)localStorage.setItem('radar-user-token',token);else localStorage.removeItem('radar-user-token');}
function renderUserRules(){const el=$('#user-rules-list');if(!el)return;el.innerHTML=state.userRules.length?state.userRules.map(r=>`<div class="rule-row"><div><b>${r.kind==='ending_bid'?'⏳':'⚡'} ${esc(r.name)}</b><small>${esc(r.query)} · ${r.kind==='ending_bid'?`Gebot unter ${cash(r.max_price)} · ${num(r.min_minutes)}–${num(r.max_minutes)} Min`:`Sofortkauf unter ${cash(r.max_price)}`}</small></div><div class="actions"><button class="secondary" data-user-toggle="${r.id}">${r.enabled?'🟢 Aktiv':'⚪ Pausiert'}</button><button class="danger" data-user-delete="${r.id}">Löschen</button></div></div>`).join(''):empty('Noch keine persönliche Preisregel.');el.querySelectorAll('[data-user-toggle]').forEach(b=>b.onclick=async()=>{const r=state.userRules.find(x=>x.id===+b.dataset.userToggle);try{await api('me/rules/'+b.dataset.userToggle,'PUT',{...r,enabled:!r.enabled});await loadUserData();}catch(e){toast(e.message,true);}});el.querySelectorAll('[data-user-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Diese persönliche Alarmregel löschen?'))return;try{await api('me/rules/'+b.dataset.userDelete,'DELETE');await loadUserData();}catch(e){toast(e.message,true);}});}
function renderUserAlerts(){const el=$('#user-alerts-list');if(el)el.innerHTML=alertTable(state.userAlerts);}
function renderAuthState(){const guest=$('#auth-guest'),user=$('#auth-user');if(!guest||!user)return;const logged=Boolean(state.user);guest.hidden=logged;user.hidden=!logged;if(logged){$('#auth-username').textContent=state.user.username;const form=$('#auth-webhook-form');if(form){form.elements.webhook.value='';form.elements.mention.value=state.user.mention==='everyone'?'everyone':/^user:/.test(state.user.mention)?'user':/^role:/.test(state.user.mention)?'role':'none';$('#auth-mention-id').hidden=!['user','role'].includes(form.elements.mention.value);}const status=$('#auth-webhook-status');if(status){const expiry=Number(state.user.webhook_expires||0);status.textContent=state.user.webhook_configured&&expiry?`Aktiv · ${Math.max(0,Math.ceil((expiry-Date.now()/1000)/86400))} Tage`:state.user.webhook_configured?'Aktiv':'Noch nicht eingerichtet';status.classList.toggle('tag-active',Boolean(state.user.webhook_configured));}renderUserRules();renderUserAlerts();renderDashboard();}}
function renderDashboard(){if(!state.user)return;const put=(id,value)=>{const el=$('#'+id);if(el)el.textContent=value;};const setHealth=(key,ok,warn)=>{const dot=document.querySelector(`[data-health=\"${key}\"]`);if(dot)dot.classList.toggle('ok',Boolean(ok)),dot.classList.toggle('warn',!ok&&Boolean(warn));};put('dashboard-username',state.user.username||'—');put('dashboard-created',date(state.user.created));put('dashboard-last-login',date(state.user.last_login));put('dashboard-rules',num(state.userRules.length));put('dashboard-alerts',num(state.userAlerts.length));const email=$('#auth-email-status');const emailText=state.user.email_verified?'Bestätigt':state.user.email?'Hinterlegt':'Fehlt';if(email){email.textContent=state.user.email_verified?'E-Mail bestätigt':state.user.email?'E-Mail hinterlegt':'E-Mail fehlt';email.classList.toggle('tag-active',Boolean(state.user.email));}put('dashboard-email-state',emailText);put('dashboard-webhook-state',state.user.webhook_configured?'Aktiv':'Nicht eingerichtet');put('dashboard-minecraft-state',state.user.minecraft_verified?'Verifiziert':state.user.minecraft_username?'Profil gefunden':'Nicht verknüpft');setHealth('email',Boolean(state.user.email),!state.user.email_verified);setHealth('webhook',Boolean(state.user.webhook_configured));setHealth('minecraft',Boolean(state.user.minecraft_verified),Boolean(state.user.minecraft_username));} 
function renderAccountLink(){const email=$('#account-email'),name=$('#minecraft-username'),status=$('#minecraft-status'),edition=$('#minecraft-edition');if(!state.user||!email||!name||!status)return;const linked=Boolean(state.user.minecraft_username);const verified=Boolean(state.user.minecraft_verified);email.value=state.user.email||'Keine E-Mail hinterlegt';if(document.activeElement!==name)name.value=state.user.minecraft_username||'';if(edition&&document.activeElement!==edition)edition.value=state.user.minecraft_edition||'java';status.textContent=verified?`Verifiziert: ${state.user.minecraft_username} · ${state.user.minecraft_edition==='bedrock'?'Bedrock':'Java'} · UUID ${state.user.minecraft_uuid||'—'}`:linked?`Profil gefunden: ${state.user.minecraft_username}. Besitz noch nicht bestätigt.`:'Noch kein Profil verknüpft. Wir prüfen den Namen zuerst bei Mojang.';const tag=$('#minecraft-status-tag');if(tag){tag.textContent=verified?'VERIFIZIERT':linked?'BESITZ OFFEN':'NICHT VERKNÜPFT';tag.classList.toggle('tag-active',verified);tag.classList.toggle('tag-warning',linked&&!verified);}const detail=$('#account-email-detail');if(detail)detail.textContent=state.user.email_verified?'E-Mail bestätigt und geschützt.':'E-Mail hinterlegt; Bestätigung ausstehend.';const challenge=state.minecraftChallenge;const box=$('#minecraft-challenge');if(box){box.hidden=!challenge||verified;if(challenge&&!verified){$('#minecraft-code').textContent=challenge.code||'------';$('#minecraft-command').textContent=challenge.command||`/link ${challenge.code||'------'}`;$('#minecraft-code-expires').textContent=`${challenge.edition==='bedrock'?'Bedrock':'Java'} · Noch ${Math.max(0,Math.ceil((Number(challenge.expires||0)-Date.now()/1000)/60))} Minuten gültig`;}}renderDashboard();}
async function loadUserData(){if(!state.token){state.user=null;state.minecraftChallenge=null;renderAuthState();return;}try{state.user=await api('me');state.userRules=arrayOrEmpty(await api('me/rules'));state.userAlerts=arrayOrEmpty(await api('me/alerts'));renderAuthState();renderAccountLink();}catch(e){if(/Anmeldung|Admin-Token|401/i.test(e.message)){setUserToken('');state.user=null;state.minecraftChallenge=null;renderAuthState();}else throw e;}}
function alertTable(rows) {
  if(!rows.length) return empty('Noch keine Treffer. Das Radar wartet auf ein Angebot, das zu deinen Alarmregeln passt.');
  return `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Preis beim Treffer</th><th>Regel</th><th>Zeit</th><th>Status</th></tr></thead><tbody>${rows.map(a=>`<tr><td>${esc(a.name)}<small class="muted"><br>${a.kind==='ending_bid'?'Höchstgebot':'Sofortkauf'}</small></td><td class="price">${cash(a.price)}</td><td>${esc(a.rule)}</td><td>${date(a.created)}</td><td>${a.sent>0?'✓ Gesendet':a.sent===-1?'Beendet / übersprungen':a.error?'Wiederholung geplant':'In Warteschlange'}${a.error?`<small class="muted"><br>${esc(a.error)}</small>`:''}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderAbc() {
  const rows=Array.isArray(state.abcPrices)?state.abcPrices.filter(x=>x&&x.id):[];
  const q=($('#abc-search')?.value||'').trim().toLocaleLowerCase('de');
  const categories=[...new Set(rows.map(x=>String(x.category||'Weitere')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
  const categoryRows=[['','Alle Kategorien',rows.length],...categories.map(c=>[c,c,rows.filter(x=>String(x.category||'Weitere')===c).length])];
  const filter=$('#abc-category-filter');
  if(filter){filter.innerHTML=categoryRows.map(([key,label,count])=>`<button class="filter-chip ${state.abcCategory===key?'active':''}" data-abc-category="${esc(key)}">${esc(label)}<small>${num(count)}</small></button>`).join('');filter.querySelectorAll('[data-abc-category]').forEach(b=>b.onclick=()=>{state.abcCategory=b.dataset.abcCategory;renderAbc();});}
  let filtered=rows.filter(x=>{const name=abcLabel(x.id),text=`${name} ${x.id} ${x.category||''}`.toLocaleLowerCase('de');return (!q||text.includes(q))&&(!state.abcCategory||String(x.category||'Weitere')===state.abcCategory);});
  const sort=$('#abc-sort')?.value||'name';
  filtered.sort((a,b)=>sort==='buy-high'?(Number(b.buy_price)||-1)-(Number(a.buy_price)||-1):sort==='sell-high'?(Number(b.sell_price)||-1)-(Number(a.sell_price)||-1):sort==='spread-high'?((Number(b.sell_price)||0)-(Number(b.buy_price)||0))-((Number(a.sell_price)||0)-(Number(a.buy_price)||0)):abcLabel(a.id).localeCompare(abcLabel(b.id),'de'));
  const count=$('#abc-count');if(count)count.textContent=`${num(filtered.length)} Produkte`;
  const pricedBuy=rows.filter(x=>Number(x.buy_price)>0),pricedSell=rows.filter(x=>Number(x.sell_price)>0);
  const summary=$('#abc-summary');if(summary)summary.innerHTML=`<div class="market-stat"><b>${num(rows.length)}</b><span>Produkte</span></div><div class="market-stat"><b>${num(pricedBuy.length)}</b><span>mit Ankaufkurs</span></div><div class="market-stat"><b>${num(pricedSell.length)}</b><span>mit Verkaufskurs</span></div>`;
  const grid=$('#abc-grid');if(!grid)return;
  const visible=filtered.slice(0,state.abcShown);
  grid.innerHTML=visible.map(x=>{const id=String(x.id),qty=Math.max(1,Math.floor(Number(state.abcQuantities[id])||100)),buy=Number(x.buy_price),sell=Number(x.sell_price),spread=buy>0&&sell>0?sell-buy:null;return `<article class="abc-card card"><div class="abc-card-head"><div class="abc-title"><div class="abc-icon">${image(abcIcon(id))}</div><div><h3>${esc(abcLabel(id))}</h3><small class="muted">${esc(id)}${x.category?` · ${esc(x.category)}`:''}</small></div></div><span class="tag">REFERENZKURS</span></div><div class="abc-prices"><div><small>ANKAUF / STÜCK</small><b class="price">${buy>0?cash(buy):'—'}</b></div><div><small>VERKAUF / STÜCK</small><b class="blue">${sell>0?cash(sell):'—'}</b></div>${spread!=null?`<div><small>DIFFERENZ</small><b>${cash(spread)}</b></div>`:''}</div><label class="abc-quantity">Menge<input type="number" min="1" step="1" value="${qty}" data-abc-qty="${esc(id)}"></label><div class="abc-totals"><div><span>Ankauf gesamt</span><b class="price" data-abc-buy-total="${esc(id)}">${buy>0?cash(qty*buy):'—'}</b></div><div><span>Verkauf gesamt</span><b class="blue" data-abc-sell-total="${esc(id)}">${sell>0?cash(qty*sell):'—'}</b></div></div></article>`;}).join('')||empty('Keine Produkte für diese Suche oder Kategorie gefunden.');
  grid.querySelectorAll('[data-abc-qty]').forEach(input=>input.oninput=()=>{const id=input.dataset.abcQty,qty=Math.max(1,Math.floor(Number(input.value)||1));state.abcQuantities[id]=qty;const item=rows.find(x=>String(x.id)===id),buy=Number(item?.buy_price),sell=Number(item?.sell_price);const b=grid.querySelector(`[data-abc-buy-total="${CSS.escape(id)}"]`),s=grid.querySelector(`[data-abc-sell-total="${CSS.escape(id)}"]`);if(b)b.textContent=buy>0?cash(qty*buy):'—';if(s)s.textContent=sell>0?cash(qty*sell):'—';});
  let more=$('#more-abc');if(!more){more=document.createElement('button');more.id='more-abc';more.className='secondary';grid.after(more);}more.hidden=filtered.length<=state.abcShown;more.textContent=`Weitere Produkte laden (${Math.min(60,filtered.length-state.abcShown)}+)`;more.onclick=()=>{state.abcShown+=60;renderAbc();};
}
function abcLabel(id){const clean=String(id||'').replace(/^minecraft:/i,'').split('[',1)[0].toUpperCase();return materialLabel(clean);}
const abcIconAliases={'626.0f':'gravel','625.0f':'oak_log','635.0f':'stone_slab'};
// Steinplatten is a Paper custom item (CustomModelData 635), so the normal
// market material icon is misleading. Keep the server-pack artwork local and
// use it in the ABC tab as well as the merchant calculator.
function abcIcon(id){const key=rateMaterialKey(id);if(key==='635.0f'||String(id||'').includes('635.0f'))return '/static/stoneplatten-icon.png';const market=state.market.find(m=>rateMaterialKey(m.material)===key),marketIcon=String(market?.icon||'').trim();if(marketIcon)return marketIcon;const material=abcIconAliases[key]||key.replace(/[^a-z0-9_]/g,'');return material?`https://img.mc-api.io/${encodeURIComponent(material)}.png`:'https://img.mc-api.io/paper.png';}
function renderMarket() {
  const q=$('#market-search').value.toLowerCase().trim(),materialQuery=q.replace(/\s+/g,'_'), sort=$('#market-sort').value;
  // Keep the complete server response in state. Filtering the state itself
  // made items disappear permanently after changing the search/category.
  const sourceRows=arrayOrEmpty(state.market).filter(m=>m&&typeof m==='object');
  renderMarketCategories();
  let rows=sourceRows.filter(m=>{const material=String(m.material||'').toLowerCase();return (material.includes(materialQuery)||materialLabel(material).toLowerCase().includes(q))&&(!state.marketCategory||m.category===state.marketCategory);});
  if(sort!=='name') rows.sort((a,b)=>(b[sort]??-1)-(a[sort]??-1));
  $('#market-count').textContent=`${rows.length} Items`;
  $('#market-body').innerHTML=rows.map(m=>{const abc=state.abcPrices.find(x=>rateMaterialKey(x.id)===rateMaterialKey(m.material)),last=m.last_trade&&typeof m.last_trade==='object'?m.last_trade:null;return `<tr class="clickable" tabindex="0" role="button" aria-label="Preisverlauf für ${esc(materialLabel(m.material))}" data-material="${esc(m.material)}"><td><div class="item-name">${image(m.icon)}<div><b>${esc(materialLabel(m.material))}</b><small>${esc(m.material||'')}</small></div></div></td><td>${esc(m.category||'Sonstiges')}</td><td><span class="price">${cash(m.buy)}</span> <small class="muted">${num(m.buy_orders||0)} Kauforders</small>${marketChange(m.buy_change_24h)}${abc?`<small class="muted"><br>Referenzkurs: ${cash(abc.buy_price)}</small>`:''}</td><td><span class="blue">${cash(m.sell)}</span> <small class="muted">${num(m.sell_orders||0)} Verkaufsorders</small>${marketChange(m.sell_change_24h)}${abc?`<small class="muted"><br>Referenzkurs: ${cash(abc.sell_price)}</small>`:''}</td><td>${cash(last?.avgPrice)}${last?`<small class="muted"><br>${num(last.transactions||0)} Trades · ${esc(String(last.timestamp||'').split('T')[0])}</small>`:''}</td></tr>`;}).join('') || '<tr><td colspan="5" class="table-empty">Keine passenden Items. Suche oder Kategorie ändern.</td></tr>';
  $('#market-body').querySelectorAll('[data-material]').forEach(r=>{const open=()=>showHistory(r.dataset.material);r.addEventListener('click',open);r.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});});
}
function marketChange(change){if(change==null)return '';const sign=change>0?'+':'';return `<small class="change ${change>=0?'up':'down'}" title="Änderung gegenüber deiner Kursmessung vor etwa 24 Stunden">${change>=0?'↑':'↓'} ${sign}${num(change)} % / 24h</small>`;}
const materialNames={DIAMOND:'Diamant',DIAMOND_BLOCK:'Diamantblock',DIAMOND_ORE:'Diamanterz',EMERALD:'Smaragd',EMERALD_BLOCK:'Smaragdblock',IRON_INGOT:'Eisenbarren',IRON_BLOCK:'Eisenblock',GOLD_INGOT:'Goldbarren',GOLD_BLOCK:'Goldblock',NETHERITE_INGOT:'Netheritbarren',NETHERITE_BLOCK:'Netheritblock',ANCIENT_DEBRIS:'Antiker Schrott',DIAMOND_PICKAXE:'Diamantspitzhacke',NETHERITE_PICKAXE:'Netheritspitzhacke',DIAMOND_SWORD:'Diamantschwert',NETHERITE_SWORD:'Netheritschwert',DIAMOND_AXE:'Diamantaxt',NETHERITE_AXE:'Netheritaxt',OAK_LOG:'Eichenstamm',OAK_PLANKS:'Eichenholzbretter',SPRUCE_LOG:'Fichtenstamm',COAL:'Kohle',COAL_BLOCK:'Kohleblock',REDSTONE:'Redstone-Staub',REDSTONE_BLOCK:'Redstone-Block',LAPIS_LAZULI:'Lapislazuli',AMETHYST_SHARD:'Amethystscherbe',GOLDEN_APPLE:'Goldener Apfel',ENCHANTED_GOLDEN_APPLE:'Verzauberter goldener Apfel',NETHER_STAR:'Netherstern',ELYTRA:'Elytren',TOTEM_OF_UNDYING:'Totem der Unsterblichkeit',SHULKER_BOX:'Shulker-Kiste',WHITE_SHULKER_BOX:'Weiße Shulker-Kiste',BLAZE_ROD:'Lohenrute',ENDER_PEARL:'Enderperle',GUNPOWDER:'Schwarzpulver',STRING:'Faden',SLIME_BALL:'Schleimball',BONE:'Knochen',BONE_BLOCK:'Knochenblock',BOOK:'Buch',GHAST_TEAR:'Ghastträne',PUMPKIN_PIE:'Kürbiskuchen',GLOWSTONE_DUST:'Glowstone-Staub'};
function materialLabel(material){return materialNames[material]||String(material||'').toLowerCase().split('_').map(w=>w? w[0].toUpperCase()+w.slice(1):w).join(' ');}
function renderMarketCategories(){const counts=Object.fromEntries(state.market.reduce((m,r)=>m.set(r.category,(m.get(r.category)||0)+1),new Map()));const labels=['Bergbau','Holz','Kampf','Nahrung','Sonstiges','Besonderes'];const body=[['','Alle Kategorien',state.market.length],...labels.filter(name=>counts[name]).map(name=>[name,name,counts[name]])];$('#market-category-filter').innerHTML=body.map(([key,label,count])=>`<button class="filter-chip ${state.marketCategory===key?'active':''}" data-market-category="${esc(key)}">${esc(label)}<small>${num(count)}</small></button>`).join('');$('#market-category-filter').querySelectorAll('[data-market-category]').forEach(b=>b.onclick=()=>{state.marketCategory=b.dataset.marketCategory;renderMarket();});const buy=state.market.filter(m=>m.buy_orders>0).length,sell=state.market.filter(m=>m.sell_orders>0).length;$('#market-summary').innerHTML=`<div class="market-stat"><b>${num(state.market.length)}</b><span>handelbare Ressourcen</span></div><div class="market-stat"><b>${num(buy)}</b><span>mit aktiven Kauforders</span></div><div class="market-stat"><b>${num(sell)}</b><span>mit aktiven Verkaufsorders</span></div>`;}
function endTimestamp(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
    const numeric = Number(value);
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function endDate(a) {
  const timestamp = endTimestamp(a.endTime);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
    : 'Endzeit unbekannt';
}
const enchantNames={efficiency:'Effizienz',fortune:'Glück',unbreaking:'Haltbarkeit',mending:'Reparatur',silk_touch:'Behutsamkeit',sharpness:'Schärfe',smite:'Bann',bane_of_arthropods:'Nemesis der Gliederfüßer',looting:'Plünderung',sweeping_edge:'Schwungkraft',fire_aspect:'Verbrennung',knockback:'Rückstoß',protection:'Schutz',projectile_protection:'Geschoss-Schutz',blast_protection:'Explosionsschutz',fire_protection:'Feuerschutz',feather_falling:'Federfall',depth_strider:'Wasserläufer',frost_walker:'Eisläufer',respiration:'Atmung',aqua_affinity:'Wasseraffinität',thorns:'Dornen',soul_speed:'Seelenläufer',swift_sneak:'Schleichtempo',power:'Stärke',punch:'Schlag',flame:'Flamme',infinity:'Unendlichkeit',multishot:'Mehrfachschuss',quick_charge:'Schnellladen',piercing:'Durchschuss',loyalty:'Treue',impaling:'Harpune',riptide:'Sog',channeling:'Entladung',density:'Wucht',breach:'Entweihung',wind_burst:'Windstoß',binding_curse:'Fluch der Bindung',vanishing_curse:'Fluch des Verschwindens',luck_of_the_sea:'Glück des Meeres',lure:'Köder',lunge:'Ausfallschritt'};
function roman(n){const pairs=[[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];let x=Number(n)||0,out='';for(const [v,s]of pairs)while(x>=v){out+=s;x-=v;}return out||String(n);}
function enchantments(item){return Object.entries(item?.enchantments||{}).map(([key,level])=>{const id=key.split(':').at(-1);return {id,name:enchantNames[id]||id.replaceAll('_',' '),level:Number(level),text:`${enchantNames[id]||id.replaceAll('_',' ')} ${roman(level)}`};});}
function remainingFromMs(ms){
  if(!Number.isFinite(ms))return 'Endzeit unbekannt';
  if(ms<=0)return 'Beendet';
  const mins=Math.floor(ms/60000),days=Math.floor(mins/1440),hours=Math.floor(mins%1440/60),minutes=mins%60,seconds=Math.floor(ms/1000%60);
  // Keep the short labels consistent in every card. Seconds are useful for
  // short auctions, while longer durations stay compact enough for mobile.
  if(days)return `${days} Tg. ${hours} Std.`;
  if(hours)return `${hours} Std. ${minutes} Min.`;
  if(minutes)return `${minutes} Min. ${seconds} Sek.`;
  return `${seconds} Sek.`;
}
function remaining(a){const timestamp=endTimestamp(a.endTime);return remainingFromMs(timestamp-Date.now());}
function countdownMarkup(a,prefix=''){
  const timestamp=endTimestamp(a.endTime);
  return `<span data-countdown-end="${Number.isFinite(timestamp)?timestamp:''}" data-countdown-prefix="${esc(prefix)}">${esc(prefix)}${remaining(a)}</span>`;
}
function updateCountdowns(){
  const now=Date.now();
  let overviewExpired=false;
  document.querySelectorAll('[data-countdown-end]').forEach(node=>{
    const raw=node.dataset.countdownEnd;
    if(!raw)return;
    const end=Number(raw),text=remainingFromMs(end-now);
    if(!Number.isFinite(end))return;
    const wasEnded=node.classList.contains('ended');
    node.textContent=node.dataset.countdownPrefix ? `${node.dataset.countdownPrefix}${text}` : text;
    node.classList.toggle('ended',end<=now);
    if(!wasEnded&&end<=now&&node.closest('#overview-auctions'))overviewExpired=true;
    node.setAttribute('aria-label',text);
  });
  // Remove expired overview rows as soon as their timer reaches zero. The
  // regular background refresh still reconciles the complete auction feed.
  if(overviewExpired&&state.page==='overview'&&state.auctions.length)renderOverviewHighlights();
}
let countdownTimer;
function startCountdownTimer(){
  if(countdownTimer)return;
  updateCountdowns();
  countdownTimer=setInterval(()=>{if(!document.hidden)updateCountdowns();},1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateCountdowns();},{passive:true});
}
function normalizedUuid(id){return String(id||'').toLowerCase();}
function isFloodgateUuid(id){return normalizedUuid(id).replaceAll('-','').startsWith('00000000000000000009');}
function profileFallback(id){return isFloodgateUuid(id)?'Bedrock-Spieler':'Spielername nicht verfügbar';}
function avatarMarkup(id){const p=state.profiles[normalizedUuid(id)];if(p?.name)return `<span class="player-avatar"><img src="https://mc-heads.net/avatar/${esc(String(id).replaceAll('-',''))}/64.png" loading="lazy" alt="Minecraft-Skin von ${esc(p.name)}"></span>`;if(p?.skin_url)return `<span class="player-avatar skin-head" style="background-image:url('${esc(p.skin_url)}')" aria-label="Minecraft-Skin"></span>`;return `<span class="player-avatar player-avatar-fallback" title="${esc(profileFallback(id))}">${isFloodgateUuid(id)?'B':'?'}</span>`;}
function decorateProfileNodes(){document.querySelectorAll('[data-profile-uuid]').forEach(node=>{const id=normalizedUuid(node.dataset.profileUuid),p=state.profiles[id];if(!p)return;const name=node.querySelector('.player-name');if(name)name.textContent=p.name||profileFallback(id);const avatar=node.querySelector('.player-avatar-slot');if(avatar)avatar.innerHTML=avatarMarkup(id);});}
async function loadPlayerProfiles(ids,auctionId){const keys=[...new Set(arrayOrEmpty(ids).filter(Boolean).map(normalizedUuid).filter(Boolean))],pending=keys.filter(id=>!Object.hasOwn(state.profiles,id));if(!pending.length){decorateProfileNodes();return;}try{const profiles=await api('profiles?uuids='+encodeURIComponent(pending.join(',')));if(!profiles||typeof profiles!=='object'||Array.isArray(profiles))return;for(const id of pending)if(profiles[id]&&typeof profiles[id]==='object')state.profiles[id]=profiles[id];if(state.activeAuction===auctionId&&$('#detail')?.open)decorateProfileNodes();}catch{if(state.activeAuction===auctionId&&$('#detail')?.open){document.querySelectorAll('[data-profile-uuid] .player-name').forEach(n=>{if(n.textContent==='Spielerprofil wird geladen …')n.textContent='Spielername nicht verfügbar';});}}}
function renderAuctionStats(rows){const soon=rows.filter(a=>{const m=(endTimestamp(a.endTime)-Date.now())/60000;return m>0&&m<=60}).length,buy=rows.filter(a=>a.instantBuyPrice>0).length;$('#auction-stats').innerHTML=[[rows.length,'Alle Auktionen','▦'],[soon,'Endet in 60 Min.','◷'],[buy,'Mit Sofortkauf','⚡'],[rows.reduce((n,a)=>n+Object.keys(a.bids||{}).length,0),'Gebote laut API','↗']].map(([v,t,i])=>`<div class="auction-stat"><span>${i}</span><b>${num(v)}</b><small>${t}</small></div>`).join('');}
function renderOverviewHighlights(){
  const now=Date.now(),active=arrayOrEmpty(state.auctions).filter(a=>a&&Number.isFinite(endTimestamp(a.endTime))&&endTimestamp(a.endTime)>now).sort((a,b)=>endTimestamp(a.endTime)-endTimestamp(b.endTime)),within=active.filter(a=>endTimestamp(a.endTime)-now<6*3600000),featured=(within.length?within:active).slice(0,5);
  $('#overview-auction-title').textContent=!active.length?'Keine aktiven Auktionen':within.length?'Endet in den nächsten 6 Stunden':'Die nächsten Auktionen';
  $('#overview-auction-subtitle').textContent=within.length?`${num(within.length)} Auktionen enden bald`:'Nach Restzeit sortiert';
  $('#overview-auctions').innerHTML=featured.map(a=>`<button class="overview-auction" data-overview-auction="${esc(a.uid||'')}"><span class="overview-item-icon">${image(a.item?.icon)}</span><span class="overview-item-text"><b>${esc(a.name||'Unbenanntes Item')}</b><small>${esc(a.categoryLabel||a.category||'Sonstiges')} · ${Object.keys(a.bids||{}).length} Gebote</small></span><span class="overview-item-price"><b>${cash(a.currentBid)}</b><small>◷ ${countdownMarkup(a)}</small></span></button>`).join('')||empty('Gerade keine aktiven Auktionen im Feed.');
  $('#overview-auctions').querySelectorAll('[data-overview-auction]').forEach(b=>b.onclick=()=>showAuction(b.dataset.overviewAuction));
  const groups=new Map();for(const a of active)for(const e of allSpecialEnchants(a.item||{}))groups.set(e.key,(groups.get(e.key)||0)+1);const top=[...groups.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);
  $('#overview-special').innerHTML=top.length?top.map(([key,count])=>{const [id,level]=key.split(':');return `<button class="spotlight-enchant" data-special-key="${esc(key)}"><span>${esc(enchantNames[id]||id.replaceAll('_',' '))} ${roman(level)}</span><b>${num(count)}</b></button>`;}).join(''):empty('Spezielle Verzauberungen erscheinen hier, sobald sie in aktiven Auktionen vorkommen.');
  $('#overview-special').querySelectorAll('[data-special-key]').forEach(b=>b.onclick=()=>{state.auctionCategoryRoot='';state.auctionCategorySub='';state.auctionCategoryType='';state.auctionEnchantFilter=b.dataset.specialKey;state.auctionEnchantQuery='';if($('#auction-search'))$('#auction-search').value='';page('auctions');});
}
function categoryRoot(name){const c=state.categories.find(x=>x.name===name);return c?.parentCategory||c?.name||name;}
function renderAuctionCategories(){const counts=new Map();for(const a of state.auctions){const root=categoryRoot(a.category);counts.set(root,(counts.get(root)||0)+1);}const roots=state.categories.filter(c=>!c.parentCategory&&counts.has(c.name));for(const [name]of counts)if(!roots.some(c=>c.name===name))roots.push({name,displayName:name.replaceAll('_',' ')});roots.sort((a,b)=>a.displayName.localeCompare(b.displayName,'de'));const chips=[['','Alle Auktionen',state.auctions.length],...roots.map(c=>[c.name,c.displayName,counts.get(c.name)||0])];$('#auction-category-filter').innerHTML=chips.map(([key,label,count])=>`<button class="filter-chip ${state.auctionCategoryRoot===key?'active':''}" data-auction-root="${esc(key)}">${esc(label)}<small>${num(count)}</small></button>`).join('');$('#auction-category-filter').querySelectorAll('[data-auction-root]').forEach(b=>b.onclick=()=>{state.auctionCategoryRoot=b.dataset.auctionRoot;state.auctionCategorySub='';state.auctionCategoryType='';renderAuctions();});const subHost=$('#auction-subcategories'),typeHost=$('#auction-tertiaries'),children=state.categories.filter(c=>c.parentCategory===state.auctionCategoryRoot&&state.auctionCategoryRoot);if(!children.length){subHost.hidden=true;subHost.innerHTML='';typeHost.hidden=true;typeHost.innerHTML='';return;}subHost.hidden=false;const subCounts=new Map();for(const a of state.auctions)if(categoryRoot(a.category)===state.auctionCategoryRoot)subCounts.set(a.category,(subCounts.get(a.category)||0)+1);const subs=[['','Alle in '+(roots.find(c=>c.name===state.auctionCategoryRoot)?.displayName||'Kategorie'),[...subCounts.values()].reduce((n,x)=>n+x,0)],...children.filter(c=>subCounts.has(c.name)).map(c=>[c.name,c.displayName,subCounts.get(c.name)])];subHost.innerHTML=subs.map(([key,label,count])=>`<button class="filter-chip sub-chip ${state.auctionCategorySub===key?'active':''}" data-auction-sub="${esc(key)}">${esc(label)}<small>${num(count)}</small></button>`).join('');subHost.querySelectorAll('[data-auction-sub]').forEach(b=>b.onclick=()=>{state.auctionCategorySub=b.dataset.auctionSub;state.auctionCategoryType='';renderAuctions();});if(!['sub_tools','sub_combat'].includes(state.auctionCategorySub)){typeHost.hidden=true;typeHost.innerHTML='';return;}const types=new Map();for(const a of state.auctions)if(a.category===state.auctionCategorySub){const t=auctionType(a,state.auctionCategorySub);types.set(t,(types.get(t)||0)+1);}const label=state.auctionCategorySub==='sub_tools'?'Alle Werkzeuge':'Alle Kampf-Items',options=[['',label,[...types.values()].reduce((n,x)=>n+x,0)],...[...types.entries()].sort((a,b)=>a[0].localeCompare(b[0],'de')).map(([name,count])=>[name,name,count])];typeHost.hidden=false;typeHost.innerHTML=`<span class="facet-label">ART</span>`+options.map(([key,name,count])=>`<button class="filter-chip type-chip ${state.auctionCategoryType===key?'active':''}" data-auction-type="${esc(key)}">${esc(name)}<small>${num(count)}</small></button>`).join('');typeHost.querySelectorAll('[data-auction-type]').forEach(b=>b.onclick=()=>{state.auctionCategoryType=b.dataset.auctionType;renderAuctions();});}
function auctionType(item,category){const rawItem=item?.item&&typeof item.item==='object'?item.item:{},material=String(rawItem.material||'').toUpperCase(),text=`${item?.name||''} ${arrayOrEmpty(rawItem.lore).join(' ')}`.toLowerCase();if(category==='sub_tools'){if(material.includes('PICKAXE')||/spitzhack|pickaxe|modpicke/.test(text))return 'Spitzhacken';if(material.endsWith('_AXE')||/\baxt\b|\baxe\b/.test(text))return 'Äxte';if(material.includes('SHOVEL')||/schaufel|shovel/.test(text))return 'Schaufeln';if(material.endsWith('_HOE')||/hacke|hoe/.test(text))return 'Hacken';if(material.includes('FISHING_ROD')||/angel|fishing rod/.test(text))return 'Angeln';return 'Sonstige Werkzeuge';}if(category==='sub_combat'){if(material.endsWith('_SWORD')||/schwert|sword/.test(text))return 'Schwerter';if(material.includes('CROSSBOW')||/armbrust|crossbow/.test(text))return 'Armbrüste';if(material.endsWith('_BOW')||/bogen|\bbow\b/.test(text))return 'Bögen';if(material==='TRIDENT'||/dreizack|trident/.test(text))return 'Dreizacke';return 'Sonstige Waffen';}return '';}
const standardEnchantmentLevels={protection:5,efficiency:5,unbreaking:3,mending:1,silk_touch:1,sharpness:5,smite:5,bane_of_arthropods:5,looting:3,sweeping_edge:3,fire_aspect:2,knockback:2,blast_protection:4,fire_protection:4,projectile_protection:4,feather_falling:4,depth_strider:3,frost_walker:2,respiration:3,aqua_affinity:1,thorns:3,soul_speed:3,swift_sneak:3,power:5,punch:2,flame:1,infinity:1,multishot:1,quick_charge:3,piercing:4,loyalty:3,impaling:5,riptide:3,channeling:1,density:5,breach:4,wind_burst:3,binding_curse:1,vanishing_curse:1,luck_of_the_sea:3,lure:3,lunge:3};
const auctionSearchCache=new WeakMap();
function auctionSearchText(a){let text=auctionSearchCache.get(a);if(text)return text;const item=a?.item&&typeof a.item==='object'?a.item:{};text=[a?.name,item.material,...arrayOrEmpty(item.lore),...enchantments(item).map(e=>e.text)].filter(Boolean).join(' ').toLocaleLowerCase('de');auctionSearchCache.set(a,text);return text;}
function auctionSearchMatches(a,q){return !q||auctionSearchText(a).includes(q);}
const relevantEnchants={tools:new Set(['efficiency','fortune','silk_touch','unbreaking','mending','sharpness','smite','bane_of_arthropods','looting','sweeping_edge','fire_aspect','knockback','luck_of_the_sea','lure','curse_of_vanishing']),pickaxes:new Set(['efficiency','fortune','silk_touch','unbreaking','mending']),axes:new Set(['efficiency','fortune','silk_touch','unbreaking','mending','sharpness','smite','bane_of_arthropods','looting','sweeping_edge','fire_aspect','knockback']),shovels:new Set(['efficiency','fortune','silk_touch','unbreaking','mending']),hoes:new Set(['efficiency','fortune','silk_touch','unbreaking','mending']),rods:new Set(['luck_of_the_sea','lure','unbreaking','mending']),combat:new Set(['sharpness','smite','bane_of_arthropods','looting','sweeping_edge','fire_aspect','knockback','power','punch','flame','infinity','multishot','quick_charge','piercing','loyalty','impaling','riptide','channeling','density','breach','wind_burst','unbreaking','mending']),armor:new Set(['protection','blast_protection','fire_protection','projectile_protection','feather_falling','depth_strider','frost_walker','respiration','aqua_affinity','thorns','soul_speed','swift_sneak','binding_curse','unbreaking','mending'])};
function enchantApplies(a,id){if(a.category==='sub_tools'){if(state.auctionCategoryType==='Spitzhacken')return relevantEnchants.pickaxes.has(id);if(state.auctionCategoryType==='Äxte')return relevantEnchants.axes.has(id);if(state.auctionCategoryType==='Schaufeln')return relevantEnchants.shovels.has(id);if(state.auctionCategoryType==='Hacken')return relevantEnchants.hoes.has(id);if(state.auctionCategoryType==='Angeln')return relevantEnchants.rods.has(id);return relevantEnchants.tools.has(id);}if(a.category==='sub_combat')return relevantEnchants.combat.has(id);if(categoryRoot(a.category)==='parent_armor')return relevantEnchants.armor.has(id);return true;}
function allSpecialEnchants(item){return Object.entries(item?.enchantments||{}).map(([raw,level])=>{const id=raw.split(':').at(-1),n=Number(level);return {id,n,key:`${id}:${n}`,text:`${enchantNames[id]||id.replaceAll('_',' ')} ${roman(n)}`};}).filter(x=>Number.isFinite(x.n)&&x.n>(standardEnchantmentLevels[x.id]??1));}
function specialEnchants(a){return allSpecialEnchants(a.item).filter(x=>enchantApplies(a,x.id));}
function auctionMatchesFacets(a){return(!$('#instant-only').checked||a.instantBuyPrice>0)&&(!state.auctionCategoryRoot||categoryRoot(a.category)===state.auctionCategoryRoot)&&(!state.auctionCategorySub||a.category===state.auctionCategorySub)&&(!state.auctionCategoryType||auctionType(a,state.auctionCategorySub)===state.auctionCategoryType);}
function enchantQueryMatches(a){const q=state.auctionEnchantQuery.trim().toLocaleLowerCase('de');return !q||specialEnchants(a).some(e=>e.text.toLocaleLowerCase('de').includes(q));}
function renderEnchantFilters(){const host=$('#auction-enchant-filters'),toolbar=$('#auction-enchant-toolbar'),counts=new Map(),itemQuery=$('#auction-search').value.trim().toLocaleLowerCase('de');for(const a of state.auctions){if(!auctionMatchesFacets(a)||!auctionSearchMatches(a,itemQuery))continue;for(const enchant of specialEnchants(a))counts.set(enchant.key,(counts.get(enchant.key)||0)+1);}const options=[...counts.entries()].map(([key,count])=>{const [id,level]=key.split(':');return {key,count,text:`${enchantNames[id]||id.replaceAll('_',' ')} ${roman(level)}`};}).sort((a,b)=>b.count-a.count||a.text.localeCompare(b.text,'de'));if(!options.length){host.hidden=true;host.innerHTML='';toolbar.hidden=true;state.auctionEnchantFilter='';state.auctionEnchantQuery='';const input=$('#auction-enchant-search');if(input)input.value='';return;}toolbar.hidden=false;host.hidden=false;const input=$('#auction-enchant-search');if(input&&input.value!==state.auctionEnchantQuery)input.value=state.auctionEnchantQuery;if(state.auctionEnchantFilter&&!counts.has(state.auctionEnchantFilter))state.auctionEnchantFilter='';const q=state.auctionEnchantQuery.trim().toLocaleLowerCase('de');const visible=options.filter(o=>o.text.toLocaleLowerCase('de').includes(q));host.innerHTML=`<button class="filter-chip enchant-filter-chip ${state.auctionEnchantFilter?'':'active'}" data-enchant-filter="">Alle Spezial-Level<small>${num([...counts.values()].reduce((n,x)=>n+x,0))}</small></button>`+(visible.map(o=>`<button class="filter-chip enchant-filter-chip ${state.auctionEnchantFilter===o.key?'active':''}" data-enchant-filter="${esc(o.key)}">${esc(o.text)}<small>${num(o.count)}</small></button>`).join('')||'<span class="facet-empty">Kein passendes Spezial-Level vorhanden.</span>');host.querySelectorAll('[data-enchant-filter]').forEach(b=>b.onclick=()=>{state.auctionEnchantFilter=b.dataset.enchantFilter;renderAuctions();});}
function renderAuctions() {
  state.auctions=arrayOrEmpty(state.auctions).filter(a=>a&&typeof a==='object');
  const q=($('#auction-search')?.value||'').toLowerCase();
  renderAuctionCategories();renderEnchantFilters();
  const rows=state.auctions.filter(a=>{const selected=state.auctionEnchantFilter;const exactEnchant=!selected||specialEnchants(a).some(e=>e.key===selected);return auctionSearchMatches(a,q)&&auctionMatchesFacets(a)&&exactEnchant&&enchantQueryMatches(a);});
  const sort=$('#auction-sort').value;
  const endSort=(a,b)=>{const ae=endTimestamp(a.endTime),be=endTimestamp(b.endTime);if(!Number.isFinite(ae))return 1;if(!Number.isFinite(be))return -1;return ae-be;};
  rows.sort(sort==='end'?endSort:sort==='bid-low'?(a,b)=>(a.currentBid||0)-(b.currentBid||0):sort==='bid-high'?(a,b)=>(b.currentBid||0)-(a.currentBid||0):(a,b)=>(a.instantBuyPrice||Infinity)-(b.instantBuyPrice||Infinity));
  renderAuctionStats(state.auctions);
  $('#auction-count').textContent=`${rows.length} Angebote`;
  $('#auction-grid').innerHTML=rows.slice(0,state.shown).map(a=>{const item=a.item||{},value=a.value||{},ench=enchantments(item),bids=Object.keys(a.bids||{}).length;return `<article class="auction-card" data-uid="${esc(a.uid||'')}" tabindex="0" role="button" aria-label="Details zu ${esc(a.name||'Unbenanntes Item')}"><div class="item-name">${image(item.icon)}<div><b>${esc(a.name||'Unbenanntes Item')}</b><small>${esc(a.categoryLabel||a.category||'Sonstiges')} · ${bids} Gebote</small></div></div><div class="auction-price-row"><div><small>AKTUELLES GEBOT</small><div class="price">${cash(a.currentBid)}</div></div><div class="time-left">◷ ${countdownMarkup(a)}</div></div>${a.instantBuyPrice>0?`<div class="buy-line">⚡ Sofortkauf <b>${cash(a.instantBuyPrice)}</b></div>`:''}${ench.length?`<div class="enchant-chips">${ench.slice(0,4).map(e=>`<span>${esc(e.text)}</span>`).join('')}${ench.length>4?`<span>+${ench.length-4}</span>`:''}</div>`:''}<div class="muted value-line">${value.median?`Typischer Verkaufspreis: ${cash(value.median)} / Stück · n=${value.samples||0}`:'Noch kein bestätigter Verkaufswert'}</div><div class="bottom"><span>${esc(item.material||'Unbekannt')} · ${num(item.amount||0)}×</span><span>Ende ${endDate(a)}</span></div></article>`;}).join('') || empty('Keine passenden Auktionen. Suche oder Kategorie ändern.');
  $('#more-auctions').hidden=rows.length<=state.shown;
  $('#auction-grid').querySelectorAll('[data-uid]').forEach(c=>{const open=()=>showAuction(c.dataset.uid);c.addEventListener('click',open);c.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});});
}
function showAuction(uid) {
  const a=state.auctions.find(a=>a.uid===uid); if(!a)return;
  const requestId=++detailRequestId;
  const item=a.item&&typeof a.item==='object'?a.item:{};
  const wasOpen=$('#detail').open, scrollTop=$('#detail').scrollTop;
  state.activeAuction=uid;
  const ench=enchantments(item), bids=Object.entries(a.bids&&typeof a.bids==='object'?a.bids:{}).sort((x,y)=>Number(y[1])-Number(x[1])), top=a.highestBidder||bids[0]?.[0];
  const bidTable=bids.length?`<div class="bid-list">${bids.map(([player,price],i)=>{const id=normalizedUuid(player);return `<div class="bid-row ${normalizedUuid(player)===normalizedUuid(top)?'highest':''}" data-profile-uuid="${esc(id)}"><span class="bid-rank">${i===0?'★':String(i+1).padStart(2,'0')}</span><span class="player-avatar-slot">${avatarMarkup(id)}</span><span class="bid-player"><b class="player-name">${state.profiles[id]?.name?esc(state.profiles[id].name):'Spielerprofil wird geladen …'}</b><small>${esc(id)}</small></span><b>${cash(price)}</b></div>`;}).join('')}</div>`:empty('Noch keine Gebote abgegeben.');
  const sellerId=normalizedUuid(a.seller);
  const alarmButton=state.status.public_site?'':`<button class="primary" id="alarm-this">Alarm für dieses Item</button>`;
  const value=a.value&&typeof a.value==='object'?a.value:{};
  $('#detail-content').innerHTML=`<div class="auction-detail-head">${image(item.icon)}<div><div class="eyebrow">${esc(a.categoryLabel||a.category||'Auktion')}</div><h2>${esc(a.name||'Unbenanntes Item')}</h2><p>${esc(item.material||'Unbekannt')} · ${num(item.amount||0)} Stück</p></div></div><div class="auction-hero-prices"><div><small>AKTUELLES GEBOT</small><b class="price">${cash(a.currentBid)}</b><span>${bids.length} Gebote</span></div><div><small>SOFORTKAUF</small><b class="${a.instantBuyPrice>0?'buy-price':'muted'}">${a.instantBuyPrice>0?cash(a.instantBuyPrice):'Nicht angeboten'}</b></div><div><small>RESTZEIT</small><b>◷ ${countdownMarkup(a)}</b><span>Endet ${endDate(a)}</span></div></div><div class="detail-fields"><div class="seller-profile" data-profile-uuid="${esc(sellerId)}"><small>Verkäufer</small><span class="seller-profile-row"><span class="player-avatar-slot">${avatarMarkup(sellerId)}</span><b class="player-name">${state.profiles[sellerId]?.name?esc(state.profiles[sellerId].name):'Spielerprofil wird geladen …'}</b></span><code>${esc(sellerId||'Unbekannt')}</code></div><div><small>Typischer Verkaufspreis dieser Variante</small><b>${cash(value.median)}</b><span class="note">${num(value.samples)} bestätigte Verkäufe · ${esc(value.confidence||'Keine Einstufung')}</span></div><div><small>Startgebot</small><b>${cash(a.startBid)}</b></div><div><small>Kategorie</small><b>${esc(a.categoryLabel||a.category||'Unbekannt')}</b></div></div><div class="detail-actions"><button class="secondary" id="copy-id">Auktions-ID kopieren</button>${alarmButton}</div>${ench.length?`<h3 class="detail-section-title">Verzauberungen</h3><div class="enchant-list">${ench.map(e=>`<div><span>${esc(e.name)}</span><b>${roman(e.level)}</b></div>`).join('')}</div>`:''}<h3 class="detail-section-title">Gebote · höchste zuerst</h3>${bidTable}<p class="note">Spielernamen und Skins werden – sofern die UUID öffentlich auflösbar ist – aus dem Mojang-Profil ergänzt. Floodgate/Bedrock-UUIDs können von der OPSUCHT-API ohne zusätzliche Serverdaten anonym bleiben.</p><h3 class="detail-section-title">Beschreibung</h3><pre class="lore">${esc(arrayOrEmpty(item.lore).join('\n')||'Keine zusätzliche Beschreibung.')}</pre><p class="note">In Minecraft auf opsucht.net im Auktionshaus prüfen. Gebote und Restzeit können sich jederzeit ändern.</p>`;
  $('#copy-id').onclick=async()=>{try{await navigator.clipboard.writeText(a.uid);toast('Auktions-ID kopiert');}catch{toast('Kopieren nicht verfügbar. ID steht oben.',true);}};
  if($('#alarm-this'))$('#alarm-this').onclick=()=>{$('#detail').close();page('rules');$('#rule-form [name=name]').value='Alarm: '+a.name;$('#rule-form [name=query]').value=a.name;$('#rule-form [name=max_price]').value=a.instantBuyPrice||'';};
  if(!wasOpen)$('#detail').showModal();else $('#detail').scrollTop=scrollTop;
  loadPlayerProfiles([a.seller,...bids.map(([player])=>player)],uid);
}
function catalogPrice(item){if(item.source_type==='market'&&item.last_trade?.avgPrice)return {label:'Letzter Handelsdurchschnitt',price:item.last_trade.avgPrice,state:'market'};if(item.source_type==='market'&&item.buy!=null)return {label:'Markt-Kaufpreis (BUY)',price:item.buy,state:'market'};if(item.source_type==='market'&&item.sell!=null)return {label:'Markt-Verkaufspreis (SELL)',price:item.sell,state:'market'};if(item.samples>0&&item.median!=null)return {label:'Typischer Verkaufspreis',price:item.median,state:'confirmed'};if(item.lowest_offer!=null)return {label:'Günstigstes aktives Angebot',price:item.lowest_offer,state:'offer'};if(item.lowest_bid!=null)return {label:'Aktuelles Höchstgebot',price:item.lowest_bid,state:'bid'};if(item.samples>0&&item.price_status==='unstable')return {label:'Kein stabiler Richtwert',price:null,state:'unstable'};return {label:'PREISSTATUS',price:null,state:'none'};}
function catalogSourceLabel(item){return item.source_type==='market'?'Marktmaterial':item.is_custom?'Custom Item':'Auktionsitem';}
function catalogRootLabel(root){return state.categories.find(c=>c.name===root)?.displayName||String(root||'Sonstiges').replaceAll('_',' ');}
function renderCatalogLegacy(){
  const query=$('#catalog-search').value.trim().toLocaleLowerCase('de'),source=state.catalogSource;
  const sourceRows=state.catalog.filter(item=>source==='all'||(source==='custom'&&item.is_custom)||(source==='market'&&item.source_type==='market')||(source==='unpriced'&&!item.has_price));
  const roots=new Map();for(const item of sourceRows){const root=categoryRoot(item.category)||'other';roots.set(root,(roots.get(root)||0)+1);}
  const categoryOptions=[['','Alle Kategorien',sourceRows.length],...[...roots.entries()].sort((a,b)=>catalogRootLabel(a[0]).localeCompare(catalogRootLabel(b[0]),'de')).map(([key,count])=>[key,catalogRootLabel(key),count])];
  $('#catalog-category-filter').innerHTML=categoryOptions.map(([key,label,count])=>`<button class="filter-chip ${state.catalogCategoryRoot===key?'active':''}" data-catalog-category="${esc(key)}">${esc(label)}<small>${num(count)}</small></button>`).join('');
  $('#catalog-category-filter').querySelectorAll('[data-catalog-category]').forEach(b=>b.onclick=()=>{state.catalogCategoryRoot=b.dataset.catalogCategory;renderCatalog();});
  const counts={all:state.catalog.length,custom:state.catalog.filter(x=>x.is_custom).length,market:state.catalog.filter(x=>x.source_type==='market').length,unpriced:state.catalog.filter(x=>!x.has_price).length};
  const sourceChips=[['all','Alles Erfasste'],['custom','Custom Items'],['market','Marktmaterialien'],['unpriced','Noch ohne Preis']];
  $('#catalog-source-filter').innerHTML=sourceChips.map(([key,label])=>`<button class="filter-chip ${source===key?'active':''}" data-catalog-source="${key}">${label}<small>${num(counts[key])}</small></button>`).join('');
  $('#catalog-source-filter').querySelectorAll('[data-catalog-source]').forEach(b=>b.onclick=()=>{state.catalogSource=b.dataset.catalogSource;state.catalogCategoryRoot='';state.catalogShown=60;renderCatalog();});
  const noPrice=state.catalog.filter(x=>!x.has_price).length,custom=state.catalog.filter(x=>x.is_custom).length;
  $('#catalog-summary').innerHTML=`<div class="market-stat"><b>${num(state.catalog.length)}</b><span>erfasste Items & Varianten</span></div><div class="market-stat"><b>${num(custom)}</b><span>Custom-Item-Varianten</span></div><div class="market-stat"><b>${num(noPrice)}</b><span>noch ohne beobachteten Preis</span></div>`;
  const rows=sourceRows.filter(item=>(!state.catalogCategoryRoot||(categoryRoot(item.category)||'other')===state.catalogCategoryRoot)&&(`${item.name} ${item.material} ${(item.lore||[]).join(' ')} ${enchantments({enchantments:item.enchantments}).map(e=>e.text).join(' ')}`).toLocaleLowerCase('de').includes(query));
  const sort=$('#catalog-sort').value;rows.sort(sort==='sales'?(a,b)=>(b.samples||0)-(a.samples||0):sort==='price-high'?(a,b)=>(catalogPrice(b).price??-1)-(catalogPrice(a).price??-1):sort==='recent'?(a,b)=>(b.last_seen||0)-(a.last_seen||0):(a,b)=>String(a.name).localeCompare(String(b.name),'de'));
  $('#catalog-count').textContent=`${num(rows.length)} Items`;
  $('#catalog-grid').innerHTML=rows.map(item=>{const price=catalogPrice(item),lore=(item.lore||[]).map(x=>x.trim()).filter(Boolean),attributes=lore.filter(x=>/^Gewinntyp|^Seltenheit/i.test(x)),description=lore.filter(x=>!/^Gewinntyp|^Seltenheit/i.test(x)).slice(0,2).join(' · '),ench=enchantments({enchantments:item.enchantments});return `<article class="value-card catalog-card clickable" data-catalog-key="${esc(item.variant)}" tabindex="0" role="button" aria-label="Details zu ${esc(item.name)}"><div class="value-card-head"><div class="value-icon">${image(item.icon)}</div><div class="value-title"><h3>${esc(item.name)}</h3><small>${esc(materialLabel(item.material))} · ${esc(item.categoryLabel||catalogRootLabel(categoryRoot(item.category)))}</small></div><span class="tag ${item.has_price?'':'tag-unpriced'}">${item.has_price?catalogSourceLabel(item):'NOCH KEIN PREIS'}</span></div>${attributes.length?`<div class="value-attributes">${attributes.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}${description?`<p class="value-description">${esc(description)}${lore.length>2?' …':''}</p>`:`<p class="value-description muted">${item.source_type==='market'?'Vanilla-Marktmaterial':'Noch keine Itembeschreibung im Feed'}</p>`}${ench.length?`<div class="enchant-chips">${ench.slice(0,6).map(e=>`<span>${esc(e.text)}</span>`).join('')}${ench.length>6?`<span>+${ench.length-6}</span>`:''}</div>`:''}<div class="catalog-price-row"><div><small>${esc(price.label)}</small><b class="${price.price!=null?'price':'muted'}">${price.price!=null?cash(price.price):'Noch kein Preis'}</b></div>${item.samples>0?`<span>${num(item.samples)} bestätigte Verkäufe</span>`:item.offers>0?`<span>${num(item.offers)} aktive Auktionen</span>`:''}</div>${(item.currency_values&&Object.keys(item.currency_values).length)?`<div class="catalog-shards">${Object.entries(item.currency_values).map(([key,x])=>`<span>≈ ${num(x.amount)} ${key==='opshards'?'OPShards':'Redcoins'}</span>`).join('')}</div>`:''}</article>`;}).join('')||empty('Keine Items für diese Filter gefunden. Versuche eine andere Kategorie oder Suche.');
  $('#catalog-grid').querySelectorAll('[data-catalog-key]').forEach(card=>{const open=()=>showCatalogItem(card.dataset.catalogKey);card.onclick=open;card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};});
}
async function showCatalogItemLegacy(key){
  const item=state.catalog.find(x=>x.variant===key);if(!item)return;
  $('#detail').showModal();$('#detail-content').innerHTML=empty('Itemdetails werden geladen …');
  const ench=enchantments({enchantments:item.enchantments}),lore=(item.lore||[]).map(x=>x.trim()).filter(Boolean),attributes=lore.filter(x=>/^Gewinntyp|^Seltenheit/i.test(x)),description=lore.filter(x=>!/^Gewinntyp|^Seltenheit/i.test(x));
  const price=catalogPrice(item),converted=Object.entries(item.currency_values||{}).map(([key,x])=>`<span>≈ ${num(x.amount)} ${key==='opshards'?'OPShards':'Redcoins'}</span>`).join('');
  let history='';
  try{if(item.samples>0){const sales=await api('sales/'+encodeURIComponent(item.variant));history=`<h3 class="detail-section-title">Verkaufspreise</h3>${valueTrend(item.sale_trend)}${chart(sales.slice().reverse().map(x=>({...x,label:date(x.at)})),'unit_price','label')}<div class="table-wrap"><table><thead><tr><th>Zeit</th><th>Gesamtpreis</th><th>Preis / Stück</th></tr></thead><tbody>${sales.slice(0,30).map(x=>`<tr><td>${date(x.at)}</td><td>${cash(x.price)}</td><td class="price">${cash(x.unit_price)}</td></tr>`).join('')}</tbody></table></div>`;}else if(item.source_type==='market'){const data=await api(`history/${encodeURIComponent(item.material)}?period=DAILY`);history=`<h3 class="detail-section-title">Abgeschlossene Markttrades</h3>${chart(data.history,'avgPrice','timestamp')}`;}}catch{}
  $('#detail-content').innerHTML=`<div class="eyebrow">${esc(catalogSourceLabel(item))}${item.has_price?' · PREISDATEN VORHANDEN':' · NOCH UNBEWERTET'}</div><div class="auction-detail-head">${image(item.icon)}<div><div class="eyebrow">${esc(item.categoryLabel||catalogRootLabel(categoryRoot(item.category)))}</div><h2>${esc(item.name)}</h2><p>${esc(materialLabel(item.material))} · ${esc(item.material)} · Variante ${esc(item.variant.slice(0,10))}</p></div></div>${attributes.length?`<div class="value-attributes">${attributes.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}${description.length?`<pre class="lore">${esc(description.join('\n'))}</pre>`:''}${ench.length?`<h3 class="detail-section-title">Verzauberungen</h3><div class="enchant-list">${ench.map(x=>`<div><span>${esc(x.name)}</span><b>${roman(x.level)}</b></div>`).join('')}</div>`:''}<div class="detail-fields"><div><small>${esc(price.label)}</small><b class="${price.price!=null?'price':'muted'}">${price.price!=null?cash(price.price):'Noch kein öffentlicher Preis'}</b></div><div><small>Aktive Auktionsangebote</small><b>${num(item.offers||0)}</b></div>${item.source_type==='market'?`<div><small>Markt-Kaufpreis (BUY)</small><b>${item.buy!=null?cash(item.buy):'Keine BUY-Order'}</b></div><div><small>Markt-Verkaufspreis (SELL)</small><b>${item.sell!=null?cash(item.sell):'Keine SELL-Order'}</b></div>`:''}</div>${converted?`<div class="value-currency-estimate"><small>GROBE SHARD-UMRECHNUNG</small><div>${converted}</div></div>`:''}${history||`<div class="empty">Noch keine abgeschlossenen Verkäufe oder Preisverläufe für dieses Item.</div>`}`;
}
function chart(points, valueKey, labelKey) {
  const data=arrayOrEmpty(points).filter(p=>p&&typeof p==='object'&&Number.isFinite(Number(p[valueKey]))).map(p=>({...p,[valueKey]:Number(p[valueKey])}));
  if(!data.length)return empty('Der Verlauf wird gerade gesammelt. Bitte später erneut öffnen.');
  let lo=Math.min(...data.map(p=>p[valueKey])), hi=Math.max(...data.map(p=>p[valueKey]));
  if(hi===lo){hi+=1;lo=Math.max(0,lo-1);}
  const xy=data.map((p,i)=>`${30+i/(Math.max(data.length-1,1))*700},${210-(p[valueKey]-lo)/(hi-lo)*180}`);
  return `<svg class="chart" viewBox="0 0 760 240" role="img" aria-label="Preisverlauf"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#59e4ad" stop-opacity=".25"/><stop offset="100%" stop-color="#59e4ad" stop-opacity="0"/></linearGradient></defs><path d="M30 210 L${xy.join(' L')} L730 210 Z" fill="url(#fill)"/><polyline points="${xy.join(' ')}" fill="none" stroke="#59e4ad" stroke-width="2.5"/><text x="30" y="20" fill="#8293a4" font-size="11">${esc(cash(hi))}</text><text x="30" y="233" fill="#8293a4" font-size="11">${esc(cash(lo))}</text></svg><div class="chart-labels"><span>${esc(data[0][labelKey])}</span><span>${data.length} Datenpunkte</span><span>${esc(data.at(-1)[labelKey])}</span></div>`;
}
async function showHistory(material,period='DAILY') {
  const requestId=++detailRequestId;
  state.activeHistory=material;
  if(!$('#detail').open)$('#detail').showModal();
  $('#detail-content').innerHTML='<div class="empty">Verlauf lädt …</div>';
  try {
    const d=await api(`history/${encodeURIComponent(material)}?period=${period}`);
    if(requestId!==detailRequestId)return;
    const m=state.market.find(x=>x.material===material), abc=state.abcPrices.find(x=>rateMaterialKey(x.id)===rateMaterialKey(material));
    const diamond=state.market.find(x=>x.material==='DIAMOND'), block=state.market.find(x=>x.material==='DIAMOND_BLOCK');
    const calculator=`<div class="market-calculator"><div><small>MENGENRECHNER</small><label>Menge (Stück)<input id="market-quantity" type="number" min="1" max="1000000" step="1" value="100" inputmode="numeric"></label></div><div id="market-calculation"></div><div id="diamond-comparison"></div></div>`;
    const abcPanel=abc?`<div class="detail-fields"><div><small>Referenzkurs · Ankauf / dein Erlös</small><b class="price">${cash(abc.buy_price)}</b></div><div><small>Referenzkurs · Verkauf / deine Kosten</small><b class="blue">${cash(abc.sell_price)}</b></div></div>`:'';
    $('#detail-content').innerHTML=`<div class="eyebrow">MARKTVERLAUF</div><h2 style="margin:15px 0 25px">${esc(material.replaceAll('_',' '))}</h2><div class="toolbar"><select id="history-period">${[['HOURLY','Stündlich'],['DAILY','Täglich'],['WEEKLY','Wöchentlich'],['MONTHLY','Monatlich']].map(([v,t])=>`<option value="${v}" ${v===period?'selected':''}>${t}</option>`).join('')}</select><span class="muted">Realisierter Durchschnitt / Stück</span></div>${chart(arrayOrEmpty(d.history),'avgPrice','timestamp')}<div class="detail-fields"><div><small>Aktuelle BUY-Orderseite · dein Erlös</small><b class="price">${cash(m?.buy)}</b></div><div><small>Aktuelle SELL-Orderseite · Einkauf</small><b class="blue">${cash(m?.sell)}</b></div></div>${abcPanel}${calculator}<h3>Eigene BUY-Kursmessungen</h3>${chart(arrayOrEmpty(d.quotes).map(p=>({...p,label:date(p.at)})),'buy','label')}<p class="note">ABC-Werte stammen aus der öffentlichen /sw-abc-Preisliste und sind ein separater Referenzkurs. BUY ist der Preis, den Käufer aktuell zahlen. Die Hochrechnung ist eine Momentaufnahme; bei großen Mengen können nicht alle Einheiten zum selben Kurs verkauft werden. Diamantblöcke werden zusätzlich mit 9 Diamanten verglichen.</p>`;
    const renderCalculation=()=>{const raw=Number($('#market-quantity')?.value),amount=Number.isFinite(raw)&&raw>0?Math.min(1000000,Math.floor(raw)):1,buy=Number(m?.buy),sell=Number(m?.sell),abcBuy=Number(abc?.buy_price),abcSell=Number(abc?.sell_price),buyTotal=buy>0?amount*buy:null,sellTotal=sell>0?amount*sell:null,abcBuyTotal=abcBuy>0?amount*abcBuy:null,abcSellTotal=abcSell>0?amount*abcSell:null;$('#market-calculation').innerHTML=`<div class="detail-fields"><div><small>${num(amount)}× · Marktverkauf (BUY)</small><b class="price">${buyTotal==null?'Keine BUY-Order':cash(buyTotal)}</b></div><div><small>${num(amount)}× · Markteinkauf (SELL)</small><b class="blue">${sellTotal==null?'Keine SELL-Order':cash(sellTotal)}</b></div>${abc?`<div><small>${num(amount)}× · ABC-Ankauf</small><b class="price">${abcBuyTotal==null?'Kein ABC-Kurs':cash(abcBuyTotal)}</b></div><div><small>${num(amount)}× · ABC-Verkauf</small><b class="blue">${abcSellTotal==null?'Kein ABC-Kurs':cash(abcSellTotal)}</b></div>`:''}</div>`;const diamondBuy=Number(diamond?.buy),blockBuy=Number(block?.buy),comparison=$('#diamond-comparison');if(!comparison||!['DIAMOND','DIAMOND_BLOCK'].includes(String(material).toUpperCase())){if(comparison)comparison.innerHTML='';return;}if(!(diamondBuy>0&&blockBuy>0)){comparison.innerHTML='';return;}const diamondsValue=diamondBuy*9,delta=blockBuy-diamondsValue,best=delta>=0?'1 Diamantblock':'9 Diamanten';comparison.innerHTML=`<div class="market-comparison"><small>DIAMANT-CHECK · AKTUELLER BUY-PREIS</small><div><span>9 Diamanten <b>${cash(diamondsValue)}</b></span><span>1 Diamantblock <b>${cash(blockBuy)}</b></span></div><p>${esc(best)} bringt aktuell ${cash(Math.abs(delta))} ${delta===0?'gleich viel':delta>0?'mehr':'weniger'} pro 9 Diamanten. Bei größeren Mengen können mehrere Orderstufen den echten Erlös verändern.</p></div>`;};
    if($('#market-quantity')){$('#market-quantity').oninput=renderCalculation;renderCalculation();}
    $('#history-period').onchange=e=>showHistory(material,e.target.value);
  } catch(e){if(requestId===detailRequestId)$('#detail-content').innerHTML=empty(e.message);}
}
function valueTrend(points){const data=(points||[]).filter(p=>Number.isFinite(p.unit_price));if(!data.length)return '';if(data.length===1)return `<div class="value-trend single-trend"><span>VERKAUFSVERLAUF</span><b>Erster Handel erfasst</b><small>${date(data[0].at)}</small></div>`;let lo=Math.min(...data.map(p=>p.unit_price)),hi=Math.max(...data.map(p=>p.unit_price));if(hi===lo){hi+=1;lo=Math.max(0,lo-1);}const xy=data.map((p,i)=>`${4+i/(data.length-1)*192},${32-(p.unit_price-lo)/(hi-lo)*26}`),pct=data[0].unit_price?((data.at(-1).unit_price/data[0].unit_price-1)*100):0,color=pct>=0?'#69e8b3':'#edc479';return `<div class="value-trend"><div><span>VERKAUFSVERLAUF · ${data.length} TRADES</span><b style="color:${color}">${pct>=0?'+':''}${num(pct)} %</b></div><svg viewBox="0 0 200 38" preserveAspectRatio="none" aria-label="Verkaufspreis-Trend"><polyline points="${xy.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${xy.at(-1).split(',')[0]}" cy="${xy.at(-1).split(',')[1]}" r="3" fill="${color}"/></svg><small>Letzter Verkauf ${date(data.at(-1).at)}</small></div>`;}
function valueExtras(v){const common=(v.price_distribution||[]).slice(0,3),currencies=v.currency_values||{};const range=v.price_group_min!=null&&v.price_group_max!=null?`<span>Typische Spanne <b>${cash(v.price_group_min)}–${cash(v.price_group_max)}</b></span>`:'';const freshness=v.sale_trend?.length?`<small class="value-source-note">Letzter bestätigter Verkauf: ${date(v.sale_trend.at(-1).at)}</small>`:'';const warning=v.price_status==='unstable'?`<p class="value-quality-warning"><b>Kein stabiler Richtwert.</b> ${v.indicative_price!=null?`Grobe Schätzung: <strong>${cash(v.indicative_price)}</strong> pro Stück. `:''}Die erfassten Verkäufe liegen zwischen ${cash(v.min_price)} und ${cash(v.max_price)}; es gibt noch keine ausreichend dominante Preisgruppe. Die Schätzung wird nicht für Alarme oder Umrechnungen verwendet.</p>`:v.price_status==='stable_with_outliers'?`<p class="value-quality-warning"><b>Ausreißer markiert.</b> Der Richtwert basiert auf einer Preisgruppe; ${num(v.outlier_prices?.length||0)} Verkauf${v.outlier_prices?.length===1?'':'e'} liegen außerhalb.</p>`:'';const distribution=common.length?`<div class="value-distribution"><small>HÄUFIGSTE VERKAUFSPREISE · 90 TAGE</small><div>${common.map(x=>`<span>${num(x.count)}× <b>${cash(x.price)}</b></span>`).join('')}${range}</div>${freshness}</div>`:'';const shardValues=Object.entries(currencies).map(([currency,x])=>`<span title="Grob umgerechnet über ${esc(materialLabel(x.source))} · ${cash(x.cost_per_currency)} pro ${esc(currency)}">≈ ${num(x.amount)} ${esc(currency==='opshards'?'OPShards':'Redcoins')}</span>`);const shards=shardValues.length?`<div class="value-currency-estimate"><small>TAUSCHWERT AUS STABILEM RICHTWERT · CA.</small><div>${shardValues.join('')}</div></div>`:'';return warning+distribution+shards;}
function renderValues() {
  const q=$('#value-search').value.toLowerCase(),priced=state.values.filter(v=>v.samples>0&&(Number.isFinite(v.median)||v.price_status==='unstable')),counts=new Map();
  for(const v of priced){const root=categoryRoot(v.category)||'other';counts.set(root,(counts.get(root)||0)+1);}
  const roots=state.categories.filter(c=>!c.parentCategory&&counts.has(c.name));for(const [name]of counts)if(!roots.some(c=>c.name===name))roots.push({name,displayName:String(name||'other').replaceAll('_',' ')});roots.sort((a,b)=>a.displayName.localeCompare(b.displayName,'de'));
  const chips=[['','Alle Itemarten',priced.length],...roots.map(c=>[c.name,c.displayName,counts.get(c.name)||0])];
  $('#value-category-filter').innerHTML=chips.map(([key,label,count])=>`<button class="filter-chip ${state.valueCategoryRoot===key?'active':''}" data-value-root="${esc(key)}">${esc(label)}<small>${num(count)}</small></button>`).join('');
  $('#value-category-filter').querySelectorAll('[data-value-root]').forEach(b=>b.onclick=()=>{state.valueCategoryRoot=b.dataset.valueRoot;renderValues();});
  const stableCount=priced.filter(v=>v.median!=null).length, unstableCount=priced.filter(v=>v.price_status==='unstable').length;
  $('#value-summary').innerHTML=`<div class="market-stat"><b>${num(stableCount)}</b><span>Varianten mit stabilem Richtwert</span></div><div class="market-stat"><b>${num(priced.reduce((n,v)=>n+v.samples,0))}</b><span>gespeicherte bestätigte Verkäufe</span></div><div class="market-stat"><b>${num(unstableCount)}</b><span>uneinheitliche Preisproben</span></div>`;
  const rows=priced.filter(v=>(!state.valueCategoryRoot||(categoryRoot(v.category)||'other')===state.valueCategoryRoot)&&(`${v.name} ${v.material} ${(v.lore||[]).join(' ')} ${enchantments({enchantments:v.enchantments}).map(e=>e.text).join(' ')}`).toLowerCase().includes(q));
  const sort=$('#value-sort').value;rows.sort(sort==='median-high'?(a,b)=>b.median-a.median:sort==='median-low'?(a,b)=>a.median-b.median:sort==='recent'?(a,b)=>(b.sale_trend?.at(-1)?.at||0)-(a.sale_trend?.at(-1)?.at||0):sort==='name'?(a,b)=>a.name.localeCompare(b.name,'de'):(a,b)=>b.samples-a.samples);
  $('#value-count').textContent=`${num(rows.length)} bewertete Varianten`;
  $('#value-grid').innerHTML=rows.map(v=>{const ench=enchantments({enchantments:v.enchantments}),lore=(v.lore||[]).map(x=>x.trim()).filter(Boolean),attributes=lore.filter(x=>/^Gewinntyp|^Seltenheit/i.test(x)),description=lore.filter(x=>!/^Gewinntyp|^Seltenheit/i.test(x)).slice(0,3).join(' · '),root=categoryRoot(v.category)||'other',category=roots.find(c=>c.name===root)?.displayName||String(v.category||'Item').replaceAll('_',' '),unstable=v.price_status==='unstable',tag=unstable?'UNEINHEITLICH':v.samples>=20?'BELASTBAR':v.samples>=5?'ERSTE DATEN':'WENIGE VERKÄUFE',shownEstimate=unstable&&v.indicative_price!=null;return `<article class="value-card clickable" data-key="${esc(v.variant)}" tabindex="0" role="button" aria-label="Verkaufshistorie für ${esc(v.name)}"><div class="value-card-head"><div class="value-icon">${image(v.icon)}</div><div class="value-title"><h3>${esc(v.name)}</h3><small>${esc(materialLabel(v.material))} · ${esc(category)}</small></div><span class="tag ${unstable?'tag-unpriced':''}">${tag}</span></div>${attributes.length?`<div class="value-attributes">${attributes.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}${description?`<p class="value-description">${esc(description)}${lore.length>3?' …':''}</p>`:`<p class="value-description muted">Keine Beschreibung hinterlegt.</p>`}${ench.length?`<div class="enchant-chips">${ench.map(e=>`<span>${esc(e.text)}</span>`).join('')}</div>`:`<div class="value-description muted">Keine Verzauberungen</div>`}${valueTrend(v.sale_trend)}${valueExtras(v)}<div class="value-numbers"><div><small>${unstable?(shownEstimate?'GROBE SCHÄTZUNG / STÜCK':'KEIN STABILER RICHTWERT'):'TYPISCHER VERKAUFSPREIS / STÜCK'}</small><b class="${unstable?(shownEstimate?'price':'muted'):'price'}">${unstable?(shownEstimate?cash(v.indicative_price):'Weitere Verkäufe nötig'):cash(v.median)}</b></div><div><small>GÜNSTIGSTES AKTIVES ANGEBOT</small><b class="blue">${v.lowest_offer!=null?cash(v.lowest_offer):'Keine offene Auktion'}</b></div></div><div class="value-foot"><span>${num(v.samples)} bestätigte Verkäufe · ${esc(v.confidence)}</span><span>${num(v.offers)} aktive Angebote ↗</span></div></article>`;}).join('') || empty('In dieser Kategorie noch keine Itemvarianten mit bestätigtem Verkaufspreis.');
  $('#value-grid').querySelectorAll('[data-key]').forEach(r=>{const open=()=>showSales(r.dataset.key);r.onclick=open;r.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};});
}
function renderCatalog(){
  const q=$('#catalog-search').value.trim().toLocaleLowerCase('de');
  let sourceRows=state.catalog.filter(item=>state.catalogSource==='all'||(state.catalogSource==='custom'&&item.is_custom)||(state.catalogSource==='market'&&item.source_type==='market')||(state.catalogSource==='unpriced'&&!item.has_price));
  const sourceCounts={all:state.catalog.length,custom:state.catalog.filter(x=>x.is_custom).length,market:state.catalog.filter(x=>x.source_type==='market').length,unpriced:state.catalog.filter(x=>!x.has_price).length};
  const sources=[['all','Alles Erfasste'],['custom','Custom Items'],['market','Marktmaterialien'],['unpriced','Noch ohne Preis']];
  $('#catalog-source-filter').innerHTML=sources.map(([key,label])=>`<button class="filter-chip ${state.catalogSource===key?'active':''}" data-catalog-source="${key}">${label}<small>${num(sourceCounts[key])}</small></button>`).join('');
  $('#catalog-source-filter').querySelectorAll('[data-catalog-source]').forEach(b=>b.onclick=()=>{state.catalogSource=b.dataset.catalogSource;state.catalogCategoryRoot='';renderCatalog();});
  const categoryCounts=new Map();for(const item of sourceRows){const root=categoryRoot(item.category)||'other';categoryCounts.set(root,(categoryCounts.get(root)||0)+1);}
  const categoryOptions=[['','Alle Kategorien',sourceRows.length],...[...categoryCounts.entries()].sort((a,b)=>catalogRootLabel(a[0]).localeCompare(catalogRootLabel(b[0]),'de')).map(([root,count])=>[root,catalogRootLabel(root),count])];
  $('#catalog-category-filter').innerHTML=categoryOptions.map(([key,label,count])=>`<button class="filter-chip ${state.catalogCategoryRoot===key?'active':''}" data-catalog-category="${esc(key)}">${esc(label)}<small>${num(count)}</small></button>`).join('');
  $('#catalog-category-filter').querySelectorAll('[data-catalog-category]').forEach(b=>b.onclick=()=>{state.catalogCategoryRoot=b.dataset.catalogCategory;state.catalogShown=60;renderCatalog();});
  $('#catalog-summary').innerHTML=`<div class="market-stat"><b>${num(state.catalog.length)}</b><span>erfasste Items & Varianten</span></div><div class="market-stat"><b>${num(sourceCounts.custom)}</b><span>Custom-Item-Varianten</span></div><div class="market-stat"><b>${num(sourceCounts.unpriced)}</b><span>noch ohne Preis</span></div>`;
  let rows=sourceRows.filter(item=>(!state.catalogCategoryRoot||(categoryRoot(item.category)||'other')===state.catalogCategoryRoot)&&`${item.name} ${item.material} ${(item.lore||[]).join(' ')} ${enchantments({enchantments:item.enchantments}).map(e=>e.text).join(' ')}`.toLocaleLowerCase('de').includes(q));
  const sort=$('#catalog-sort').value;
  rows.sort(sort==='sales'?(a,b)=>(b.samples||0)-(a.samples||0):sort==='price-high'?(a,b)=>(catalogPrice(b).price??-1)-(catalogPrice(a).price??-1):sort==='recent'?(a,b)=>(b.last_seen||0)-(a.last_seen||0):(a,b)=>String(a.name).localeCompare(String(b.name),'de'));
  $('#catalog-count').textContent=`${num(rows.length)} Items`;
  const visibleRows=rows.slice(0,state.catalogShown);
  $('#catalog-grid').innerHTML=visibleRows.map(item=>{
    const price=catalogPrice(item),lore=(item.lore||[]).map(x=>x.trim()).filter(Boolean),attributes=lore.filter(x=>/^Gewinntyp|^Seltenheit/i.test(x)),description=lore.filter(x=>!/^Gewinntyp|^Seltenheit/i.test(x)).slice(0,2).join(' · '),ench=enchantments({enchantments:item.enchantments});
    const sourceTag=item.is_custom?'CUSTOM ITEM':item.source_type==='market'?'MARKTMATERIAL':'AUKTIONITEM';
    return `<article class="value-card catalog-card clickable" data-catalog-key="${esc(item.variant)}" tabindex="0" role="button" aria-label="Details zu ${esc(item.name)}"><div class="value-card-head"><div class="value-icon">${image(item.icon)}</div><div class="value-title"><h3>${esc(item.name)}</h3><small>${esc(materialLabel(item.material))} · ${esc(item.categoryLabel||catalogRootLabel(categoryRoot(item.category)))}</small></div><span class="tag ${item.has_price?'':'tag-unpriced'}">${item.has_price?sourceTag:'NOCH KEIN PREIS'}</span></div>${attributes.length?`<div class="value-attributes">${attributes.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}${description?`<p class="value-description">${esc(description)}${lore.length>2?' …':''}</p>`:`<p class="value-description muted">${item.source_type==='market'?'Vanilla-Marktmaterial':'Noch keine Beschreibung im öffentlichen Feed.'}</p>`}${ench.length?`<div class="enchant-chips">${ench.slice(0,6).map(e=>`<span>${esc(e.text)}</span>`).join('')}${ench.length>6?`<span>+${ench.length-6}</span>`:''}</div>`:''}<div class="catalog-price"><small>${esc(price.label)}</small><b class="${price.price!=null?'price':'muted'}">${price.price!=null?cash(price.price):'Noch kein Preis im Feed'}</b>${item.samples>0?`<span>${num(item.samples)} bestätigte Verkäufe</span>`:item.offers>0?`<span>${num(item.offers)} aktive Auktionen</span>`:''}</div>${item.currency_values&&Object.keys(item.currency_values).length?`<div class="catalog-shards">${Object.entries(item.currency_values).map(([currency,x])=>`<span>≈ ${num(x.amount)} ${currency==='opshards'?'OPShards':'Redcoins'}</span>`).join('')}</div>`:''}</article>`;
  }).join('')||empty('Für diese Suche oder Kategorie wurden keine Items gefunden.');
  $('#catalog-grid').querySelectorAll('[data-catalog-key]').forEach(card=>{const open=()=>showCatalogItem(card.dataset.catalogKey);card.onclick=open;card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};});
  if($('#more-catalog'))$('#more-catalog').hidden=rows.length<=state.catalogShown;
}
async function showCatalogItem(key){
  const item=state.catalog.find(x=>x.variant===key);if(!item)return;
  const requestId=++detailRequestId;
  $('#detail').showModal();$('#detail-content').innerHTML=empty('Itemdetails werden geladen …');
  const ench=enchantments({enchantments:item.enchantments}),lore=(item.lore||[]).map(x=>x.trim()).filter(Boolean),attributes=lore.filter(x=>/^Gewinntyp|^Seltenheit/i.test(x)),description=lore.filter(x=>!/^Gewinntyp|^Seltenheit/i.test(x)),price=catalogPrice(item),converted=Object.entries(item.currency_values||{}).map(([currency,x])=>`<span>≈ ${num(x.amount)} ${currency==='opshards'?'OPShards':'Redcoins'}</span>`).join('');
  let history='';
  try{if(item.source_type==='market'){const data=await api(`history/${encodeURIComponent(item.material)}?period=DAILY`);history=`<h3 class="detail-section-title">Markt-Handelshistorie</h3>${chart(arrayOrEmpty(data?.history),'avgPrice','timestamp')}`;}else if(item.samples>0){const sales=arrayOrEmpty(await api('sales/'+encodeURIComponent(item.variant)));history=`<h3 class="detail-section-title">Bestätigte Verkäufe</h3>${valueTrend(item.sale_trend)}${chart(sales.slice().reverse().map(x=>({...x,label:date(x.at)})),'unit_price','label')}<div class="table-wrap"><table><thead><tr><th>Zeit</th><th>Gesamtpreis</th><th>Preis / Stück</th></tr></thead><tbody>${sales.slice(0,30).map(x=>`<tr><td>${date(x.at)}</td><td>${cash(x.price)}</td><td class="price">${cash(x.unit_price)}</td></tr>`).join('')}</tbody></table></div>`;}}catch{}
  if(requestId!==detailRequestId || state.activeAuction)return;
  $('#detail-content').innerHTML=`<div class="eyebrow">${esc(catalogSourceLabel(item))}${item.has_price?' · PREIS ERFASST':' · NOCH UNBEWERTET'}</div><div class="auction-detail-head">${image(item.icon)}<div><div class="eyebrow">${esc(item.categoryLabel||catalogRootLabel(categoryRoot(item.category)))}</div><h2>${esc(item.name)}</h2><p>${esc(materialLabel(item.material))} · Variante ${esc(item.variant.slice(0,10))}</p></div></div>${attributes.length?`<div class="value-attributes">${attributes.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}${description.length?`<pre class="lore">${esc(description.join('\n'))}</pre>`:''}${ench.length?`<h3 class="detail-section-title">Verzauberungen</h3><div class="enchant-list">${ench.map(x=>`<div><span>${esc(x.name)}</span><b>${roman(x.level)}</b></div>`).join('')}</div>`:''}<div class="detail-fields"><div><small>${esc(price.label)}</small><b class="${price.price!=null?'price':'muted'}">${price.price!=null?cash(price.price):'Noch kein öffentlicher Preis'}</b></div><div><small>Aktive Auktionen</small><b>${num(item.offers||0)}</b></div>${item.source_type==='market'?`<div><small>Markt-Kaufpreis (BUY)</small><b>${item.buy!=null?cash(item.buy):'Keine BUY-Order'}</b></div><div><small>Markt-Verkaufspreis (SELL)</small><b>${item.sell!=null?cash(item.sell):'Keine SELL-Order'}</b></div>`:''}</div>${item.price_distribution?.length?`<div class="value-distribution"><small>HÄUFIGSTE VERKAUFSPREISE</small><div>${item.price_distribution.map(x=>`<span>${num(x.count)}× <b>${cash(x.price)}</b></span>`).join('')}</div></div>`:''}${converted?`<div class="value-currency-estimate"><small>GROBE SHARD-UMRECHNUNG</small><div>${converted}</div></div>`:''}${history||'<div class="empty">Für dieses Item gibt es noch keine abgeschlossenen Verkäufe.</div>'}`;
}
async function showSales(key) {
  const v=state.values.find(v=>v.variant===key);
  if(!v)return;
  const requestId=++detailRequestId;
  $('#detail').showModal();$('#detail-content').innerHTML=empty('Verkäufe laden …');
  try {
    const rows=arrayOrEmpty(await api('sales/'+encodeURIComponent(key)));
    const ench=enchantments({enchantments:v.enchantments}),lore=(v.lore||[]).map(x=>x.trim()).filter(Boolean),attributes=lore.filter(x=>/^Gewinntyp|^Seltenheit/i.test(x)),description=lore.filter(x=>!/^Gewinntyp|^Seltenheit/i.test(x)),root=categoryRoot(v.category)||'',category=state.categories.find(c=>c.name===root)?.displayName||String(v.category||'Item').replaceAll('_',' ');
    if(requestId!==detailRequestId)return;
    const estimate=v.median==null&&v.indicative_price!=null;
    $('#detail-content').innerHTML=`<div class="eyebrow">ITEMWERT · ${num(v.samples)} BESTÄTIGTE VERKÄUFE</div><div class="auction-detail-head">${image(v.icon)}<div><div class="eyebrow">${esc(category)}</div><h2>${esc(v.name)}</h2><p>${esc(materialLabel(v.material))} · Variante ${esc(key.slice(0,8))}</p></div></div>${attributes.length?`<div class="value-attributes">${attributes.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}${description.length?`<p class="value-detail-description">${esc(description.join(' · '))}</p>`:''}${ench.length?`<h3 class="detail-section-title">Verzauberungen</h3><div class="enchant-chips">${ench.map(e=>`<span>${esc(e.text)}</span>`).join('')}</div>`:''}<div class="detail-fields"><div><small>${v.median!=null?'Typischer Verkaufspreis / Stück':estimate?'Grobe Schätzung / Stück':'Kein stabiler Richtwert'}</small><b class="${v.median!=null||estimate?'price':'muted'}">${v.median!=null?cash(v.median):estimate?cash(v.indicative_price):'Weitere Verkäufe nötig'}</b></div><div><small>Günstigstes aktives Angebot / Stück</small><b class="blue">${v.lowest_offer!=null?cash(v.lowest_offer):'Keine offene Auktion'}</b></div></div>${valueTrend(v.sale_trend)}${valueExtras(v)}<h3 class="detail-section-title">Einzelne Verkäufe</h3>${chart(rows.slice().reverse().map(s=>({...s,label:date(s.at)})),'unit_price','label')}<div class="table-wrap"><table><thead><tr><th>Zeit</th><th>Gesamtpreis</th><th>Preis / Stück</th></tr></thead><tbody>${rows.map(s=>`<tr><td>${date(s.at)}</td><td>${cash(s.price)}</td><td class="price">${cash(s.unit_price)}</td></tr>`).join('')}</tbody></table></div>`;
  }catch(e){if(requestId===detailRequestId)$('#detail-content').innerHTML=empty(e.message);}
}
function renderRules() {
  $('#rules-list').innerHTML=state.rules.map(r=>`<div class="rule-row"><div><b>${r.kind==='ending_bid'?'⏳':'⚡'} ${esc(r.name)}</b><small>Suche: ${esc(r.query)} · ${r.kind==='ending_bid'?`Höchstgebot unter ${cash(r.max_price)} · ${num(r.min_minutes)}–${num(r.max_minutes)} Min Restzeit`:`Sofortkauf unter ${cash(r.max_price)}`}${r.discount?' · mindestens '+num(r.discount)+' % unter Verkaufsmedian':''}</small></div><div class="actions"><button data-edit="${r.id}" class="secondary">Bearbeiten</button><button data-toggle="${r.id}" class="secondary">${r.enabled?'🟢 Aktiv':'⚪ Pausiert'}</button><button data-delete="${r.id}" class="danger">Löschen</button></div></div>`).join('') || empty('Noch keine Regeln. Erstelle oben deinen ersten Alarm.');
  $('#rules-list').querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>updateRule(b.dataset.toggle));
  $('#rules-list').querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Diese Alarmregel löschen?'))return;try{await api('rules/'+b.dataset.delete,'DELETE');await load();toast('Regel gelöscht');}catch(e){toast(e.message,true);}});
  $('#rules-list').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const r=state.rules.find(r=>r.id===+b.dataset.edit);const f=$('#rule-form');f.dataset.edit=r.id;f.elements.kind.value=r.kind||'instant';$('#rule-kind').dispatchEvent(new Event('change'));for(const k of ['name','query','max_price','discount','min_minutes','max_minutes'])if(f.elements[k])f.elements[k].value=r[k]??'';f.querySelector('button').textContent='Änderungen speichern';f.scrollIntoView({behavior:'smooth'});});
  $('#alert-log').innerHTML=alertTable(state.alerts);
}
async function updateRule(id) {const r=state.rules.find(r=>r.id===+id);try{await api('rules/'+id,'PUT',{...r,enabled:!r.enabled});await load();}catch(e){toast(e.message,true);}}
function sourceName(s) {
  if(String(s).startsWith('opshard:')) return String(s).slice(8).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  if(s.includes('626.0f'))return 'Gräbergemisch';if(s.includes('625.0f'))return 'Holzbündel';if(s.includes('635.0f'))return 'Steinplatten';return materialLabel(s.replace(/^minecraft:/,'').split('[')[0].toUpperCase());
}
function rateMaterialKey(value){return String(value||'').split('[',1)[0].replace(/^minecraft:/i,'').trim().toLowerCase();}
const customCosts=(()=>{try{return JSON.parse(localStorage.getItem('radar-custom-costs')||'{}')}catch{return {}}})();
function saveCustomCosts(){try{localStorage.setItem('radar-custom-costs',JSON.stringify(customCosts));}catch{}}
function renderRates() {
  const target=Math.max(1,+$('#target-amount').value||1000);
  const currency=$('#target-currency').value,query=$('#rate-search').value.trim().toLowerCase();
  const icons={diamond_block:'diamond_block',netherite_ingot:'netherite_ingot','626.0f':'gravel','625.0f':'oak_log','635.0f':'stone_slab',bone_block:'bone_block',book:'book',glistering_melon_slice:'glistering_melon_slice',ghast_tear:'ghast_tear',pumpkin_pie:'pumpkin_pie'};
  const options=state.rates.map((r,i)=>{const fixed=r.price_kind==='fixed_opshard_price',m=fixed?null:state.market.find(m=>rateMaterialKey(m.material)===rateMaterialKey(r.source)),key=`${r.target}|${r.source}`,marketCost=m?.buy,custom=Object.hasOwn(customCosts,key),cost=fixed?null:(custom?customCosts[key]:marketCost),name=r.displayName||sourceName(r.source),unitCost=fixed?null:(cost!=null&&r.exchangeRate>0?cost/r.exchangeRate:null);return {r,m,i,key,cost,marketCost,custom,name,unitCost,count:fixed?Math.floor(target/r.exchangeRate):Math.ceil(target/r.exchangeRate),fixed};}).filter(x=>x.r.target===currency&&(!state.merchantCategory||x.r.category===state.merchantCategory)&&(!query||`${x.name} ${x.r.source} ${x.r.category||''}`.toLowerCase().includes(query))).sort((a,b)=>(a.unitCost??Infinity)-(b.unitCost??Infinity));
  const categories=[...new Set(state.rates.filter(r=>r.target===currency).map(r=>r.category||'Marktmaterial'))].sort((a,b)=>a.localeCompare(b,'de'));
  const categoryHost=$('#merchant-category-filter');if(categoryHost){categoryHost.innerHTML=[['','Alle Kategorien'],...categories.map(c=>[c,c])].map(([key,label])=>`<button class="filter-chip ${state.merchantCategory===key?'active':''}" data-merchant-category="${esc(key)}">${esc(label)}</button>`).join('');categoryHost.querySelectorAll('[data-merchant-category]').forEach(b=>b.onclick=()=>{state.merchantCategory=b.dataset.merchantCategory;state.merchantShown=12;renderRates();});}
  const best=options.find(x=>x.unitCost!=null);
  $('#rates-summary').innerHTML=`<div class="merchant-summary-card"><span class="summary-icon">◎</span><div><small>DEIN ZIEL</small><b>${num(target)} ${esc(currency.toUpperCase())}</b></div></div><div class="merchant-summary-card"><span class="summary-icon">♛</span><div><small>GÜNSTIGSTER WEG</small><b>${best?esc(best.name):'Kosten fehlen'}</b></div></div><div class="merchant-summary-card"><span class="summary-icon">$</span><div><small>KOSTEN PRO ${esc(currency.toUpperCase())}</small><b>${best?cash(best.unitCost):'—'}</b></div></div>`;
  const visibleOptions=options.slice(0,state.merchantShown);
  $('#rates-grid').innerHTML=visibleOptions.map(x=>{
    const {r,m,key,cost,marketCost,custom,name,unitCost,count,fixed}=x;
    const iconKey=Object.keys(icons).find(k=>r.source.toLowerCase().includes(k)), iconMaterial=m?.material.toLowerCase()||icons[iconKey]||'paper';
    const iconUrl=r.icon||m?.icon||`https://img.mc-api.io/${iconMaterial}.png`,fallbackIcon=`https://img.mc-api.io/${iconMaterial}.png`;
    const iconStatus=String(r.icon_status||'');
    const iconStatusLabel=iconStatus==='custom_asset_unavailable'?'CUSTOM-ICON NICHT VERFÜGBAR':iconStatus==='vanilla_fallback'?'VANILLA-FALLBACK':'';
    const total=fixed?count*r.exchangeRate:(cost!=null?count*cost:null);
    const costControl=fixed?`<div class="market-cost-control fixed-opshard-price"><div><small>FESTER OPSHARD-HÄNDLERPREIS · ${esc(r.category||'OPSHARD-ITEMS')}</small><b>${num(r.exchangeRate)} OPSHARDS</b><small class="rate-source">Quelle: ${esc(r.source_label||'OPSUCHT OPShards-Händler')} · Screenshot ${esc(String(r.captured_at||'').replace('T',' ').replace('+02:00',''))}</small></div></div>`:(marketCost!=null?(custom?`<div class="custom-cost-control"><label>Eigener Preis pro Stück ($)<input class="rate-input" type="number" min="0.01" step="any" data-cost="${esc(key)}" value="${cost??''}" placeholder="Preis in Dollar"></label><button class="text-button use-market-price" type="button" data-market-price="${esc(key)}">↶ Kaufpreis verwenden · ${cash(marketCost)}</button></div>`:`<div class="market-cost-control"><div><small>AKTUELLER KAUFPREIS · ${num(m.buy_orders)} BUY-ORDERS</small><b>${cash(marketCost)}</b></div><button class="secondary" type="button" data-custom-price="${esc(key)}">Eigenen Preis setzen</button></div>`):`<label>Eigenen Preis pro Stück ($)<input class="rate-input" type="number" min="0.01" step="any" data-cost="${esc(key)}" value="${cost??''}" placeholder="Kein Kaufpreis · hier eingeben"></label>`);
    const targetLabel=r.target==='opshards'?'OPSHARDS':r.target.toUpperCase();
    return `<article class="auction-card rate-card ${best&&best.key===key?'best-rate':''}" style="cursor:default"><div class="rate-title"><div class="rate-icon ${iconStatus==='custom_asset_unavailable'?'icon-asset-unavailable':''}">${image(iconUrl,fallbackIcon)}</div><div><h3>${esc(name)}</h3><span class="tag">${best&&best.key===key?'GÜNSTIGSTER WEG':esc(r.category||targetLabel)}</span>${iconStatusLabel?`<small class="icon-status-note" title="${esc(r.icon_note||'')} ">${esc(iconStatusLabel)}</small>`:''}</div></div><div class="rate-yield"><span>${fixed?'FESTPREIS':' '+esc(targetLabel)+'-PREIS'} / ITEM</span><b>${num(r.exchangeRate)} <small>${esc(targetLabel)}</small></b></div>${costControl}<div class="metric"><span>${fixed?'Items für dein Budget':'Stück für dein Ziel'}</span><b>${num(count)}</b></div><div class="metric"><span>${fixed?'Ausgegeben':'Gesamtbudget'}</span><b>${fixed?num(total)+' OPSHARDS':cash(total)}</b></div><div class="metric"><span>${fixed?'Übrig':'Kosten pro '+esc(targetLabel)}</span><b>${fixed?num(Math.max(0,target-total))+' OPSHARDS':cash(unitCost)}</b></div><p class="note">${fixed?'Fester Preis aus dem OPSUCHT-OPShards-Händler · Budget wird auf ganze Items abgerundet':m?`OPSHARD-Händlerkurs · aktuelle BUY-Order · ${num(m.buy_orders)} aktive Kauforders`:'Kein Kaufpreis verfügbar · eigenen Preis nutzen'}${r.icon_note?`<br><span class="icon-source-note">${esc(r.icon_note)}</span>`:''}</p></article>`;
  }).join('') || empty('Für diese Währung keine passenden Händlerkurse gefunden.');
  let more=$('#more-rates');if(!more){more=document.createElement('button');more.id='more-rates';more.className='secondary';$('#rates-grid').after(more);}more.hidden=options.length<=state.merchantShown;more.textContent=`Weitere Händleritems laden (${Math.min(12,options.length-state.merchantShown)}+)`;
  more.onclick=()=>{state.merchantShown+=12;renderRates();};
  $('#rates-grid').querySelectorAll('[data-cost]').forEach(el=>el.onchange=()=>{const value=Number(el.value);customCosts[el.dataset.cost]=Number.isFinite(value)&&value>0?value:null;saveCustomCosts();renderRates();});
  $('#rates-grid').querySelectorAll('[data-custom-price]').forEach(button=>button.onclick=()=>{const option=options.find(x=>x.key===button.dataset.customPrice);customCosts[option.key]=option.marketCost;saveCustomCosts();renderRates();});
  $('#rates-grid').querySelectorAll('[data-market-price]').forEach(button=>button.onclick=()=>{delete customCosts[button.dataset.marketPrice];saveCustomCosts();renderRates();});
}
let loading=false,loadQueued=false;
async function load() {
  if(loading){loadQueued=true;return;}loading=true;
  const refreshButton=$('#refresh');
  if(refreshButton){refreshButton.disabled=true;refreshButton.dataset.previousLabel=refreshButton.textContent;refreshButton.textContent='↻ Lädt …';refreshButton.setAttribute('aria-busy','true');}
  const pageAtStart=state.page;
  try{
    let statusAvailable=true;
    try{state.status=(await api('status'))||{};}catch(statusError){
      // Keep price pages usable from their local cache when the API host is
      // temporarily offline. Other pages still surface the connection error.
      if(!['market','abc'].includes(pageAtStart))throw statusError;
      statusAvailable=false;
      // Preserve the public/owner surface while the status request is down;
      // public deployments must not suddenly expose owner navigation offline.
      state.status={stream:false,public_site:state.status.public_site===false?false:true};
    }
    renderStatus();
    if(state.token&&statusAvailable){
      try{await loadUserData();}
      catch(userError){if(!['market','abc'].includes(pageAtStart))throw userError;}
    }
    if((pageAtStart==='overview'||pageAtStart==='rules')&&!state.status.public_site){
      state.alerts=arrayOrEmpty(await api('alerts'));if($('#recent-alerts'))$('#recent-alerts').innerHTML=alertTable(state.alerts.slice(0,5));
      if(pageAtStart==='rules'){state.rules=arrayOrEmpty(await api('rules'));if(state.page===pageAtStart)renderRules();}
    }
    if(pageAtStart==='overview'){state.auctions=arrayOrEmpty(await api('auctions'));state.loadedAt.auctions=Date.now();if(state.page===pageAtStart)renderOverviewHighlights();}
    if(pageAtStart==='market'||pageAtStart==='abc'||pageAtStart==='merchant'){
      const [marketResult,abcResult]=await Promise.allSettled([api('market'),api('abc-prices')]);
      const marketCache=readPriceCache('market'),abcCache=readPriceCache('abc');
      const marketOk=marketResult.status==='fulfilled'&&Array.isArray(marketResult.value);
      const abcOk=abcResult.status==='fulfilled'&&Array.isArray(abcResult.value);
      if(marketOk){state.market=marketResult.value;state.cacheMeta.market=0;writePriceCache('market',state.market);state.loadedAt.market=Date.now();}
      else if(marketCache){state.market=marketCache.data;state.cacheMeta.market=marketCache.savedAt;state.loadedAt.market=marketCache.savedAt;}
      else state.market=[];
      if(abcOk){state.abcPrices=abcResult.value;state.cacheMeta.abc=0;writePriceCache('abc',state.abcPrices);state.loadedAt.abc=Date.now();}
      else if(abcCache){state.abcPrices=abcCache.data;state.cacheMeta.abc=abcCache.savedAt;state.loadedAt.abc=abcCache.savedAt;}
      else state.abcPrices=[];
      if(state.page===pageAtStart&&pageAtStart==='market'){
        renderMarket();renderCacheNotice('market');
      }else if(state.page===pageAtStart&&pageAtStart==='abc'){
        renderAbc();renderCacheNotice('abc');
      }else if(pageAtStart==='merchant'){state.rates=arrayOrEmpty(await api('rates'));if(state.page===pageAtStart)renderRates();}
      if(!marketOk&&!abcOk&&(marketCache||abcCache))toast('Keine Verbindung. Zuletzt gespeicherte Markt- und ABC-Preise werden angezeigt.');
      if(!marketOk&&!marketCache&&marketResult.status==='rejected')throw marketResult.reason;
      if(!abcOk&&!abcCache&&abcResult.status==='rejected'&&pageAtStart==='abc')throw abcResult.reason;
    }
    if(pageAtStart==='auctions'){
      const [auctions,categories]=await Promise.all([api('auctions'),api('auction-categories')]);
      state.auctions=arrayOrEmpty(auctions);state.categories=arrayOrEmpty(categories);state.loadedAt.auctions=Date.now();
      if(state.page===pageAtStart){renderAuctions();if(state.activeAuction&&$('#detail').open)showAuction(state.activeAuction);}
    }
    if(pageAtStart==='catalog'){const [catalog,categories]=await Promise.all([api('catalog'),api('auction-categories')]);state.catalog=arrayOrEmpty(catalog);state.categories=arrayOrEmpty(categories);state.loadedAt.catalog=Date.now();if(state.page===pageAtStart)renderCatalog();}
    if(pageAtStart==='values'){const [values,categories]=await Promise.all([api('values'),api('auction-categories')]);state.values=arrayOrEmpty(values);state.categories=arrayOrEmpty(categories);state.loadedAt.values=Date.now();if(state.page===pageAtStart)renderValues();}
  }catch (error) {
    const protectedPages = new Set(['catalog','values']);
    if (error?.status === 401 && protectedPages.has(pageAtStart)) {
      const host = document.querySelector(`#${pageAtStart}`);
      if (host) host.querySelectorAll('[data-price-content]').forEach(node => node.remove());
      if (host && !host.querySelector('.price-login-gate')) host.insertAdjacentHTML('afterbegin', `<article class="card price-login-gate"><div class="eyebrow">GESCHÜTZTE ITEMWERTE</div><h2>Bitte einloggen, um geschätzte Itemwerte zu sehen</h2><p>Marktpreise, ABC-Referenzkurse und feste OPSHARD-Händlerkurse bleiben öffentlich. Diese Itemwerte stammen aus beobachteten Auktionsverkäufen und sind Schätzungen, keine garantierten Verkaufspreise. Einzelne Ausreißer, Mengen und mehrere Preisstufen können das Ergebnis verändern.</p><button class="primary" type="button" data-goto="auth">Einloggen oder kostenlos registrieren ↗</button></article>`);
      host.querySelector('[data-goto="auth"]')?.addEventListener('click', event => page(event.currentTarget.dataset.goto));
      return;
    }
    throw error;
  }finally{
    loading=false;
    if(refreshButton){refreshButton.disabled=false;refreshButton.textContent=refreshButton.dataset.previousLabel||'↻ Aktualisieren';refreshButton.removeAttribute('aria-busy');}
    if(loadQueued){loadQueued=false;queueMicrotask(()=>load().catch(e=>toast(e.message,true)));}
  }
}
if($('#refresh'))$('#refresh').onclick=()=>load().catch(e=>toast(e.message,true));
const marketSearch=debounce(renderMarket),abcSearch=debounce(renderAbc),auctionSearch=debounce(()=>{state.shown=60;renderAuctions();}),valueSearch=debounce(renderValues),catalogSearch=debounce(()=>{state.catalogShown=60;renderCatalog();}),rateSearch=debounce(renderRates),enchantSearch=debounce(()=>{state.auctionEnchantFilter='';renderAuctions();});
if($('#market-search'))$('#market-search').addEventListener('input',marketSearch);
if($('#market-sort'))$('#market-sort').addEventListener('change',renderMarket);
if($('#abc-search'))$('#abc-search').addEventListener('input',abcSearch);
if($('#abc-sort'))$('#abc-sort').addEventListener('change',renderAbc);
if($('#auction-search'))$('#auction-search').addEventListener('input',auctionSearch);
if($('#instant-only'))$('#instant-only').addEventListener('change',()=>{state.shown=60;renderAuctions();});
if($('#auction-sort'))$('#auction-sort').addEventListener('change',renderAuctions);
if($('#value-search'))$('#value-search').addEventListener('input',valueSearch);
if($('#value-sort'))$('#value-sort').addEventListener('change',renderValues);
if($('#catalog-search'))$('#catalog-search').addEventListener('input',catalogSearch);
if($('#catalog-sort'))$('#catalog-sort').addEventListener('change',renderCatalog);
if($('#more-catalog'))$('#more-catalog').onclick=()=>{state.catalogShown+=60;renderCatalog();};
if($('#more-auctions'))$('#more-auctions').onclick=()=>{state.shown+=60;renderAuctions();};
if($('#auction-enchant-search'))$('#auction-enchant-search').oninput=e=>{state.auctionEnchantQuery=e.target.value;enchantSearch();};
if($('#target-amount'))$('#target-amount').oninput=renderRates;
if($('#target-currency'))$('#target-currency').onchange=()=>{state.merchantShown=12;state.merchantCategory='';renderRates();};
if($('#rate-search'))$('#rate-search').oninput=()=>{state.merchantShown=12;rateSearch();};
if($('#auth-login-form'))$('#auth-login-form').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));try{const result=await api('auth/login','POST',data);setUserToken(result.token);state.user=result.user;await loadUserData();toast('Erfolgreich eingeloggt.');}catch(err){toast(err.message,true);}};
if($('#auth-register-form'))$('#auth-register-form').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));try{const result=await api('auth/register','POST',data);setUserToken(result.token);state.user=result.user;await loadUserData();toast('Konto erstellt.');}catch(err){toast(err.message,true);}};
if($('#auth-logout'))$('#auth-logout').onclick=async()=>{try{await api('auth/logout','POST');}catch{}setUserToken('');state.user=null;state.userRules=[];state.userAlerts=[];renderAuthState();toast('Abgemeldet.');};
if($('#auth-refresh'))$('#auth-refresh').onclick=()=>loadUserData().catch(e=>toast(e.message,true));
if($('#auth-webhook-form'))$('#auth-webhook-form').onsubmit=async e=>{e.preventDefault();const f=e.target,mention=f.elements.mention.value,mentionId=f.elements.mention_id.value.trim();try{const value=mention==='user'||mention==='role'?`${mention}:${mentionId}`:mention;await api('me/webhook','POST',{webhook:f.elements.webhook.value,mention:value});await loadUserData();toast('Discord-Webhook gespeichert.');}catch(err){toast(err.message,true);}};
if($('#auth-webhook-remove'))$('#auth-webhook-remove').onclick=async()=>{try{await api('me/webhook','DELETE');await loadUserData();toast('Webhook entfernt.');}catch(e){toast(e.message,true);}};
if($('#auth-webhook-test'))$('#auth-webhook-test').onclick=async()=>{try{await api('me/webhook/test','POST');toast('Testnachricht gesendet.');}catch(e){toast(e.message,true);}};
if($('#auth-webhook-form select'))$('#auth-webhook-form select').onchange=e=>{$('#auth-mention-id').hidden=!['user','role'].includes(e.target.value);};
if($('#minecraft-link'))$('#minecraft-link').onclick=async()=>{const name=$('#minecraft-username').value.trim();if(!/^[A-Za-z0-9_]{3,16}$/.test(name))return toast('Minecraft-Name muss 3–16 Zeichen haben.',true);const button=$('#minecraft-link');button.disabled=true;try{const edition=$('#minecraft-edition')?.value||'java';const result=await api('me/minecraft','POST',{username:name,edition});state.user=result.user;state.minecraftChallenge=result.challenge||null;renderAccountLink();startMinecraftPolling();toast('Profil gefunden. Führe den angezeigten /link-Befehl ingame aus.');$('#minecraft-challenge')?.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(err){toast(err.message,true);}finally{button.disabled=false;}};
if($('#minecraft-copy-code'))$('#minecraft-copy-code').onclick=async()=>{const code=$('#minecraft-command')?.textContent||'';try{await navigator.clipboard.writeText(code);toast('Minecraft-Befehl kopiert.');}catch{toast('Kopieren nicht verfügbar. Befehl manuell übernehmen.',true);}};
let minecraftPollTimer=0;
function startMinecraftPolling(){clearInterval(minecraftPollTimer);if(!state.token)return;minecraftPollTimer=setInterval(async()=>{try{const user=await api('me');if(user?.minecraft_verified){state.user=user;state.minecraftChallenge=null;renderAccountLink();toast('Minecraft-Besitz wurde vom Server bestätigt.');clearInterval(minecraftPollTimer);}}catch{}},5000);}
if($('#minecraft-unlink'))$('#minecraft-unlink').onclick=async()=>{const button=$('#minecraft-unlink');button.disabled=true;try{await api('me/minecraft','DELETE');clearInterval(minecraftPollTimer);await loadUserData();toast('Minecraft-Verknüpfung entfernt.');}catch(err){toast(err.message,true);}finally{button.disabled=false;}};
if($('#user-rule-form'))$('#user-rule-form').onsubmit=async e=>{e.preventDefault();const f=e.target,data=Object.fromEntries(new FormData(f));try{await api('me/rules','POST',data);f.reset();await loadUserData();toast('Persönlicher Preisalarm gespeichert.');}catch(err){toast(err.message,true);}};
if($('#user-rule-form select'))$('#user-rule-form select').onchange=e=>{$('#user-rule-times').hidden=e.target.value!=='ending_bid';};
if($('#admin-token')){ $('#admin-token').oninput=e=>state.token=e.target.value; $('#admin-token').onchange=()=>load().catch(e=>toast(e.message,true)); }
if($('#close-detail'))$('#close-detail').onclick=()=>{$('#detail').close();state.activeAuction=null;};
if($('#detail'))$('#detail').addEventListener('close',()=>state.activeAuction=null);
if($('#detail'))$('#detail').addEventListener('click',e=>{if(e.target===$('#detail')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
if($('#rule-form'))$('#rule-form').onsubmit=async e=>{
  e.preventDefault();const f=e.target,b=f.querySelector('button'),data=Object.fromEntries(new FormData(f));b.disabled=true;
  try{await api(f.dataset.edit?'rules/'+f.dataset.edit:'rules',f.dataset.edit?'PUT':'POST',data);f.reset();delete f.dataset.edit;b.textContent='+ Alarm aktivieren';$('#rule-kind').dispatchEvent(new Event('change'));await load();toast('Alarmregel gespeichert. Aktuelle Angebote werden geprüft.');}catch(e){toast(e.message,true);}finally{b.disabled=false;}
};
if($('#rule-kind'))$('#rule-kind').onchange=()=>{
  const ending=$('#rule-kind').value==='ending_bid';
  $('#discount-label').hidden=ending;$('#ending-options').hidden=!ending;
  $('#max-label').innerHTML=ending?'Aktuelles Höchstgebot strikt unter ($)<input name="max_price" type="number" min="0.01" step="any" placeholder="1500000">':'Sofortkauf-Gesamtpreis strikt unter ($)<input name="max_price" type="number" min="0.01" step="any" placeholder="1700000">';
  $('#rule-hint').textContent=ending?'Ping, wenn die Modpicke noch 10–20 Minuten läuft und das aktuelle Höchstgebot unter 1,5 Mio liegt. Gemessen wird das Gebot, nicht der Sofortkaufpreis.':'Preisgrenze oder Rabatt angeben. Bei beiden müssen beide Bedingungen passen. Rabattalarme brauchen mindestens 5 Verkäufe der exakt gleichen Variante.';
};
if($('#test-webhook'))$('#test-webhook').onclick=async()=>{const b=$('#test-webhook');b.disabled=true;try{await api('webhook/test','POST');toast('Testnachricht gesendet');}catch(e){toast(e.message,true);}finally{b.disabled=false;}};
if($('#maintenance-form'))$('#maintenance-form').onsubmit=async e=>{e.preventDefault();const f=e.target,b=f.querySelector('button');b.disabled=true;try{const result=await api('maintenance','POST',{enabled:$('#maintenance-enabled').checked,message:$('#maintenance-message').value});state.status.maintenance=result.maintenance;renderStatus();toast('Wartungsstatus gespeichert.');}catch(error){toast(error.message,true);}finally{b.disabled=false;}};
if($('#settings-form'))$('#settings-form').onsubmit=async e=>{e.preventDefault();const f=e.target,b=f.querySelector('button');b.disabled=true;const data=Object.fromEntries([...new FormData(f)].filter(([,v])=>v.trim()!==''));try{const r=await api('settings','POST',data);f.reset();await load();toast(r.restart_bot?'Gespeichert. Radar neu starten, um die Panel-Bot-Einstellung zu aktivieren.':'Verbindung gespeichert.');}catch(e){toast(e.message,true);}finally{b.disabled=false;}};
startCountdownTimer();
enhanceAccessibility();
initPrivacyControls();
const initialAuction=new URLSearchParams(location.search).get('auction');
if(initialAuction)page('auctions',{load:false});
load().then(async()=>{if(initialAuction){if(!state.auctions.some(a=>a.uid===initialAuction)){const exact=await api('auctions?uid='+encodeURIComponent(initialAuction));if(exact.length)state.auctions.push(exact[0]);}renderAuctions();showAuction(initialAuction);}}).catch(e=>toast(e.message,true));
// Do not replace large result grids while a user is typing or selecting a filter.
// The next interval refreshes the data once focus is released.
setInterval(()=>{if(!document.hidden&&!document.querySelector('input:focus,select:focus,textarea:focus'))load().catch(e=>toast(e.message,true));},30000);


