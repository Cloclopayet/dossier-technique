/* Démarrage, connexion Google, dossier partagé, navigation entre les onglets. */
'use strict';

const S = {
  mode: 'chargement',          // chargement | connexion | ok
  route: { vue: 'biblio', id: null },
  connErr: '', roots: null, admin: false, partage: false,
  biblio: { q: '', lot: '', onglet: 'produits', limite: 120, vue: (() => { try { return localStorage.getItem('dt-vue') || 'icones'; } catch (_) { return 'icones'; } })() },
  kit: null,                   // ensemble en cours d'édition
  edit: null,                  // produit en cours d'édition { data, nouveau, envoyes:[], retires:[] }
  envois: 0                    // fichiers en cours d'envoi
};

function reglages() {
  const r = STORE.get('reglages', 'app') || {};
  return { id: 'app', entreprise: {}, couleur: '#a77bf3', lots: MODELE.LOTS_DEFAUT, ...r };
}
const lotDe = id => reglages().lots.find(l => l.id === id) || MODELE.LOT_DIVERS;

/* ---------- navigation ---------- */
function lireRoute() {
  const m = /^#\/(biblio|chantiers|reglages|import)(?:\/([A-Za-z0-9_-]+))?(?:\/([A-Za-z0-9_-]+))?/.exec(location.hash);
  S.route = m ? { vue: m[1], id: m[2] || null, sous: m[3] || null } : { vue: 'biblio', id: null, sous: null };
}
function aller(hash) { if (location.hash !== hash) location.hash = hash; else { lireRoute(); render(); } }
window.addEventListener('hashchange', () => {
  if (/access_token|error=/.test(location.hash)) return;
  if (S.edit && !confirm('Quitter sans enregistrer ce produit ?')) { history.replaceState(null, '', '#/biblio'); return; }
  if (S.edit) annulerEdition(true);
  S.picker = null; S.sugg = null; S.kit = null;
  lireRoute(); render();
});

/* ---------- rendu ---------- */
let renduDiffere = false;
/* un tiroir (édition, choix) ne glisse qu'à son ouverture, pas à chaque rafraîchissement */
let tiroirNeuf = false;
const ouvrirTiroir = () => { tiroirNeuf = true; };
const entree = () => (tiroirNeuf ? 'entre' : '');
/* rafraîchissement venu de Drive (collègue) : pas pendant une saisie, ce sera fait en quittant le champ */
function renderDoux() {
  const a = document.activeElement;
  if (S.mode === 'ok' && a && $('#app').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'file') { renduDiffere = true; return; }
  render();
}
function render() {
  const app = $('#app');
  if (S.mode !== 'ok') { app.innerHTML = vueConnexion(); renderEntete(); return; }
  renduDiffere = false;
  renderEntete();
  const v = S.route.vue;
  const focus = memoFocus();
  const tiroir = $('.tiroir-corps'), defil = tiroir ? tiroir.scrollTop : 0;   // le tiroir ne remonte pas à chaque rafraîchissement
  app.innerHTML = v === 'chantiers' ? vueChantiers() : v === 'reglages' ? vueReglages() : v === 'import' ? vueImport() : vueBiblio();
  if (defil && $('.tiroir-corps') && !tiroirNeuf) $('.tiroir-corps').scrollTop = defil;
  rendreFocus(focus);
  tiroirNeuf = false;
  chargerVignettes(app);
  chargerApercus(app);
  if (v === 'chantiers' && typeof apresRenduChantier === 'function') apresRenduChantier();
}
document.addEventListener('focusout', () => setTimeout(() => { if (renduDiffere) render(); }, 0));

