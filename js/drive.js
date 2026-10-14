/* Google Drive comme « serveur » partagé (reprise allégée de Bons à fermer : ici, on travaille en ligne).
   Dossier racine partagé « Dossiers techniques GSE » :
     donnees/   un fichier JSON par fiche : produit__<id>.json, chantier__<id>.json, reglages__app.json
     fichiers/  PDF et photos (immuables : un nouveau document = un nouveau fichier)
     dossiers/  dossiers techniques générés (un par chantier, remplacé à chaque génération) */
'use strict';

const G_SCOPES = 'openid email profile https://www.googleapis.com/auth/drive';
const G_ROOT_NAME = 'Dossiers techniques GSE';
const G_FOLDER = 'application/vnd.google-apps.folder';
const G_BASE = (window.DT_CONFIG && DT_CONFIG.apiBase) || 'https://www.googleapis.com';   // remplacé seulement pour les tests
const G_API = G_BASE + '/drive/v3';
const G_UP = G_BASE + '/upload/drive/v3';
const G_AUTH = (window.DT_CONFIG && DT_CONFIG.authUrl) || 'https://accounts.google.com/o/oauth2/v2/auth';
const G_ALL = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
const ARBRE_MAX = 30000;   // fichiers lus au plus par l'assistant d'import
const COLS = new Set(['produit', 'chantier', 'reglages', 'kit']);
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} };
/* le jeton Google ne vit que dans l'onglet (sessionStorage) : l'adresse github.io est partagée avec d'autres applis */
const ssGet = k => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };
const ssSet = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (_) {} };
const G_REVOKE = (window.DT_CONFIG && DT_CONFIG.apiBase) ? null : 'https://oauth2.googleapis.com/revoke';
/* identifiant Drive lu dans une fiche : contrôlé avant d'entrer dans une adresse */
const idDrive = id => { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw { message: 'Identifiant de fichier invalide.' }; return encodeURIComponent(id); };
const qStr = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

