/* Petits outils d'interface : échappement, messages, fenêtres, fichiers, conversion d'images, lecture de PDF. */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const errMsg = e => (e && e.message) || String(e || 'Erreur inconnue');
const dateFr = iso => { try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch (_) { return ''; } };
const dateHeureFr = iso => { try { return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
const taille = n => n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' ko';

/* ---------- messages ---------- */
function toast(msg, genre = 'ok', duree = 4200) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + genre;
  el.setAttribute('role', genre === 'err' ? 'alert' : 'status');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('sort'); setTimeout(() => el.remove(), 300); }, duree);
}

/* ---------- fenêtre de confirmation ---------- */
function confirmer(titre, texte, bouton = 'Confirmer', danger = false) {
  return new Promise(ok => {
    const d = document.createElement('dialog');
    d.className = 'dlg petit';
    d.innerHTML = `<h3>${esc(titre)}</h3><p>${esc(texte)}</p><div class="actions"><button class="btn" value="non">Annuler</button><button class="btn ${danger ? 'danger' : 'primaire'}" value="oui">${esc(bouton)}</button></div>`;
    document.body.appendChild(d);
    d.addEventListener('click', e => { const b = e.target.closest('button'); if (b) d.close(b.value); });
    d.addEventListener('close', () => { ok(d.returnValue === 'oui'); d.remove(); });
    d.showModal();
  });
}

/* ---------- fichiers ---------- */
function choisirFichiers(accept, multiple = true) {
  return new Promise(ok => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.addEventListener('change', () => ok([...i.files]));
    i.click();
  });
}
const IMAGE_MAX = 2000;
/* photo → JPEG ≤ 2000 px (les photos de téléphone pèsent souvent 5-10 Mo) */
async function versJpeg(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch (_) { throw { message: `« ${file.name} » : format d’image non lu par le navigateur. Enregistre-la en JPG ou PNG.` }; }
  const k = Math.min(1, IMAGE_MAX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
  return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg' });
}
/* type réel d'après les premiers octets : seuls PDF, JPEG et PNG sont ouverts ou affichés */
function typeReel(b) {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';   // %PDF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  return null;
}
const TAILLE_MAX = 100 * 1024 * 1024;
const estPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const estImage = f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name);

/* envoi d'un fichier dans fichiers/ ; renvoie l'entrée à ranger dans la fiche */
async function envoyerFichier(file, extra, onProgres) {
  let f = file;
  if (estImage(f) && !estPdf(f)) f = await versJpeg(f);
  else if (!estPdf(f)) throw { message: `« ${file.name} » : seuls les PDF et les images sont acceptés.` };
  if (f.size > TAILLE_MAX) throw { message: `« ${file.name} » dépasse 100 Mo.` };
  if (typeReel(new Uint8Array(await f.slice(0, 8).arrayBuffer())) !== (estPdf(f) ? 'application/pdf' : 'image/jpeg')) throw { message: `« ${file.name} » n’est pas un vrai ${estPdf(f) ? 'PDF' : 'fichier image'}.` };
  const fid = randomId();
  const r = await DRIVE.envoyer(f, `${fid} - ${MODELE.nomFichier(f.name)}`, DRIVE.sub.fichiers, { fid }, onProgres);
  if (!r.id) throw { message: 'Envoi terminé sans réponse de Google : réessaie.' };
  const bytes = new Uint8Array(await f.arrayBuffer());
  await STORE.cachePut('bin', r.id, { bytes: bytes.buffer, t: Date.now(), taille: bytes.byteLength });
  return { fid, driveId: r.id, nom: file.name, mime: f.type || 'application/pdf', taille: f.size, ...extra };
}
async function ouvrirFichier(item) {
  const w = window.open('', '_blank');
  try {
    const bytes = await STORE.fichier(item);
    const type = typeReel(bytes);   // jamais le type écrit dans la fiche (une page web déguisée s'exécuterait ici)
    if (!type) throw { message: `« ${item.nom || 'fichier'} » n’est ni un PDF ni une image : ouverture refusée.` };
    const blob = new Blob([bytes], { type });
    if (!w) { telechargerBlob(blob, MODELE.nomFichier(item.nom || 'document')); return; }
    const url = URL.createObjectURL(blob);
    w.opener = null;
    w.location = url;
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) { if (w) w.close(); toast(errMsg(e), 'err'); }
}
function telechargerBlob(blob, nom) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/* vignettes des photos (URL d'objets gardées pour la session) */
const VIGNETTES = new Map();
async function vignette(item) {
  if (VIGNETTES.has(item.driveId)) return VIGNETTES.get(item.driveId);
  const p = STORE.fichier(item).then(b => {
    const type = typeReel(b);
    if (!/^image\//.test(type || '')) throw new Error('pas une image');
    return URL.createObjectURL(new Blob([b], { type }));
  });
  VIGNETTES.set(item.driveId, p);
  p.catch(() => VIGNETTES.delete(item.driveId));
  return p;
}
function chargerVignettes(root = document) {
  for (const img of $$('img[data-vignette]', root)) {
    if (img.dataset.ok) continue;
    img.dataset.ok = '1';
    vignette({ driveId: img.dataset.vignette, mime: img.dataset.mime }).then(u => { img.src = u; }).catch(() => { img.alt = '⚠️'; });
  }
}

/* ---------- PDF : texte (CCTP, devis) et rendu en images (PDF protégés) ---------- */
async function pdfjs() {
  if (!window.pdfjsLib) await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'vendor/pdf.min.js'; s.onload = ok; s.onerror = () => ko({ message: 'Lecteur PDF introuvable.' }); document.head.appendChild(s); });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  return window.pdfjsLib;
}
async function textePdf(bytes) {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  let t = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    t += c.items.map(x => x.str + (x.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  pdf.destroy();
  return t;
}
const RENDU_ECHELLE = 2;          // ≈ 144 dpi : lisible à l'impression sans alourdir à l'excès
const RENDU_PAGES_MAX = 300;
const RENDU_PIXELS_MAX = 25e6;    // par page (une page géante ferait tomber l'onglet)
async function rasteriser(bytes) {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  if (pdf.numPages > RENDU_PAGES_MAX) { pdf.destroy(); throw { message: `plus de ${RENDU_PAGES_MAX} pages` }; }
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const echelle = Math.min(RENDU_ECHELLE, Math.sqrt(RENDU_PIXELS_MAX / (v1.width * v1.height)));
    const v = page.getViewport({ scale: echelle });
    const c = document.createElement('canvas'); c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    // intention « impression » : ne dépend pas de l'affichage (sinon le rendu s'arrête quand l'onglet passe en arrière-plan)
    await page.render({ canvasContext: g, viewport: v, intent: 'print' }).promise;
    const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
    out.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: v1.width, h: v1.height });
    c.width = c.height = 0;
  }
  pdf.destroy();
  return out;
}

