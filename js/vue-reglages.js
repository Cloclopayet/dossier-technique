/* Réglages : entreprise (page de garde), couleur du dossier, lots, équipe (partage du dossier Drive), compte. */
'use strict';

let REG = null;          // brouillon des réglages
let REG_BASE = null;     // version de départ (pour fusionner si un collègue enregistre en même temps)
let EQUIPE = null;       // { liste, err, charge }

function vueReglages() {
  if (!REG) { REG = clone(reglages()); REG_BASE = STORE.get('reglages', 'app') ? clone(REG) : null; }
  if (!EQUIPE) { EQUIPE = { liste: [], charge: true }; chargerEquipe(); }
  const e = REG.entreprise || {};
  const lots = REG.lots.map((l, i) => `<li class="ligne-lot">
      <input class="mini-champ" data-lot="${i}" data-k="id" value="${esc(l.id)}" aria-label="Numéro du lot" maxlength="6">
      <input class="mini-champ emoji" data-lot="${i}" data-k="emoji" value="${esc(l.emoji || '')}" aria-label="Émoji" maxlength="4">
      <input data-lot="${i}" data-k="nom" value="${esc(l.nom)}" aria-label="Nom du lot">
      <button class="x" data-action="lot-haut" data-i="${i}" ${i ? '' : 'disabled'} aria-label="Monter">↑</button>
      <button class="x" data-action="lot-suppr" data-i="${i}" aria-label="Supprimer le lot ${esc(l.nom)}">✕</button>
    </li>`).join('');
  const membres = EQUIPE.charge ? '<p class="discret">Chargement…</p>' : EQUIPE.err ? `<p class="alerte">${esc(EQUIPE.err)}</p>`
    : `<ul class="equipe">${EQUIPE.liste.map(p => `<li><span>👤 ${esc(p.displayName || p.emailAddress)} <small>${esc(p.emailAddress || '')}</small></span><span class="badge ${p.role === 'owner' ? 'plein' : ''}">${p.role === 'owner' ? 'propriétaire' : p.role === 'writer' ? 'éditeur' : 'lecteur'}</span>${S.partage && p.role !== 'owner' ? `<button class="x" data-action="retirer-membre" data-id="${esc(p.id)}" aria-label="Retirer ${esc(p.emailAddress)}">✕</button>` : ''}</li>`).join('')}</ul>`;
  return `<section class="page etroite">
    <div class="titre-page"><h1>⚙️ Réglages</h1><button class="btn primaire" data-action="enregistrer-reglages">Enregistrer</button></div>

    <div class="carte bloc">
      <h2>🏢 Entreprise <small>sur la page de garde</small></h2>
      <div class="logo-zone">
        <div class="logo-apercu">${e.logo ? `<img alt="Logo" data-vignette="${esc(e.logo.driveId)}" data-mime="${esc(e.logo.mime)}">` : '<span>Pas de logo</span>'}</div>
        <div class="actions"><button class="btn" data-action="logo">${e.logo ? 'Changer le logo' : '＋ Ajouter le logo'}</button>${e.logo ? '<button class="btn danger-lien" data-action="logo-suppr">Retirer</button>' : ''}</div>
      </div>
      <div class="champs">
        <label>Raison sociale<input data-reg="nom" value="${esc(e.nom)}" placeholder="Mon entreprise SAS"></label>
        <label>Téléphone<input data-reg="tel" value="${esc(e.tel)}"></label>
        <label class="large">Adresse<textarea data-reg="adresse" rows="2">${esc(e.adresse)}</textarea></label>
        <label>E-mail<input data-reg="email" value="${esc(e.email)}" type="email"></label>
        <label>Couleur du dossier<span class="couleur"><input type="color" data-couleur value="${esc(REG.couleur || '#a77bf3')}"> <small>bandeaux, titres, intercalaires</small></span></label>
      </div>
    </div>

    <div class="carte bloc">
      <h2>🧱 Lots <small>ordre du dossier</small></h2>
      <ul class="lots">${lots}</ul>
      <button class="btn" data-action="lot-ajout">＋ Ajouter un lot</button>
    </div>

    <div class="carte bloc">
      <h2>🤝 Équipe <small>accès au dossier Drive partagé</small></h2>
      ${membres}
      ${S.partage ? `<form class="inviter" data-form="inviter"><input type="email" name="email" placeholder="collegue@gmail.com" required aria-label="E-mail du collègue"><button class="btn primaire">Inviter</button></form>
        <p class="discret">Ton collègue reçoit un e-mail de Google, puis ouvre l’appli et choisit ce dossier. Il faut aussi l’ajouter comme « utilisateur test » dans Google Cloud tant que l’appli n’est pas validée par Google (voir MISE-EN-LIGNE.md).</p>`
      : '<p class="discret">Seul le propriétaire du dossier peut inviter.</p>'}
    </div>

    <div class="carte bloc">
      <h2>👤 Compte</h2>
      <p>Connecté : <b>${esc(DRIVE.me && DRIVE.me.email)}</b></p>
      <div class="actions"><a class="btn" href="${esc(DRIVE.lienDossier(DRIVE.root))}" target="_blank" rel="noopener">Ouvrir le dossier Drive ↗</a><button class="btn" data-action="logout">Se déconnecter</button></div>
    </div>
  </section>`;
}

