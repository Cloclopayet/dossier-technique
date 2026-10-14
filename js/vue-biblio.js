/* Bibliothèque : produits classés par lot, avec leurs documents (fiche, notices, PV, certificat) et photos. */
'use strict';

const produits = () => STORE.liste('produit');
const titreProduit = p => [p.marque, p.designation].filter(Boolean).join(' — ') || 'Produit sans nom';

function badgesDocs(p) {
  const types = new Set((p.docs || []).map(d => d.type));
  const b = MODELE.TYPES_DOC.filter(t => t.id !== 'autre').map(t => `<span class="badge ${types.has(t.id) ? 'plein' : 'vide'}" title="${esc(t.nom)}${types.has(t.id) ? '' : ' : manquant'}">${esc(t.court)}</span>`);
  if ((p.photos || []).length) b.push(`<span class="badge plein" title="Photos">📷 ${esc(p.photos.length)}</span>`);
  return b.join('');
}

const PAR_TRANCHE = 120;   // cartes affichées d'un coup (la bibliothèque peut dépasser 1 000 produits)
const VUES = [['liste', '☰', 'Liste'], ['icones', '▦', 'Icônes'], ['miniatures', '▣', 'Miniatures']];

/* document montré en miniature : la fiche technique d'abord */
const docApercu = p => (p.docs || []).find(d => d.type === 'fiche' && d.mime === 'application/pdf') || (p.docs || []).find(d => d.mime === 'application/pdf') || null;

function carteProduit(p, vue) {
  const lot = lotDe(p.lot);
  if (vue === 'liste') {
    return `<tr data-action="editer" data-id="${esc(p.id)}" tabindex="0">
      <td class="t-des">${esc(p.designation || 'Sans désignation')}</td><td>${esc(p.marque || '—')}</td><td class="mono">${esc(p.reference || '—')}</td>
      <td class="mono">${esc(lot.id)}</td><td>${esc(p.famille || '')}</td><td><span class="badges">${badgesDocs(p)}</span></td></tr>`;
  }
  const ph = (p.photos || [])[0], ap = docApercu(p);
  const visuel = vue === 'miniatures'
    ? (ap ? `<img alt="" data-apercu="${esc(ap.driveId)}" data-taille="${esc(ap.taille || 0)}">` : ph ? `<img alt="" data-vignette="${esc(ph.driveId)}" data-mime="${esc(ph.mime)}">` : `<span aria-hidden="true">${esc(lot.emoji || '📦')}</span>`)
    : (ph ? `<img alt="" data-vignette="${esc(ph.driveId)}" data-mime="${esc(ph.mime)}">` : `<span aria-hidden="true">${esc(lot.emoji || '📦')}</span>`);
  return `<button class="carte produit ${vue === 'miniatures' ? 'mini' : ''}" data-action="editer" data-id="${esc(p.id)}">
      <div class="vign">${visuel}</div>
      <div class="cartouche">
        <strong class="c-titre">${esc(p.designation || 'Sans désignation')}</strong>
        <span class="c-cell"><small>Marque</small>${esc(p.marque || '—')}</span>
        <span class="c-cell"><small>Réf.</small>${esc(p.reference || '—')}</span>
        <span class="c-cell"><small>Lot</small>${esc(lot.id)}</span>
        <span class="c-cell"><small>Famille</small>${esc(p.famille || lot.nom)}</span>
        <span class="c-docs badges">${badgesDocs(p)}</span>
      </div>
    </button>`;
}

