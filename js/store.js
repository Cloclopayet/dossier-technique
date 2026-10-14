/* Données de l'appli : fiches lues depuis Drive, gardées en cache dans le navigateur (IndexedDB) pour ne retélécharger
   que ce qui a changé. Les fichiers (PDF, photos) ne changent jamais : leur cache est permanent (plafonné). */
'use strict';

const IDB_NAME = 'dossier-technique', IDB_VERSION = 2;
const RAFRAICHIR_MS = 30000;
const CACHE_FICHIERS_MAX = 600 * 1024 * 1024;     // au-delà, on vide les plus anciens
const PARALLELE = 10;

function idbOpen() {
  return new Promise((ok, ko) => {
    const rq = indexedDB.open(IDB_NAME, IDB_VERSION);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('json')) d.createObjectStore('json');       // fileId → { version, data }
      if (!d.objectStoreNames.contains('bin')) d.createObjectStore('bin');         // driveId → { bytes, t, taille }
      if (!d.objectStoreNames.contains('apercu')) d.createObjectStore('apercu');   // driveId → image de la 1re page (miniatures)
    };
    rq.onsuccess = () => { rq.result.onversionchange = () => rq.result.close(); ok(rq.result); };
    rq.onerror = () => ko(rq.error);
    rq.onblocked = () => ko(new Error('base locale bloquée par un autre onglet'));   // l'appli tourne alors sans cache
  });
}
function idbDo(db, store, mode, fn) {
  return new Promise((ok, ko) => {
    const tx = db.transaction(store, mode);
    let res; const rq = fn(tx.objectStore(store));
    if (rq) rq.onsuccess = () => { res = rq.result; };
    tx.oncomplete = () => ok(res);
    tx.onerror = () => ko(tx.error);
    tx.onabort = () => ko(tx.error || new Error('abort'));
  });
}
async function parLots(items, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLELE, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const STORE = {
  idb: null,
  fiches: new Map(),           // 'col/id' → { col, id, fileId, version, data }
  onChange: () => {},
  timer: null, chargement: null,

  async ouvrir() {
    try { this.idb = await idbOpen(); } catch (_) { this.idb = null; }   // navigation privée : on travaille sans cache
  },
  async cacheGet(store, k) { if (!this.idb) return undefined; try { return await idbDo(this.idb, store, 'readonly', s => s.get(k)); } catch (_) { return undefined; } },
  async cachePut(store, k, v) { if (!this.idb) return; try { await idbDo(this.idb, store, 'readwrite', s => s.put(v, k)); } catch (_) { /* quota plein : le cache est facultatif */ } },

  /* relit la liste des fiches sur Drive et ne télécharge que celles qui ont changé */
  async charger() {
    if (this.chargement) return this.chargement;
    this.chargement = (async () => {
      const debut = Date.now();
      const liste = await DRIVE.listeFiches();
      const vus = new Set();
      let change = false;
      await parLots(liste, async f => {
        const k = f.col + '/' + f.id; vus.add(k);
        const cur = this.fiches.get(k);
        if (cur && cur.version === f.version && cur.fileId === f.fileId) return;
        if (cur && cur.fileId === f.fileId && cur.version > f.version) return;   // liste lue juste avant notre propre enregistrement
        let brut;
        const c = await this.cacheGet('json', f.fileId);
        if (c && c.version === f.version) brut = c.data;
        else {
          // fichier abîmé ou supprimé entre la liste et la lecture : on l'ignore (sans bloquer le reste)
          try { brut = await DRIVE.lireJson(f.fileId); } catch (e) { if (e && (e.login || e.network)) throw e; console.warn('Fiche illisible ignorée :', f.col, f.id); return; }
          await this.cachePut('json', f.fileId, { version: f.version, data: brut });
        }
        // jamais utilisée telle quelle : remise en forme (types, identifiants, formats) — voir MODELE.normaliser
        const data = MODELE.normaliser(f.col, f.id, brut);
        this.fiches.set(k, { col: f.col, id: f.id, fileId: f.fileId, version: f.version, data });
        change = true;
      });
      for (const [k, f] of [...this.fiches.entries()]) if (!vus.has(k) && !(f.ecritLe > debut)) { this.fiches.delete(k); change = true; }
      if (change) this.onChange();
    })().finally(() => { this.chargement = null; });
    return this.chargement;
  },
  demarrer() {
    if (this.timer) return;
    setTimeout(() => this.elaguer(), 15000);
    this.timer = setInterval(() => { if (document.visibilityState === 'visible' && DRIVE.valid()) this.charger().catch(() => {}); }, RAFRAICHIR_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && DRIVE.valid()) this.charger().catch(() => {}); });
  },

  liste(col) { return [...this.fiches.values()].filter(f => f.col === col).map(f => f.data); },
  get(col, id) { const f = this.fiches.get(col + '/' + id); return f ? f.data : null; },

  /* enregistre ; si quelqu'un a modifié la fiche depuis `base` (la version de départ), on fusionne :
     chacun garde ses changements (voir MODELE.fusionner). Renvoie { data, fusionAvec } */
  async enregistrer(col, data, base, opts) {
    data = MODELE.normaliser(col, data.id, data);
    const k = col + '/' + data.id;
    const signer = x => ({ ...x, maj: new Date().toISOString(), majPar: (DRIVE.me && DRIVE.me.name) || '' });
    let cur = this.fiches.get(k);
    let d = signer(data), r, fusionAvec = null;
    if (!cur && base) throw { status: 410, supprime: true, message: 'Cette fiche a été supprimée par un collègue : modification abandonnée.' };
    if (!cur) r = await DRIVE.creerJson(col, data.id, d);
    else {
      // la version locale a peut-être déjà été rafraîchie depuis l'ouverture : on part de là
      if (base && cur.data.maj !== base.maj) { fusionAvec = cur.data.majPar || 'un collègue'; d = signer(MODELE.normaliser(col, data.id, MODELE.fusionner(base, data, cur.data))); }
      for (let tour = 0; ; tour++) {
        r = await DRIVE.ecrireJson(cur.fileId, d, cur.version);
        if (!r.conflit) break;
        if (tour >= 3) throw { message: 'Trop de modifications simultanées sur cette fiche : réessaie dans un instant.' };
        const frais = await DRIVE.lireAvecVersion(cur.fileId);
        frais.data = MODELE.normaliser(col, data.id, frais.data);
        cur = { ...cur, version: frais.version, data: frais.data };
        fusionAvec = frais.data.majPar || 'un collègue';
        d = signer(MODELE.normaliser(col, data.id, MODELE.fusionner(base || null, data, frais.data)));
      }
    }
    const fileId = cur ? cur.fileId : r.fileId;
    this.fiches.set(k, { col, id: data.id, fileId, version: r.version, data: d, ecritLe: Date.now() });
    await this.cachePut('json', fileId, { version: r.version, data: d });
    if (!(opts && opts.silencieux)) this.onChange();   // import en masse : un seul rafraîchissement à la fin
    return { data: d, fusionAvec };
  },
  async supprimer(col, id) {
    const cur = this.fiches.get(col + '/' + id);
    if (cur) await DRIVE.corbeille(cur.fileId);
    this.fiches.delete(col + '/' + id);
    this.onChange();
  },

  /* ---------- fichiers ---------- */
  async fichier(item) {
    const c = await this.cacheGet('bin', item.driveId);
    if (c && c.bytes) return new Uint8Array(c.bytes);
    const bytes = await DRIVE.telecharger(item.driveId);
    await this.cachePut('bin', item.driveId, { bytes: bytes.buffer.slice(0), t: Date.now(), taille: bytes.byteLength });
    return bytes;
  },
  /* ménage du cache (lit tout le cache : lancé une fois au démarrage et après chaque génération, jamais en parallèle) */
  elagage: null,
  elaguer() {
    if (!this.elagage) this.elagage = this.elaguerMaintenant().catch(() => {}).finally(() => { this.elagage = null; });
    return this.elagage;
  },
  async elaguerMaintenant() {
    if (!this.idb) return;
    const tout = [];
    await new Promise((ok, ko) => {
      const tx = this.idb.transaction('bin', 'readonly');
      const rq = tx.objectStore('bin').openCursor();
      rq.onsuccess = () => { const c = rq.result; if (c) { tout.push({ k: c.key, t: c.value.t || 0, taille: c.value.taille || 0 }); c.continue(); } };
      tx.oncomplete = ok; tx.onerror = () => ko(tx.error);
    });
    let total = tout.reduce((s, x) => s + x.taille, 0);
    if (total <= CACHE_FICHIERS_MAX) return;
    tout.sort((a, b) => a.t - b.t);
    for (const x of tout) { if (total <= CACHE_FICHIERS_MAX * 0.8) break; await idbDo(this.idb, 'bin', 'readwrite', s => s.delete(x.k)); total -= x.taille; }
  },
  async vider() { this.fiches.clear(); if (this.idb) { this.idb.close(); this.idb = null; } await new Promise(ok => { const rq = indexedDB.deleteDatabase(IDB_NAME); rq.onsuccess = rq.onerror = rq.onblocked = () => ok(); }); }
};