/* ---------- miniatures : 1re page des fiches, dessinée à la demande (visible à l'écran) et gardée en cache ---------- */
const APERCU_LARGEUR = 360;
const APERCU_PARALLELE = 2;
const APERCU_PIXELS_MAX = 4e6;            // une page géante ne doit pas bloquer l'onglet
const APERCU_TAILLE_MAX = 30 * 1048576;   // au-delà, pas de miniature (le PDF entier serait téléchargé)
const APERCUS = new Map();          // driveId → Promise<url>
const FILE_APERCUS = [];
let apercusEnCours = 0;
async function fabriquerApercu(driveId, taille) {
  const cache = await STORE.cacheGet('apercu', driveId);
  if (cache && cache.bytes) return URL.createObjectURL(new Blob([cache.bytes], { type: 'image/jpeg' }));
  if (taille > APERCU_TAILLE_MAX) throw new Error('fichier trop gros pour une miniature');
  const bytes = await STORE.fichier({ driveId });
  if (typeReel(bytes) !== 'application/pdf') throw new Error('pas un PDF');
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    if (!(v1.width > 1 && v1.height > 1)) throw new Error('page vide');
    const v = page.getViewport({ scale: Math.min(APERCU_LARGEUR / v1.width, Math.sqrt(APERCU_PIXELS_MAX / (v1.width * v1.height))) });
    const c = document.createElement('canvas'); c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: v, intent: 'print' }).promise;
    const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.78));
    await STORE.cachePut('apercu', driveId, { bytes: await blob.arrayBuffer(), t: Date.now() });
    return URL.createObjectURL(blob);
  } finally { pdf.destroy(); }
}
const APERCUS_RATES = new Set();
function suivantApercu() {
  while (apercusEnCours < APERCU_PARALLELE && FILE_APERCUS.length) {
    const { driveId, taille, img, ok, ko } = FILE_APERCUS.pop();   // la dernière carte vue d'abord
    if (img && !img.isConnected) { APERCUS.delete(driveId); ko(new Error('carte disparue')); continue; }
    apercusEnCours++;
    fabriquerApercu(driveId, taille).then(ok, ko).finally(() => { apercusEnCours--; suivantApercu(); });
  }
}
function apercu(driveId, taille, img) {
  if (APERCUS_RATES.has(driveId)) return Promise.reject(new Error('aperçu indisponible'));
  if (!APERCUS.has(driveId)) {
    const p = new Promise((ok, ko) => { FILE_APERCUS.push({ driveId, taille, img, ok, ko }); suivantApercu(); });
    p.catch(e => { APERCUS.delete(driveId); if (!/disparue/.test(e && e.message)) APERCUS_RATES.add(driveId); });
    APERCUS.set(driveId, p);
  }
  return APERCUS.get(driveId);
}
let observateurApercus = null;
function chargerApercus(root = document) {
  if (!observateurApercus) {
    observateurApercus = new IntersectionObserver(entrees => {
      for (const e of entrees) {
        if (!e.isIntersecting) continue;
        const img = e.target; observateurApercus.unobserve(img);
        img.classList.add('charge');
        apercu(img.dataset.apercu, Number(img.dataset.taille) || 0, img).then(u => { img.src = u; img.classList.remove('charge'); })
          .catch(() => { img.classList.remove('charge'); img.classList.add('rate'); img.alt = 'Aperçu indisponible'; });
      }
    }, { rootMargin: '300px' });
  }
  for (const img of $$('img[data-apercu]', root)) if (!img.dataset.vu) { img.dataset.vu = '1'; observateurApercus.observe(img); }
}