function vueBiblio() {
  const tous = produits();
  const R = reglages();
  const B = S.biblio;
  const onglets = `<div class="sous-onglets" role="tablist">
      <button class="sous-onglet ${B.onglet !== 'ensembles' ? 'actif' : ''}" data-action="biblio-onglet" data-id="produits" role="tab">Produits <b>${esc(tous.length)}</b></button>
      <button class="sous-onglet ${B.onglet === 'ensembles' ? 'actif' : ''}" data-action="biblio-onglet" data-id="ensembles" role="tab">Ensembles <b>${esc(STORE.liste('kit').length)}</b></button>
    </div>`;
  const tete = `<div class="titre-page">
      <h1>📚 Bibliothèque</h1>
      <div class="actions">
        <a class="btn" href="#/import">⇪ Importer depuis Drive</a>
        ${B.onglet === 'ensembles' ? '<button class="btn primaire" data-action="nouvel-ensemble">＋ Nouvel ensemble</button>' : '<button class="btn primaire" data-action="nouveau-produit">＋ Nouveau produit</button>'}
      </div>
    </div>${onglets}`;
  if (B.onglet === 'ensembles') return `<section class="page">${tete}${vueEnsembles()}</section>${S.kit ? vueEditeurKit() : ''}`;

  const liste = MODELE.filtrer(tous, B.q, B.lot)
    .sort((a, b) => (a.lot || '').localeCompare(b.lot || '') || titreProduit(a).localeCompare(titreProduit(b), 'fr'));
  const compte = id => tous.filter(p => p.lot === id).length;
  const lotsUtiles = [...R.lots, ...(tous.some(p => !R.lots.find(l => l.id === p.lot)) ? [MODELE.LOT_DIVERS] : [])];
  const puces = `<button class="puce ${!B.lot ? 'active' : ''}" data-action="filtre-lot" data-id="">Tout <b>${esc(tous.length)}</b></button>` +
    lotsUtiles.filter(l => compte(l.id) || l.id === B.lot || l === MODELE.LOT_DIVERS).map(l => `<button class="puce ${B.lot === l.id ? 'active' : ''}" data-action="filtre-lot" data-id="${esc(l.id)}">${esc(l.emoji || '')} ${esc(l.nom)} <b>${esc(l === MODELE.LOT_DIVERS ? tous.filter(p => !R.lots.find(x => x.id === p.lot)).length : compte(l.id))}</b></button>`).join('');
  const visibles = liste.slice(0, B.limite);
  const corps = B.vue === 'liste'
    ? `<div class="table-defil"><table class="table-produits"><thead><tr><th>Désignation</th><th>Marque</th><th>Réf.</th><th>Lot</th><th>Famille</th><th>Documents</th></tr></thead><tbody>${visibles.map(p => carteProduit(p, 'liste')).join('')}</tbody></table></div>`
    : `<div class="grille ${B.vue === 'miniatures' ? 'miniatures' : ''}">${visibles.map(p => carteProduit(p, B.vue)).join('')}</div>`;
  const choixVue = `<div class="choix-vue" role="group" aria-label="Affichage">${VUES.map(([id, ic, t]) => `<button class="${B.vue === id ? 'actif' : ''}" data-action="biblio-vue" data-id="${id}" aria-pressed="${B.vue === id}" title="${t}"><span aria-hidden="true">${ic}</span> ${t}</button>`).join('')}</div>`;
  return `<section class="page">
    ${tete}
    <div class="barre-recherche"><div class="recherche"><input type="search" id="q" placeholder="Chercher : WC, Geberit, 33265002…" value="${esc(B.q)}" aria-label="Chercher un produit"></div>${choixVue}</div>
    <div class="puces">${puces}</div>
    ${liste.length ? corps + (liste.length > visibles.length ? `<div class="actions centrees"><button class="btn" data-action="biblio-plus">Afficher ${esc(Math.min(PAR_TRANCHE, liste.length - visibles.length))} de plus <small>(${esc(visibles.length)} / ${esc(liste.length)})</small></button></div>` : '')
      : tous.length ? `<div class="vide-etat"><div class="gros-emoji">🔍</div><p>Aucun produit ne correspond.</p></div>`
      : `<div class="vide-etat"><div class="gros-emoji">🧰</div><p><b>Ta bibliothèque est vide.</b><br>Importe tes fiches depuis un dossier Google Drive, ou ajoute ton premier produit à la main.</p><div class="actions centrees"><a class="btn primaire" href="#/import">⇪ Importer depuis Drive</a><button class="btn" data-action="nouveau-produit">＋ Ajouter un produit</button></div></div>`}
  </section>${S.edit ? vueEditeur() : ''}`;
}