/* le champ en cours de saisie retrouve le focus et le curseur après un rendu */
const CLES_CHAMP = ['id', 'champ', 'ch', 'ligne', 'reg', 'lot', 'k'];
function memoFocus() {
  const a = document.activeElement;
  if (!a || !/^(INPUT|TEXTAREA)$/.test(a.tagName) || !$('#app').contains(a)) return null;
  const sel = (a.id ? '#' + CSS.escape(a.id) : '') + CLES_CHAMP.slice(1).filter(k => a.dataset[k] !== undefined).map(k => `[data-${k}="${CSS.escape(a.dataset[k])}"]`).join('');
  let pos = null; try { pos = [a.selectionStart, a.selectionEnd]; } catch (_) {}
  return sel ? { sel, pos } : null;
}
function rendreFocus(f) {
  if (!f) return;
  const el = $(f.sel); if (!el) return;
  el.focus({ preventScroll: true });
  try { if (f.pos && f.pos[0] != null) el.setSelectionRange(f.pos[0], f.pos[1]); } catch (_) {}
}

function renderEntete() {
  const nav = $('#nav');
  if (S.mode !== 'ok') { nav.innerHTML = ''; $('#compte').innerHTML = ''; return; }
  const onglets = [['biblio', '📚', 'Bibliothèque'], ['chantiers', '🏗️', 'Chantiers'], ['reglages', '⚙️', 'Réglages']];
  nav.innerHTML = onglets.map(([id, e, t]) => `<a href="#/${id}" class="onglet ${S.route.vue === id ? 'actif' : ''}" ${S.route.vue === id ? 'aria-current="page"' : ''}><span aria-hidden="true">${e}</span> ${t}</a>`).join('');   // textes fixes
  const me = DRIVE.me || {};
  $('#compte').innerHTML = `<span class="moi" title="${esc(me.email || '')}">${esc((me.name || '?').split(' ')[0])}</span>${S.envois ? `<span class="pastille">⏫ ${esc(S.envois)}</span>` : ''}`;
}

/* ---------- connexion ---------- */
function vueConnexion() {
  if (S.mode === 'chargement') return `<div class="centre"><div class="carte accueil"><div class="gros-emoji">📂</div><p>Chargement…</p></div></div>`;
  const err = S.connErr ? `<p class="alerte">${esc(S.connErr)}</p>` : '';
  if (!DRIVE.valid()) {
    return `<div class="centre"><div class="carte accueil">
      <div class="gros-emoji">📂</div>
      <h1>Tes fiches techniques, rangées. Tes DOE, générés.</h1>
      <p>La bibliothèque et les dossiers sont rangés dans un dossier Google Drive partagé avec ton équipe.</p>
      ${err}
      ${DRIVE.clientId() ? `<button class="btn primaire gros" data-action="login">Se connecter avec Google</button>` : `<p class="alerte">ID client Google manquant dans js/config.js (voir MISE-EN-LIGNE.md).</p>`}
    </div></div>`;
  }
  const roots = S.roots || [];
  return `<div class="centre"><div class="carte accueil">
    <div class="gros-emoji">🤝</div>
    <h1>Bonjour ${esc((DRIVE.me && DRIVE.me.name || '').split(' ')[0])} !</h1>
    ${err}
    ${roots.length ? `<p>Choisis le dossier partagé à ouvrir :</p>
      <div class="pile">${roots.map(r => `<button class="btn choix" data-action="root" data-id="${esc(r.id)}">📁 ${esc(r.name)} <small>${r.ownedByMe ? 'à toi' : 'partagé par ' + esc((r.owners && r.owners[0] && (r.owners[0].displayName || r.owners[0].emailAddress)) || '?')}</small></button>`).join('')}</div>
      <p class="discret">Tu dois rejoindre l’équipe d’un collègue ? Demande-lui de t’inviter (Réglages → Équipe), puis recharge.</p>`
    : `<p>Aucun dossier « Dossiers techniques GSE » n’est partagé avec ce compte.</p>
      <p class="discret">Si un collègue l’a déjà créé, demande-lui de t’inviter puis recharge la page. Sinon, crée-le :</p>`}
    <div class="actions centrees">
      ${roots.length ? '' : `<button class="btn primaire gros" data-action="creer-root">Créer le dossier partagé</button>`}
      <button class="btn" data-action="recharger">Recharger</button>
      <button class="btn lien" data-action="logout">Changer de compte</button>
    </div>
  </div></div>`;
}