function randomId() {
  const a = new Uint8Array(12); crypto.getRandomValues(a);
  return Array.from(a, b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

const DRIVE = {
  clientId: () => (window.DT_CONFIG && DT_CONFIG.clientId) || '',
  token: null, me: null, root: null, sub: {}, verifies: new Set(),

  /* ---------- connexion (OAuth implicite par redirection) ---------- */
  init() {
    try { this.token = JSON.parse(ssGet('dt-token') || 'null'); } catch (_) { this.token = null; }
    this.email = lsGet('dt-email');   // seulement pour pré-remplir le compte chez Google
    this.root = lsGet('dt-root');
    try { this.sub = JSON.parse(lsGet('dt-sub') || '{}'); } catch (_) { this.sub = {}; }
    return this.readRedirect();
  },
  redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); },
  login(silent) {
    const state = randomId();
    lsSet('dt-oauth-state', state);
    const p = new URLSearchParams({
      client_id: this.clientId(), redirect_uri: this.redirectUri(), response_type: 'token', scope: G_SCOPES,
      include_granted_scopes: 'true', state, prompt: silent ? 'none' : 'select_account'
    });
    const hint = (this.token && this.token.email) || this.email; if (hint) p.set('login_hint', hint);
    location.assign(G_AUTH + '?' + p);
  },
  readRedirect() {
    if (!location.hash || !/(access_token|error)=/.test(location.hash)) return null;
    const h = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    const expected = lsGet('dt-oauth-state'); lsSet('dt-oauth-state', null);
    if (!expected || h.get('state') !== expected) return { error: 'Réponse de connexion inattendue : recommence.' };
    if (h.get('error')) return { error: h.get('error') };
    if (!String(h.get('scope') || '').includes('/auth/drive')) return { error: 'Autorise l’accès à Google Drive : il est nécessaire pour ranger les fiches.' };
    this.token = { access: h.get('access_token'), exp: Date.now() + (parseInt(h.get('expires_in'), 10) || 3600) * 1000 };
    ssSet('dt-token', JSON.stringify(this.token));
    return { ok: true };
  },
  valid() { return !!(this.token && this.token.access && this.token.exp - 60000 > Date.now()); },
  forget() {
    const t = this.token && this.token.access;
    if (t && G_REVOKE) fetch(G_REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + encodeURIComponent(t) }).catch(() => {});
    this.token = null; this.root = null; this.sub = {}; this.verifies.clear();
    ssSet('dt-token', null); for (const k of ['dt-root', 'dt-sub', 'dt-email']) lsSet(k, null);
  },

  /* ---------- appels REST ---------- */
  async call(url, opts = {}) {
    if (!this.valid()) throw { status: 401, login: true, message: 'Connexion Google expirée.' };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout || 30000);
    let r;
    try { r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + this.token.access, ...(opts.headers || {}) }, signal: ctl.signal }); }
    catch (_) { throw { network: true, message: 'Pas de réseau (ou délai dépassé).' }; }
    finally { clearTimeout(timer); }
    if (r.ok) return opts.raw ? r : (r.status === 204 ? {} : r.json());
    let msg = 'Erreur Google ' + r.status, reason = '';
    try { const e = await r.json(); msg = (e.error && e.error.message) || msg; reason = e.error && e.error.errors && e.error.errors[0] && e.error.errors[0].reason; } catch (_) {}
    if (r.status === 401) { this.token = { email: this.token && this.token.email }; ssSet('dt-token', JSON.stringify(this.token)); throw { status: 401, login: true, message: 'Connexion Google expirée.' }; }
    if (r.status === 403 && /rateLimit/i.test(reason || msg)) throw { status: 429, message: 'Google demande de ralentir : réessaie dans un instant.' };
    throw { status: r.status, reason, message: msg };
  },
  async list(q, fields = 'id,name,version,modifiedTime,appProperties') {
    const out = []; let token = '';
    do {
      const r = await this.call(`${G_API}/files?${G_ALL}&pageSize=1000&q=${encodeURIComponent(q)}&fields=${encodeURIComponent('nextPageToken,files(' + fields + ')')}${token ? '&pageToken=' + token : ''}`);
      out.push(...r.files); token = r.nextPageToken || '';
    } while (token);
    return out;
  },
  async about() {
    const r = await this.call(`${G_API}/about?fields=${encodeURIComponent('user(displayName,emailAddress)')}`);
    this.me = { email: r.user.emailAddress.toLowerCase(), name: r.user.displayName || r.user.emailAddress };
    this.token.email = this.me.email; ssSet('dt-token', JSON.stringify(this.token)); lsSet('dt-email', this.me.email);
    return this.me;
  },
  async createFolder(name, parent) {
    return this.call(`${G_API}/files?${G_ALL}&fields=id,name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: G_FOLDER, parents: parent ? [parent] : undefined }) });
  },
  async folderIn(parent, name) {
    const f = await this.list(`${qStr(parent)} in parents and name = ${qStr(name)} and mimeType = '${G_FOLDER}' and trashed = false`, 'id,name');
    return f.length ? f[0].id : (await this.createFolder(name, parent)).id;
  },

  /* ---------- dossier partagé ---------- */
  async findRoots() {
    return this.list(`name = ${qStr(G_ROOT_NAME)} and mimeType = '${G_FOLDER}' and trashed = false`, 'id,name,ownedByMe,owners(displayName,emailAddress)');
  },
  async useRoot(id) {
    const f = await this.call(`${G_API}/files/${id}?${G_ALL}&fields=${encodeURIComponent('id,ownedByMe,capabilities(canEdit,canShare),owners(emailAddress)')}`);
    if (!f.capabilities.canEdit) throw { message: 'Tu n’as que la lecture sur ce dossier : demande à son propriétaire de te mettre « Éditeur ».' };
    for (const n of ['donnees', 'fichiers', 'dossiers']) this.sub[n] = await this.folderIn(id, n);
    this.root = id; lsSet('dt-root', id); lsSet('dt-sub', JSON.stringify(this.sub));
    return { admin: !!f.ownedByMe, partage: !!f.capabilities.canShare };
  },
  async createRoot() { return (await this.createFolder(G_ROOT_NAME)).id; },
  async equipe() {
    const r = await this.call(`${G_API}/files/${this.root}/permissions?${G_ALL}&fields=${encodeURIComponent('permissions(id,type,role,emailAddress,displayName)')}`);
    return (r.permissions || []).filter(p => p.type === 'user');
  },
  async inviter(email) {
    return this.call(`${G_API}/files/${this.root}/permissions?${G_ALL}&sendNotificationEmail=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }) });
  },
  async retirer(permId) {
    return this.call(`${G_API}/files/${this.root}/permissions/${permId}?${G_ALL}`, { method: 'DELETE' });
  },

  /* ---------- fiches (JSON) ---------- */
  async listeFiches() {
    const files = await this.list(`${qStr(this.sub.donnees)} in parents and trashed = false`, 'id,name,version,modifiedTime');
    const out = [];
    for (const f of files) {
      const m = /^([a-z]+)__([A-Za-z0-9_-]{1,64})\.json$/.exec(f.name);
      if (m && COLS.has(m[1])) out.push({ col: m[1], id: m[2], fileId: f.id, version: Number(f.version), modifiedTime: f.modifiedTime });
    }
    return out;
  },
  async lireJson(fileId) { return (await this.call(`${G_API}/files/${fileId}?alt=media&${G_ALL}`, { raw: true })).json(); },
  /* version lue AVANT le contenu : si quelqu'un écrit entre les deux, l'écriture suivante verra le changement */
  async lireAvecVersion(fileId) {
    const meta = await this.call(`${G_API}/files/${fileId}?${G_ALL}&fields=version,trashed`);
    if (meta.trashed) throw { status: 410, message: 'Cette fiche a été supprimée par quelqu’un d’autre.' };
    return { version: Number(meta.version), data: await this.lireJson(fileId) };
  },
  async creerJson(col, id, data) {
    const b = 'dt' + randomId();
    const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: `${col}__${id}.json`, parents: [this.sub.donnees], appProperties: { col, id } })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n`, JSON.stringify(data), `\r\n--${b}--`]);
    const f = await this.call(`${G_UP}/files?uploadType=multipart&${G_ALL}&fields=id,version,modifiedTime`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
    return { fileId: f.id, version: Number(f.version), modifiedTime: f.modifiedTime };
  },
  /* écriture si personne n'a modifié la fiche depuis notre lecture ; sinon { conflit } */
  async ecrireJson(fileId, data, versionLue) {
    const meta = await this.call(`${G_API}/files/${fileId}?${G_ALL}&fields=version,trashed`);
    if (meta.trashed) throw { status: 410, message: 'Cette fiche a été supprimée par quelqu’un d’autre.' };
    if (Number(meta.version) !== versionLue) return { conflit: true };
    const f = await this.call(`${G_UP}/files/${fileId}?uploadType=media&${G_ALL}&fields=id,version,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { version: Number(f.version), modifiedTime: f.modifiedTime };
  },
  /* vers la corbeille de Drive (vidée au bout de 30 jours) : récupérable en cas d'erreur */
  async corbeille(fileId) {
    try { await this.call(`${G_API}/files/${idDrive(fileId)}?${G_ALL}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); }
    catch (e) { if (e.status !== 404) throw e; }
  },

  /* ---------- fichiers (envoi « reprenable » : pas de limite de 5 Mo) ---------- */
  async envoyer(blob, name, parent, appProperties, onProgres) {
    const r = await this.call(`${G_UP}/files?uploadType=resumable&${G_ALL}&fields=id,size`, {
      method: 'POST', raw: true,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'application/octet-stream' },
      body: JSON.stringify({ name, parents: [parent], appProperties })
    });
    const url = r.headers.get('Location');
    if (!url || !url.startsWith(G_UP + '/')) throw { message: 'Google n’a pas ouvert l’envoi du fichier.' };
    // XMLHttpRequest pour suivre l'avancement des gros PDF
    return new Promise((ok, ko) => {
      const x = new XMLHttpRequest();
      x.open('PUT', url);
      x.timeout = Math.max(180000, blob.size / 30);
      if (onProgres) x.upload.onprogress = e => e.lengthComputable && onProgres(e.loaded / e.total);
      x.onload = () => { if (x.status >= 200 && x.status < 300) { let f = {}; try { f = JSON.parse(x.responseText); } catch (_) {} if (f.id) this.verifies.add(f.id); ok(f); } else ko({ status: x.status, message: 'Envoi refusé par Google (' + x.status + ').' }); };
      x.onerror = () => ko({ network: true, message: 'Envoi interrompu (réseau).' });
      x.ontimeout = () => ko({ network: true, message: 'Envoi trop long, réessaie.' });
      x.send(blob);
    });
  },
  /* un fichier cité dans une fiche doit être rangé dans fichiers/ du dossier partagé (sinon : fiche piégée) */
  async verifierFichier(driveId) {
    const id = idDrive(driveId);
    if (this.verifies.has(driveId)) return id;
    const f = await this.call(`${G_API}/files/${id}?${G_ALL}&fields=parents,trashed`);
    if (!(f.parents || []).includes(this.sub.fichiers)) throw { message: 'Ce fichier n’est pas rangé dans le dossier partagé : refusé.' };
    this.verifies.add(driveId);
    return id;
  },
  async telecharger(driveId) {
    const id = await this.verifierFichier(driveId);
    const r = await this.call(`${G_API}/files/${id}?alt=media&${G_ALL}`, { raw: true, timeout: 300000 });
    return new Uint8Array(await r.arrayBuffer());
  },
  /* ---------- import depuis un dossier Drive choisi par l'utilisateur ---------- */
  idDepuisLien(texte) {
    const t = String(texte || '').trim();
    const m = /(?:folders\/|[?&]id=)([A-Za-z0-9_-]{10,80})/.exec(t) || /^([A-Za-z0-9_-]{10,80})$/.exec(t);
    return m ? m[1] : null;
  },
  async infoDossier(id) {
    return this.call(`${G_API}/files/${idDrive(id)}?${G_ALL}&fields=${encodeURIComponent('id,name,mimeType,trashed')}`);
  },
  async enfants(id) {
    return this.list(`${qStr(id)} in parents and trashed = false`, 'id,name,mimeType,size');
  },
  /* parcours complet (dossiers lus 4 par 4) ; chemins relatifs à la racine ; dossiers « ignorer(chemin) » sautés */
  async arbre(racineId, ignorer, onProgres) {
    const fichiers = [];
    const file = [{ id: racineId, chemin: '' }];
    let lus = 0, arret = null;
    const travail = async () => {
      while (file.length && !arret) {
        const d = file.shift();
        let enf;
        try { enf = await this.reessayer(() => this.enfants(d.id)); }
        catch (e) {
          if (d.id === racineId || (e && (e.login || e.network))) { arret = e; throw e; }
          lus++; continue;   // sous-dossier sans accès : sauté, le reste est lu
        }
        lus++;
        for (const e of enf) {
          const nom = e.name.replace(/\//g, '∕');   // un « / » dans un nom de dossier casserait les chemins
          const chemin = d.chemin ? d.chemin + '/' + nom : nom;
          if (e.mimeType === G_FOLDER) { if (!(ignorer && ignorer(chemin))) file.push({ id: e.id, chemin }); }
          else fichiers.push({ id: e.id, path: d.chemin, name: e.name, mimeType: e.mimeType, size: Number(e.size) || 0 });
        }
        if (fichiers.length > ARBRE_MAX) throw (arret = { message: `Plus de ${ARBRE_MAX} fichiers dans ce dossier : choisis moins de catégories.` });
        if (onProgres) onProgres(lus, fichiers.length);
      }
    };
    // plusieurs lecteurs : ils repartent tant que la file se remplit
    while (file.length && !arret) await Promise.all(Array.from({ length: Math.min(4, file.length) }, travail));
    if (arret) throw arret;
    return fichiers;
  },
  /* Google limite le débit : on réessaie avec des pauses croissantes */
  async reessayer(fn, essais = 5) {
    for (let i = 0; ; i++) {
      try { return await fn(); }
      catch (e) {
        const passager = e && (e.status === 429 || e.status === 500 || e.status === 502 || e.status === 503 || e.network);
        if (!passager || i >= essais || (e && e.login)) throw e;
        await new Promise(r => setTimeout(r, 1000 * 2 ** i));
      }
    }
  },
  /* copie d'un fichier source (choisi par l'utilisateur dans l'assistant) vers fichiers/ */
  async copierDepuis(sourceId, nom) {
    const f = await this.reessayer(() => this.call(`${G_API}/files/${idDrive(sourceId)}/copy?${G_ALL}&fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nom, parents: [this.sub.fichiers] }), timeout: 120000 }));
    this.verifies.add(f.id);
    return f.id;
  },

  /* duplication d'un produit : chaque fiche possède ses propres fichiers (jamais partagés) */
  async copier(driveId, nom) {
    const id = await this.verifierFichier(driveId);
    const f = await this.call(`${G_API}/files/${id}/copy?${G_ALL}&fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nom, parents: [this.sub.fichiers] }), timeout: 120000 });
    this.verifies.add(f.id);
    return f.id;
  },
  async corbeilleFichier(driveId) {
    let ok = false;
    try { await this.verifierFichier(driveId); ok = true; } catch (e) { if (e && (e.login || e.network)) throw e; }
    if (ok) await this.corbeille(driveId);
  },
  /* dossier généré : remplace celui du même chantier */
  async deposerDossier(chantierId, name, blob, onProgres, anciennesCles = []) {
    const avant = [];
    for (const cle of [chantierId, ...anciennesCles]) avant.push(...await this.list(`${qStr(this.sub.dossiers)} in parents and appProperties has { key='chantier' and value=${qStr(cle)} } and trashed = false`, 'id'));
    const f = await this.envoyer(blob, name, this.sub.dossiers, { chantier: chantierId }, onProgres);
    for (const a of avant) await this.corbeille(a.id);
    return f;
  },
  lienDossier: id => `https://drive.google.com/drive/folders/${id}`
};