/* ---------- éditeur de produit ---------- */
function vueEditeur() {
  const E = S.edit, p = E.data, R = reglages();
  const tous = produits();
  const familles = [...new Set(tous.filter(x => x.lot === p.lot).map(x => x.famille).filter(Boolean))].sort();
  const marques = [...new Set(tous.map(x => x.marque).filter(Boolean))].sort();
  const ligneDoc = d => `<li><button class="lien-doc" data-action="voir" data-fid="${esc(d.fid)}">📄 ${esc(d.nom)}</button><small>${d.taille ? taille(d.taille) : ''}</small><button class="x" data-action="retirer-doc" data-fid="${esc(d.fid)}" aria-label="Retirer ${esc(d.nom)}">✕</button></li>`;
  const blocs = MODELE.TYPES_DOC.map(t => {
    const docs = (p.docs || []).filter(d => d.type === t.id);
    return `<div class="depot" data-depot="${t.id}">
      <div class="depot-tete"><b>${esc(t.nom)}</b><button class="btn mini" data-action="ajouter-doc" data-type="${t.id}">＋ Ajouter</button></div>
      ${docs.length ? `<ul class="docs">${docs.map(ligneDoc).join('')}</ul>` : `<p class="glisse">Glisse un PDF ici</p>`}
    </div>`;
  }).join('');
  const photos = (p.photos || []).map(ph => `<figure><img alt="${esc(ph.nom)}" data-vignette="${esc(ph.driveId)}" data-mime="${esc(ph.mime)}"><button class="x" data-action="retirer-doc" data-fid="${esc(ph.fid)}" aria-label="Retirer la photo">✕</button></figure>`).join('');
  return `<div class="voile ${entree()}" data-action="fermer-voile"></div>
  <section class="tiroir ${entree()}" role="dialog" aria-modal="true" aria-label="Produit">
    <div class="tiroir-tete">
      <h2>${E.nouveau ? '＋ Nouveau produit' : '✏️ ' + esc(titreProduit(p))}</h2>
      <button class="x gros" data-action="annuler-edition" aria-label="Fermer">✕</button>
    </div>
    <div class="tiroir-corps">
      <div class="champs">
        <label class="large">Désignation *<input data-champ="designation" value="${esc(p.designation)}" placeholder="WC suspendu sans bride" required></label>
        <label>Marque<input data-champ="marque" value="${esc(p.marque)}" list="dl-marques" placeholder="Geberit"></label>
        <label>Référence<input data-champ="reference" value="${esc(p.reference)}" placeholder="500.123.01.1"></label>
        <label>Lot<select data-champ="lot">${R.lots.map(l => `<option value="${esc(l.id)}" ${l.id === p.lot ? 'selected' : ''}>${esc(l.id)} — ${esc(l.nom)}</option>`).join('')}${R.lots.find(l => l.id === p.lot) ? '' : `<option value="${esc(p.lot)}" selected>${esc(p.lot || '—')} — Divers</option>`}</select></label>
        <label>Famille (groupe)<input data-champ="famille" value="${esc(p.famille)}" list="dl-familles" placeholder="Appareils sanitaires"></label>
        <label class="large">Description / caractéristiques<textarea data-champ="description" rows="3" placeholder="Classement, dimensions, finitions… (reprise sur la page produit du dossier)">${esc(p.description)}</textarea></label>
      </div>
      <datalist id="dl-marques">${marques.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
      <datalist id="dl-familles">${familles.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
      <h3>Documents</h3>
      <div class="depots">${blocs}</div>
      <h3>Photos</h3>
      <div class="depot photos" data-depot="photo">
        <div class="vignettes">${photos}<button class="ajout-photo" data-action="ajouter-doc" data-type="photo">＋<small>Photo</small></button></div>
      </div>
      ${S.envois ? `<p class="info">⏫ Envoi de ${S.envois} fichier${S.envois > 1 ? 's' : ''} vers Drive…</p>` : ''}
    </div>
    <div class="tiroir-pied">
      ${E.nouveau ? '' : `<button class="btn danger-lien" data-action="supprimer-produit">Supprimer</button><button class="btn" data-action="dupliquer-produit">Dupliquer</button>`}
      <span class="espace"></span>
      <button class="btn" data-action="annuler-edition">Annuler</button>
      <button class="btn primaire" data-action="enregistrer-produit" ${S.envois ? 'disabled' : ''}>Enregistrer</button>
    </div>
  </section>`;
}

function editer(p, nouveau) {
  S.edit = { data: clone(p), base: nouveau ? null : clone(p), nouveau, envoyes: [], retires: [] };
  ouvrirTiroir();
  render();
  setTimeout(() => { const i = $('[data-champ="designation"]'); if (i && nouveau) i.focus(); }, 30);
}