async function ouvrirRoot(id) {
  try {
    const r = await DRIVE.useRoot(id);
    S.admin = r.admin; S.partage = r.partage;
    await demarrer();
  } catch (e) { S.connErr = errMsg(e); S.mode = 'connexion'; render(); }
}
async function demarrer() {
  S.mode = 'chargement'; render();
  await STORE.charger();
  S.mode = 'ok';
  STORE.onChange = renderDoux;
  STORE.demarrer();
  lireRoute();
  restaurerBrouillon();
  render();
}

/* reconnexion : le produit ou le chantier en cours est gardé le temps d'aller chez Google et revenir */
let enReconnexion = false;
function seReconnecter() {
  try {
    if (S.edit) sessionStorage.setItem('dt-brouillon', JSON.stringify(S.edit));
    if (CH && (CH.sale || CH.etat === 'err')) sessionStorage.setItem('dt-chantier', JSON.stringify({ id: CH.id, data: CH.data, base: CH.base }));
  } catch (_) {}
  enReconnexion = true;
  DRIVE.login(false);
}
function restaurerBrouillon() {
  let b = null, c = null;
  try {
    b = JSON.parse(sessionStorage.getItem('dt-brouillon') || 'null');
    c = JSON.parse(sessionStorage.getItem('dt-chantier') || 'null');
    sessionStorage.removeItem('dt-brouillon'); sessionStorage.removeItem('dt-chantier');
  } catch (_) {}
  if (b && b.data) { S.edit = b; S.route = { vue: 'biblio', id: null }; toast('Reconnecté : ton produit en cours est revenu, pense à l’enregistrer.'); }
  else if (c && c.data && STORE.get('chantier', c.id)) {
    CH = { id: c.id, data: c.data, base: c.base, sale: true, etat: 'attente' };
    S.route = { vue: 'chantiers', id: c.id };
    history.replaceState(null, '', '#/chantiers/' + c.id);
    setTimeout(sauverMaintenant, 0);
    toast('Reconnecté : les modifications du chantier sont enregistrées.');
  }
}
/* erreur d'un appel : connexion expirée → on propose de se reconnecter */
function signaler(e) {
  if (e && e.login) {
    if ($('#reconnexion')) return;
    $('#toasts').insertAdjacentHTML('beforeend', `<div id="reconnexion" class="toast err" role="alert">Connexion Google expirée (elle dure 1 h). ${S.edit ? 'Ton produit en cours sera gardé. ' : ''}<button class="btn mini" data-action="relogin">Se reconnecter</button></div>`);
    return;
  }
  toast(errMsg(e), 'err', 6000);
}

/* ---------- actions communes ---------- */
const ACTIONS = {
  login: () => DRIVE.login(false),
  relogin: seReconnecter,
  logout: async () => { DRIVE.forget(); await STORE.vider(); location.hash = ''; location.reload(); },
  recharger: () => location.reload(),
  root: el => ouvrirRoot(el.dataset.id),
  'creer-root': async () => { try { const id = await DRIVE.createRoot(); await ouvrirRoot(id); } catch (e) { S.connErr = errMsg(e); render(); } }
};
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-action]')) e.target.click(); });
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve().then(() => fn(el, e)).catch(signaler);
});

/* ---------- démarrage ---------- */
async function boot() {
  await STORE.ouvrir();
  const retour = DRIVE.init();
  if (retour && retour.error) S.connErr = retour.error === 'access_denied' ? 'Connexion annulée.' : retour.error;
  if (!DRIVE.valid()) { S.mode = 'connexion'; render(); return; }
  try {
    await DRIVE.about();
    if (DRIVE.root) {
      try { const r = await DRIVE.useRoot(DRIVE.root); S.admin = r.admin; S.partage = r.partage; await demarrer(); return; }
      catch (e) { if (e && (e.login || e.network)) throw e; DRIVE.root = null; }   // dossier retiré ou plus partagé : on rechoisit
    }
    S.roots = await DRIVE.findRoots();
    S.mode = 'connexion'; render();
  } catch (e) {
    S.connErr = e && e.login ? '' : errMsg(e);
    S.mode = 'connexion'; render();
  }
}
document.addEventListener('DOMContentLoaded', boot);