async function chargerEquipe() {
  try { EQUIPE = { liste: await DRIVE.equipe(), charge: false }; }
  catch (e) { EQUIPE = { liste: [], charge: false, err: errMsg(e) }; }
  if (S.route.vue === 'reglages') render();
}

Object.assign(ACTIONS, {
  'enregistrer-reglages': async el => {
    const ids = REG.lots.map(l => l.id.trim());
    if (ids.some(x => !x) || new Set(ids).size !== ids.length) { toast('Chaque lot doit avoir un numéro unique.', 'err'); return; }
    el.disabled = true;
    try {
      const avant = reglages().entreprise.logo;
      const r = await STORE.enregistrer('reglages', { ...REG, lots: REG.lots.map(l => ({ id: l.id.trim(), emoji: (l.emoji || '').trim(), nom: l.nom.trim() || 'Lot ' + l.id })) }, REG_BASE);
      const d = r.data;
      REG = clone(d); REG_BASE = clone(d);
      if (avant && (!d.entreprise.logo || d.entreprise.logo.driveId !== avant.driveId)) jeterFichiers([avant.driveId], null).catch(() => {});
      toast(r.fusionAvec ? `Enregistré ✓ — réuni avec les changements de ${r.fusionAvec}.` : 'Réglages enregistrés ✓');
    } catch (e) { signaler(e); }
    render();
  },
  logo: async () => {
    const [f] = await choisirFichiers('image/png,image/jpeg', false);
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) { toast('Logo : PNG ou JPG seulement.', 'err'); return; }
    S.envois++; renderEntete();
    try {
      const item = await envoyerFichier(f, {});
      const precedent = REG.entreprise && REG.entreprise.logo;
      // un logo envoyé puis remplacé avant d'enregistrer ne sert à rien : à la corbeille
      if (precedent && !(reglages().entreprise.logo && reglages().entreprise.logo.driveId === precedent.driveId)) DRIVE.corbeilleFichier(precedent.driveId).catch(() => {});
      REG.entreprise = { ...(REG.entreprise || {}), logo: item };
      toast('Logo ajouté : pense à enregistrer.');
    }
    catch (e) { signaler(e); }
    finally { S.envois--; render(); }
  },
  'logo-suppr': () => { REG.entreprise = { ...REG.entreprise, logo: null }; render(); },
  'lot-ajout': () => {
    const n = REG.lots.reduce((m, l) => Math.max(m, parseInt(l.id, 10) || 0), 0) + 1;
    REG.lots.push({ id: String(n).padStart(2, '0'), emoji: '📦', nom: 'Nouveau lot' });
    render();
  },
  'lot-haut': el => { const i = +el.dataset.i; [REG.lots[i - 1], REG.lots[i]] = [REG.lots[i], REG.lots[i - 1]]; render(); },
  'lot-suppr': async el => {
    const l = REG.lots[+el.dataset.i];
    const n = produits().filter(p => p.lot === l.id).length;
    if (n && !await confirmer(`Supprimer le lot « ${l.nom} » ?`, `${n} produit(s) y sont rangés : ils passeront dans « Divers » jusqu’à ce que tu les déplaces.`, 'Supprimer', true)) return;
    REG.lots.splice(+el.dataset.i, 1); render();
  },
  'retirer-membre': async el => {
    const p = EQUIPE.liste.find(x => x.id === el.dataset.id);
    if (!p || !await confirmer('Retirer l’accès ?', `${p.emailAddress} ne verra plus le dossier partagé.`, 'Retirer', true)) return;
    await DRIVE.retirer(p.id); EQUIPE = null; render();
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (!REG || S.route.vue !== 'reglages') return;
  if (el.dataset.reg) REG.entreprise = { ...(REG.entreprise || {}), [el.dataset.reg]: el.value };
  else if (el.dataset.lot) REG.lots[+el.dataset.lot][el.dataset.k] = el.value;
  else if (el.dataset.couleur !== undefined) REG.couleur = el.value;
});
document.addEventListener('submit', async e => {
  if (e.target.dataset.form !== 'inviter') return;
  e.preventDefault();
  const email = e.target.email.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Adresse e-mail invalide.', 'err'); return; }
  try { await DRIVE.inviter(email); toast(`${email} invité ✓`); EQUIPE = null; render(); }
  catch (err) { signaler(err); }
});
/* en revenant sur l'onglet, on repart des réglages enregistrés */
window.addEventListener('hashchange', () => { if (S.route.vue !== 'reglages') { REG = null; REG_BASE = null; EQUIPE = null; } });