async function ajouterFichiers(type, files) {
  if (!S.edit || !files.length) return;
  const E = S.edit;
  for (const f of files) {
    if (type !== 'photo' && !estPdf(f) && !estImage(f)) { toast(`« ${f.name} » : PDF ou image seulement.`, 'err'); continue; }
    if (type === 'photo' && !estImage(f)) { toast(`« ${f.name} » n’est pas une image.`, 'err'); continue; }
    S.envois++; render();
    try {
      const item = await envoyerFichier(f, type === 'photo' ? {} : { type });
      E.envoyes.push(item.driveId);
      if (S.edit === E) { if (type === 'photo') E.data.photos = [...(E.data.photos || []), item]; else E.data.docs = [...(E.data.docs || []), item]; }
      else await DRIVE.corbeilleFichier(item.driveId);   // l'éditeur a été fermé pendant l'envoi
    } catch (e) { signaler(e); }
    finally { S.envois--; render(); }
  }
}

/* fichiers encore utilisés par une autre fiche (produit dupliqué, pièce de chantier) */
function fichiersUtilises(saufProduitId) {
  const ids = new Set();
  for (const p of produits()) if (p.id !== saufProduitId) for (const d of [...(p.docs || []), ...(p.photos || [])]) ids.add(d.driveId);
  for (const c of STORE.liste('chantier')) for (const id of fichiersDuChantier(c)) ids.add(id);
  return ids;
}
async function jeterFichiers(driveIds, saufProduitId) {
  const utiles = fichiersUtilises(saufProduitId);
  for (const id of driveIds) if (!utiles.has(id)) await DRIVE.corbeilleFichier(id).catch(() => {});
}

function annulerEdition(sansRendu) {
  const E = S.edit; if (!E) return;
  S.edit = null;
  jeterFichiers(E.envoyes, E.data.id).catch(() => {});
  if (!sansRendu) render();
}

