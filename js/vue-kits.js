/* Ensembles : groupes de produits toujours posés ensemble (ex. WC Geberit = cuvette + bâti + plaque + robinet + pipe),
   ajoutés en un clic à un dossier de chantier. */
'use strict';

const ensembles = () => STORE.liste('kit').sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr'));

function vueEnsembles() {
  const liste = ensembles();
  if (!liste.length) {
    return `<div class="vide-etat"><div class="gros-emoji">🧩</div><p><b>Aucun ensemble pour l’instant.</b><br>Un ensemble regroupe des produits toujours posés ensemble (ex. « WC Geberit » : cuvette, bâti, plaque, robinet, pipe). Dans un chantier, tu l’ajoutes en un clic.</p><button class="btn primaire" data-action="nouvel-ensemble">＋ Créer un ensemble</button></div>`;
  }
  return `<div class="grille">${liste.map(k => {
    const prods = k.pids.map(id => STORE.get('produit', id)).filter(Boolean);
    const manquants = k.pids.length - prods.length;
    return `<button class="carte ensemble" data-action="editer-ensemble" data-id="${esc(k.id)}">
      <strong class="c-titre">🧩 ${esc(k.nom || 'Sans nom')}</strong>
      <span class="c-cell"><small>Produits</small>${esc(prods.length)}${manquants ? ` <em class="manque">(${esc(manquants)} supprimé${manquants > 1 ? 's' : ''})</em>` : ''}</span>
      <span class="c-cell"><small>Lot</small>${esc(k.lot ? lotDe(k.lot).id + ' ' + lotDe(k.lot).nom : '—')}</span>
      <ul class="c-liste">${prods.slice(0, 6).map(p => `<li>${esc(titreProduit(p))}</li>`).join('')}${prods.length > 6 ? `<li class="discret">… et ${esc(prods.length - 6)} autre(s)</li>` : ''}</ul>
    </button>`;
  }).join('')}</div>`;
}

function vueEditeurKit() {
  const K = S.kit, k = K.data, R = reglages();
  const dedans = k.pids.map(id => STORE.get('produit', id) || { id, designation: 'Produit supprimé', marque: '' });
  const pris = new Set(k.pids);
  const candidats = K.q.trim() ? MODELE.filtrer(produits(), K.q).filter(p => !pris.has(p.id)).slice(0, 40) : [];
  return `<div class="voile ${entree()}" data-action="fermer-ensemble"></div>
  <section class="tiroir ${entree()}" role="dialog" aria-modal="true" aria-label="Ensemble">
    <div class="tiroir-tete"><h2>${K.nouveau ? '＋ Nouvel ensemble' : '🧩 ' + esc(k.nom || 'Ensemble')}</h2><button class="x gros" data-action="fermer-ensemble" aria-label="Fermer">✕</button></div>
    <div class="tiroir-corps">
      <div class="champs">
        <label class="large">Nom de l’ensemble *<input data-kit="nom" value="${esc(k.nom)}" placeholder="WC suspendu Geberit complet"></label>
        <label>Lot<select data-kit="lot"><option value="">—</option>${R.lots.map(l => `<option value="${esc(l.id)}" ${l.id === k.lot ? 'selected' : ''}>${esc(l.id)} — ${esc(l.nom)}</option>`).join('')}</select></label>
        <label class="large">Description<textarea data-kit="description" rows="2" placeholder="Pour quel usage, quelles variantes…">${esc(k.description)}</textarea></label>
      </div>
      <h3>Produits de l’ensemble <small>${esc(dedans.length)}</small></h3>
      ${dedans.length ? `<ul class="choix-liste">${dedans.map(p => `<li class="ligne-kit"><span><strong>${esc(p.designation)}</strong><small>${esc([p.marque, p.reference].filter(Boolean).join(' · '))}</small></span><button class="x" data-action="kit-retirer" data-id="${esc(p.id)}" aria-label="Retirer ${esc(p.designation)}">✕</button></li>`).join('')}</ul>` : '<p class="discret">Cherche ci-dessous les produits à mettre dans l’ensemble.</p>'}
      <h3>Ajouter un produit</h3>
      <div class="recherche"><input type="search" id="q-kit" placeholder="Chercher : bâti, plaque, Geberit…" value="${esc(K.q)}" aria-label="Chercher un produit à ajouter"></div>
      ${candidats.length ? `<ul class="choix-liste">${candidats.map(p => `<li class="ligne-kit"><span><strong>${esc(p.designation)}</strong><small>${esc([lotDe(p.lot).id, p.famille, p.marque, p.reference].filter(Boolean).join(' · '))}</small></span><button class="btn mini" data-action="kit-ajouter" data-id="${esc(p.id)}">＋ Ajouter</button></li>`).join('')}</ul>` : K.q.trim() ? '<p class="discret">Aucun produit trouvé.</p>' : ''}
    </div>
    <div class="tiroir-pied">
      ${K.nouveau ? '' : '<button class="btn danger-lien" data-action="supprimer-ensemble">Supprimer</button>'}
      <span class="espace"></span>
      <button class="btn" data-action="fermer-ensemble">Annuler</button>
      <button class="btn primaire" data-action="enregistrer-ensemble">Enregistrer</button>
    </div>
  </section>`;
}

function editerKit(k, nouveau) {
  S.kit = { data: clone(k), base: nouveau ? null : clone(k), nouveau, q: '' };
  ouvrirTiroir(); render();
}

Object.assign(ACTIONS, {
  'nouvel-ensemble': () => { S.biblio.onglet = 'ensembles'; editerKit({ id: randomId(), nom: '', description: '', lot: '', pids: [] }, true); },
  'editer-ensemble': el => { const k = STORE.get('kit', el.dataset.id); if (k) editerKit(k, false); },
  'fermer-ensemble': () => { S.kit = null; render(); },
  'kit-ajouter': el => { S.kit.data.pids = [...S.kit.data.pids, el.dataset.id]; render(); },
  'kit-retirer': el => { S.kit.data.pids = S.kit.data.pids.filter(id => id !== el.dataset.id); render(); },
  'enregistrer-ensemble': async el => {
    const K = S.kit;
    if (!K.data.nom.trim()) { toast('Donne un nom à l’ensemble.', 'err'); $('[data-kit="nom"]').focus(); return; }
    if (!K.data.pids.length) { toast('Ajoute au moins un produit.', 'err'); return; }
    el.disabled = true;
    try {
      const r = await STORE.enregistrer('kit', { ...K.data, nom: K.data.nom.trim() }, K.base);
      S.kit = null;
      toast(r.fusionAvec ? `Enregistré ✓ — réuni avec les changements de ${r.fusionAvec}.` : 'Ensemble enregistré ✓');
      render();
    } catch (e) { el.disabled = false; signaler(e); }
  },
  'supprimer-ensemble': async () => {
    const k = S.kit.data;
    if (!await confirmer(`Supprimer l’ensemble « ${k.nom} » ?`, 'Les produits restent dans la bibliothèque et dans les chantiers où ils ont déjà été ajoutés.', 'Supprimer', true)) return;
    S.kit = null;
    await STORE.supprimer('kit', k.id);
    toast('Ensemble supprimé.');
    render();
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (!S.kit) return;
  if (el.dataset.kit) S.kit.data[el.dataset.kit] = el.value;
  else if (el.id === 'q-kit') { S.kit.q = el.value; render(); }
});
document.addEventListener('change', e => { if (S.kit && e.target.dataset.kit === 'lot') S.kit.data.lot = e.target.value; });