Object.assign(ACTIONS, {
  'filtre-lot': el => { S.biblio.lot = el.dataset.id; S.biblio.limite = PAR_TRANCHE; render(); },
  'biblio-vue': el => { S.biblio.vue = el.dataset.id; try { localStorage.setItem('dt-vue', el.dataset.id); } catch (_) {} render(); },
  'biblio-onglet': el => { S.biblio.onglet = el.dataset.id; render(); },
  'biblio-plus': () => { S.biblio.limite += PAR_TRANCHE; render(); },
  'nouveau-produit': () => editer({ id: randomId(), lot: S.biblio.lot || reglages().lots[0].id, famille: '', marque: '', reference: '', designation: '', description: '', docs: [], photos: [] }, true),
  editer: el => { const p = STORE.get('produit', el.dataset.id); if (p) editer({ docs: [], photos: [], ...p }, false); },
  'fermer-voile': () => { if (!S.envois) ACTIONS['annuler-edition'](); },
  'annuler-edition': async () => {
    if (S.envois && !await confirmer('Envoi en cours', 'Des fichiers sont encore en cours d’envoi. Fermer quand même ?', 'Fermer')) return;
    annulerEdition();
  },
  'ajouter-doc': async el => {
    const type = el.dataset.type;
    const files = await choisirFichiers(type === 'photo' ? 'image/*' : 'application/pdf,image/*', true);
    await ajouterFichiers(type, files);
  },
  'retirer-doc': el => {
    const E = S.edit, fid = el.dataset.fid;
    const d = [...(E.data.docs || []), ...(E.data.photos || [])].find(x => x.fid === fid);
    if (!d) return;
    E.data.docs = (E.data.docs || []).filter(x => x.fid !== fid);
    E.data.photos = (E.data.photos || []).filter(x => x.fid !== fid);
    E.retires.push(d.driveId);
    render();
  },
  voir: el => {
    const src = S.edit ? [...(S.edit.data.docs || []), ...(S.edit.data.photos || [])] : [];
    const d = src.find(x => x.fid === el.dataset.fid) || produits().flatMap(p => [...(p.docs || []), ...(p.photos || [])]).find(x => x.fid === el.dataset.fid);
    if (d) ouvrirFichier(d);
  },
  'enregistrer-produit': async el => {
    const E = S.edit;
    if (!E.data.designation.trim()) { toast('Donne au moins une désignation.', 'err'); $('[data-champ="designation"]').focus(); return; }
    el.disabled = true;
    try {
      const d = { ...E.data, designation: E.data.designation.trim(), marque: (E.data.marque || '').trim(), reference: (E.data.reference || '').trim(), famille: (E.data.famille || '').trim() };
      const r = await STORE.enregistrer('produit', d, E.base);
      S.edit = null;
      // fichiers retirés de la fiche : à la corbeille, sauf s'ils servent ailleurs (ou sont encore dans la fiche fusionnée)
      const gardes = new Set([...(r.data.docs || []), ...(r.data.photos || [])].map(x => x.driveId));
      await jeterFichiers(E.retires.filter(id => !gardes.has(id)), d.id);
      toast(r.fusionAvec ? `Enregistré ✓ — ${r.fusionAvec} l’avait modifié entre-temps : vos deux changements sont gardés.` : 'Produit enregistré ✓', 'ok', r.fusionAvec ? 8000 : 4200);
      render();
    } catch (e) { el.disabled = false; signaler(e); }
  },
  /* la copie reçoit ses propres fichiers (copiés dans Drive) : supprimer l'un ne casse jamais l'autre */
  'dupliquer-produit': async () => {
    const E = S.edit, p = clone(E.data);
    const copies = [];
    const copier = async x => { const driveId = await DRIVE.copier(x.driveId, `${randomId()} - ${MODELE.nomFichier(x.nom)}`); copies.push(driveId); return { ...x, fid: randomId(), driveId }; };
    S.envois++; render();
    try {
      const docs = [], photos = [];
      for (const d of p.docs || []) docs.push(await copier(d));
      for (const d of p.photos || []) photos.push(await copier(d));
      if (S.edit !== E) { for (const id of copies) DRIVE.corbeilleFichier(id).catch(() => {}); return; }
      annulerEdition(true);
      editer({ ...p, id: randomId(), designation: p.designation + ' (copie)', docs, photos }, true);
      S.edit.envoyes = copies;   // copie annulée → ses fichiers partent à la corbeille
      toast('Copie prête : modifie-la puis enregistre (l’original n’est pas touché).');
    } catch (e) {
      for (const id of copies) DRIVE.corbeilleFichier(id).catch(() => {});
      signaler(e);
    } finally { S.envois--; render(); }
  },
  'supprimer-produit': async () => {
    const p = S.edit.data;
    const cite = c => c.dossiers.some(d => d.lignes.some(l => l.pid === p.id)) || (c.doe && c.doe.lignes.some(l => l.pid === p.id));
    const chantiers = STORE.liste('chantier').filter(cite);
    const msg = chantiers.length ? `Il est retenu dans ${chantiers.length} chantier(s) : ${chantiers.map(c => c.nom).join(', ')}. Il en sera retiré à la prochaine génération.` : 'La fiche et ses documents partent à la corbeille de Drive (récupérables 30 jours).';
    if (!await confirmer(`Supprimer « ${titreProduit(p)} » ?`, msg, 'Supprimer', true)) return;
    const E = S.edit; S.edit = null;
    const enLigne = STORE.get('produit', p.id) || {};
    await STORE.supprimer('produit', p.id);
    const tout = [...(p.docs || []), ...(p.photos || []), ...(enLigne.docs || []), ...(enLigne.photos || [])].map(x => x.driveId);
    await jeterFichiers([...tout, ...E.retires, ...E.envoyes], p.id);
    toast('Produit supprimé.');
    render();
  }
});

/* saisie : on met à jour le brouillon sans redessiner */
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'q') { S.biblio.q = el.value; S.biblio.limite = PAR_TRANCHE; render(); return; }
  if (el.dataset.champ && S.edit) { S.edit.data[el.dataset.champ] = el.value; }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.champ === 'lot' && S.edit) { S.edit.data.lot = el.value; render(); }
});

/* glisser-déposer sur les zones de documents ; ailleurs, un fichier lâché ne doit pas faire quitter l'appli */
document.addEventListener('dragover', e => { e.preventDefault(); const z = e.target.closest('[data-depot]'); if (z && S.edit) z.classList.add('survol'); });
document.addEventListener('dragleave', e => { const z = e.target.closest('[data-depot]'); if (z) z.classList.remove('survol'); });
document.addEventListener('drop', e => {
  e.preventDefault();
  const z = e.target.closest('[data-depot]');
  if (!z || !S.edit) return;
  z.classList.remove('survol');
  ajouterFichiers(z.dataset.depot, [...e.dataTransfer.files]).catch(signaler);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (S.edit) ACTIONS['fermer-voile']();
  else if (S.kit) ACTIONS['fermer-ensemble']();
  else if (S.picker) ACTIONS['fermer-picker']();
  else if (S.sugg) ACTIONS['fermer-sugg']();
});
