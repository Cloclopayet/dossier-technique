/* Chantiers : un onglet par chantier ; dans chaque chantier, plusieurs dossiers techniques (Sanitaire, VMC…)
   puis, une fois les dossiers remis, la phase DOE : tous les dossiers réunis et modifiables à part. */
'use strict';

const SAUVEGARDE_MS = 900;
const OBJETS = ['Dossier technique — fiches produits pour visa', 'Dossier des ouvrages exécutés (DOE)', 'Dossier d’intervention ultérieure sur l’ouvrage (DIUO)'];
const NOMS_DOSSIERS = ['Sanitaire', 'Plomberie', 'VMC', 'CVC', 'Climatisation', 'Électricité', 'Solaire', 'Photovoltaïque'];

const chantiers = () => STORE.liste('chantier').sort((a, b) => (b.creeLe || '').localeCompare(a.creeLe || ''));
/* copie de travail du chantier ouvert (enregistrée automatiquement) ; base = dernière version connue de Drive.
   enVol = un enregistrement est en cours (un seul à la fois) ; etat ne sert qu'à l'affichage. */
let CH = null;   // { id, data, base, sale, enVol, timer, etat }

function chantierOuvert() {
  const id = S.route.id;
  if (!id) return null;
  const enLigne = STORE.get('chantier', id);
  if (!CH || CH.id !== id) { if (CH && CH.sale) sauverMaintenant(CH); CH = enLigne ? { id, data: clone(enLigne), base: clone(enLigne), sale: false, enVol: false, etat: 'ok' } : null; }
  else if (!CH.sale && !CH.enVol && enLigne && enLigne.maj !== CH.data.maj) { CH.data = clone(enLigne); CH.base = clone(enLigne); }   // modifié par un collègue
  return CH;
}
function programmer(c) { clearTimeout(c.timer); c.timer = setTimeout(() => sauverMaintenant(c), SAUVEGARDE_MS); }
function modifier(fn, redessiner = true) {
  if (!CH) return;
  fn(CH.data);
  CH.sale = true;
  if (!CH.enVol) CH.etat = 'attente';
  programmer(CH);
  if (redessiner) render(); else majEtat();
}
async function sauverMaintenant(c = CH) {
  if (!c || !c.sale) return;
  clearTimeout(c.timer);
  if (c.enVol) { programmer(c); return; }
  const avant = c.etat;
  c.sale = false; c.enVol = true; c.etat = 'envoi'; majEtat();
  const envoye = clone(c.data);
  try {
    const r = await STORE.enregistrer('chantier', envoye, c.base);
    // saisies faites pendant l'envoi : rejouées sur la version enregistrée (qui contient peut-être celles d'un collègue)
    c.data = c.sale ? MODELE.normaliser('chantier', c.id, MODELE.fusionner(envoye, c.data, r.data)) : clone(r.data);
    c.base = clone(r.data);
    c.etat = c.sale ? 'attente' : 'ok';
    if (r.fusionAvec && r.fusionAvec !== ((DRIVE.me && DRIVE.me.name) || '')) { toast(`${r.fusionAvec} modifiait aussi ce chantier : vos changements sont réunis.`, 'ok', 7000); if (!c.sale && CH === c) render(); }
  } catch (e) {
    if (e && e.supprime) { if (CH === c) CH = null; toast(e.message, 'err', 8000); render(); return; }
    c.sale = true; c.etat = 'err';
    if (avant !== 'err' || (e && e.login)) signaler(e);   // pas un message par touche tapée
  } finally { c.enVol = false; }
  majEtat();
  if (c.sale && c.etat !== 'err') programmer(c);
}
function majEtat() {
  const el = $('#etat-sauvegarde'); if (!el || !CH) return;
  const t = { ok: '✓ Enregistré', attente: '… modifications', envoi: '⏫ Enregistrement…', err: '⚠️ Non enregistré' }[CH.etat];
  el.textContent = t; el.className = 'etat ' + CH.etat;
}
window.addEventListener('beforeunload', e => { if (!enReconnexion && CH && (CH.sale || CH.enVol)) { sauverMaintenant(CH); e.preventDefault(); e.returnValue = ''; } });

/* ---------- dossier actif : un dossier technique (id) ou le DOE ---------- */
function sousActif(ch) {
  const s = S.route.sous;
  if (s === 'doe' && ch.doe) return 'doe';
  if (s && (ch.dossiers || []).some(d => d.id === s)) return s;
  return ch.phase === 'doe' && ch.doe ? 'doe' : (ch.dossiers[0] || {}).id;
}
/* l'objet qui porte les lignes, le contenu et la dernière génération du dossier actif */
function cible(ch, sous = sousActif(ch)) { return (sous === 'doe' && ch.doe) || ch.dossiers.find(d => d.id === sous) || ch.dossiers[0]; }
/* même chose sans repli : null si le dossier a disparu entre-temps (supprimé par un collègue) */
const cibleExacte = (ch, sous) => (sous === 'doe' ? ch.doe : ch.dossiers.find(d => d.id === sous)) || null;
const lienSous = (ch, sous) => `#/chantiers/${ch.id}/${sous}`;
const nbProduits = ch => new Set([...(ch.dossiers || []).flatMap(d => d.lignes || []), ...((ch.doe && ch.doe.lignes) || [])].map(l => l.pid)).size;
const derniere = ch => [...(ch.dossiers || []).map(d => d.dernier), ch.doe && ch.doe.dernier].filter(Boolean).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];

/* ---------- vue ---------- */
function ongletsChantiers(idActif) {
  const actifs = chantiers().map(c => (CH && c.id === CH.id ? CH.data : c)).filter(c => c.etat !== 'archive' || c.id === idActif);
  return `<div class="onglets-ch" role="tablist">
    <a href="#/chantiers" class="onglet-ch ${!idActif ? 'actif' : ''}" role="tab">🗂️ Tous</a>
    ${actifs.map(c => `<a href="#/chantiers/${esc(c.id)}" class="onglet-ch ${c.id === idActif ? 'actif' : ''}" role="tab" title="${esc(c.nom)}">${esc(c.nom || 'Sans nom')}</a>`).join('')}
    <button class="onglet-ch plus" data-action="nouveau-chantier" aria-label="Nouveau chantier">＋</button>
  </div>`;
}

function vueChantiers() {
  const c = chantierOuvert();
  if (S.route.id && !c) return `<section class="page">${ongletsChantiers(null)}<div class="vide-etat"><div class="gros-emoji">🤷</div><p>Ce chantier n’existe plus.</p><a class="btn" href="#/chantiers">Voir les chantiers</a></div></section>`;
  if (c) return `<section class="page">${ongletsChantiers(c.id)}${vueUnChantier(c.data)}</section>${S.picker ? vuePicker(c.data) : ''}${S.sugg && S.sugg.id === c.id ? vueSuggestions() : ''}`;
  const liste = chantiers();
  const carte = ch => {
    const n = nbProduits(ch), dn = derniere(ch);
    return `<a class="carte chantier ${ch.etat === 'archive' ? 'archive' : ''}" href="#/chantiers/${esc(ch.id)}">
      <strong class="c-titre">${esc(ch.nom || 'Sans nom')}</strong>
      <span class="c-cell"><small>N° affaire</small>${esc(ch.numero || '—')}</span>
      <span class="c-cell"><small>Maître d’ouvrage</small>${esc(ch.client || '—')}</span>
      <span class="c-docs badges"><span class="badge plein">${esc(ch.phase === 'doe' ? 'DOE' : ch.dossiers.length + ' dossier' + (ch.dossiers.length > 1 ? 's' : ''))}</span><span class="badge">${esc(n)} produit${n > 1 ? 's' : ''}</span>${dn ? `<span class="badge">📄 ${esc(dateFr(dn.date))}</span>` : ''}${ch.etat === 'archive' ? '<span class="badge vide">Archivé</span>' : ''}</span>
    </a>`;
  };
  return `<section class="page">
    ${ongletsChantiers(null)}
    <div class="titre-page"><h1>🏗️ Chantiers</h1><button class="btn primaire" data-action="nouveau-chantier">＋ Nouveau chantier</button></div>
    ${liste.length ? `<div class="grille chantiers">${liste.map(carte).join('')}</div>`
      : `<div class="vide-etat"><div class="gros-emoji">🏗️</div><p><b>Aucun chantier pour l’instant.</b><br>Crée un chantier, monte un dossier technique par corps d’état (Sanitaire, VMC…), puis bascule le tout en DOE.</p><button class="btn primaire" data-action="nouveau-chantier">＋ Créer un chantier</button></div>`}
  </section>`;
}

/* onglets des dossiers du chantier : dossiers techniques, puis le DOE */
function ongletsDossiers(ch, sous) {
  const doe = ch.phase === 'doe' && ch.doe;
  return `<div class="dossiers-ch">
    <span class="etiquette-phase">Phase 1 · Dossiers techniques</span>
    <div class="onglets-dossiers" role="tablist">
      ${ch.dossiers.map(d => `<a href="${esc(lienSous(ch, d.id))}" class="onglet-dossier ${sous === d.id ? 'actif' : ''}" role="tab">${esc(d.nom || 'Dossier')} <small>${esc((d.lignes || []).length)}</small></a>`).join('')}
      <button class="onglet-dossier plus" data-action="nouveau-dossier" title="Ajouter un dossier technique (ex. VMC)">＋ Dossier</button>
    </div>
    <span class="fleche-phase" aria-hidden="true">→</span>
    <span class="etiquette-phase">Phase 2 · DOE</span>
    <div class="onglets-dossiers" role="tablist">
      ${doe ? `<a href="${esc(lienSous(ch, 'doe'))}" class="onglet-dossier doe ${sous === 'doe' ? 'actif' : ''}" role="tab">📘 DOE <small>${esc(ch.doe.lignes.length)}</small></a>`
        : `<button class="onglet-dossier doe a-faire" data-action="passer-doe" title="Réunir tous les dossiers techniques en un DOE modifiable">Passer en DOE ▶</button>`}
    </div>
  </div>`;
}

function vueUnChantier(ch) {
  const sous = sousActif(ch), D = cible(ch, sous), estDoe = sous === 'doe';
  const tous = new Map(produits().map(p => [p.id, p]));
  const plan = MODELE.planDossier(D, tous, reglages().lots);
  const inc = { ...MODELE.INCLURE_DEFAUT, ...(D.inclure || {}) };
  const nb = (D.lignes || []).length;
  const ligne = it => {
    const p = it.produit, l = it.ligne, sans = new Set(l.sans || []);
    const puces = [...(p.docs || []), ...(p.photos || []).map(x => ({ ...x, type: 'photo' }))].map(d => {
      const typeOk = d.type === 'photo' ? inc.photos : inc[Object.prototype.hasOwnProperty.call(MODELE.ORDRE_TYPE, d.type) ? d.type : 'autre'];
      const on = typeOk && !sans.has(d.fid);
      const nom = d.type === 'photo' ? '📷' : (MODELE.TYPES_DOC.find(t => t.id === d.type) || {}).court || 'Doc';
      return `<button class="puce-doc ${on ? 'on' : 'off'}" data-action="basculer-doc" data-pid="${esc(p.id)}" data-fid="${esc(d.fid)}" ${typeOk ? '' : 'disabled'} title="${esc(d.nom)}${typeOk ? (on ? ' — inclus (cliquer pour exclure)' : ' — exclu (cliquer pour inclure)') : ' — type exclu du dossier'}">${esc(nom)}</button>`;
    }).join('');
    const ajouts = (l.ajouts || []).map(a => `<li class="feuille">
        <button class="lien-doc" data-action="voir-feuille" data-pid="${esc(p.id)}" data-fid="${esc(a.fid)}">📎 ${esc(a.nom)}</button>
        <select data-type-feuille="${esc(a.fid)}" data-pid="${esc(p.id)}" aria-label="Type de la feuille">${MODELE.TYPES_DOC.map(t => `<option value="${t.id}" ${t.id === a.type ? 'selected' : ''}>${esc(t.court)}</option>`).join('')}</select>
        <button class="x" data-action="retirer-feuille" data-pid="${esc(p.id)}" data-fid="${esc(a.fid)}" aria-label="Retirer ${esc(a.nom)}">✕</button></li>`).join('');
    const manque = MODELE.TYPES_DOC.filter(t => ['fiche', 'montage', 'entretien'].includes(t.id) && !(p.docs || []).some(d => d.type === t.id) && !(l.ajouts || []).some(d => d.type === t.id)).map(t => t.court);
    return `<li class="ligne-produit">
      <div class="lp-titre"><strong>${esc(p.designation)}</strong><small>${esc([p.marque, p.reference && 'réf. ' + p.reference].filter(Boolean).join(' · '))}</small>
        ${manque.length ? `<small class="manque" title="Documents absents">⚠️ sans ${esc(manque.join(', ').toLowerCase())}</small>` : ''}</div>
      <input class="repere" data-ligne="${esc(p.id)}" value="${esc(l.repere || '')}" placeholder="Repère CCTP" aria-label="Repère CCTP ou devis">
      <div class="lp-docs">${puces || '<small class="discret">aucun document</small>'}<button class="puce-doc ajout" data-action="ajouter-feuille" data-pid="${esc(p.id)}" title="Ajouter une feuille propre à ce chantier (version posée, PV d’essai…)">＋ Feuille</button></div>
      ${ajouts ? `<ul class="feuilles">${ajouts}</ul>` : ''}
      <button class="x" data-action="retirer-ligne" data-pid="${esc(p.id)}" aria-label="Retirer ${esc(p.designation)}">✕</button>
    </li>`;
  };
  const sections = plan.sections.map(s => `<div class="bloc-lot">
    <h3><span class="num-lot">${esc(s.lot.id)}</span> ${esc(s.lot.emoji || '')} ${esc(s.lot.nom)}</h3>
    ${s.familles.map(f => `<h4>${esc(f.nom)}</h4><ul class="lignes">${f.items.map(ligne).join('')}</ul>`).join('')}
  </div>`).join('');
  const manquants = plan.manquants.length ? `<p class="alerte">${esc(plan.manquants.length)} produit(s) retenu(s) ont été supprimés de la bibliothèque. <button class="btn mini" data-action="nettoyer-lignes">Les retirer</button></p>` : '';
  const pieces = (ch.pieces || []).map(d => `<li><button class="lien-doc" data-action="voir-piece" data-fid="${esc(d.fid)}">📄 ${esc(d.nom)}</button><button class="x" data-action="retirer-piece" data-fid="${esc(d.fid)}" aria-label="Retirer ${esc(d.nom)}">✕</button></li>`).join('');
  const G = S.gen && S.gen.id === ch.id && S.gen.sous === sous ? S.gen : null;
  const types = [...MODELE.TYPES_DOC.map(t => [t.id, t.nom]), ['photos', 'Photos'], ['pageProduit', 'Page de présentation par produit']];
  const absentsDuDoe = estDoe ? ch.dossiers.flatMap(d => d.lignes).filter(l => !ch.doe.lignes.some(x => x.pid === l.pid)).length : 0;
  const bandeau = estDoe
    ? `<div class="bandeau doe">📘 <b>Phase DOE</b> — créée le ${esc(dateFr(ch.doe.basculeLe))} à partir de ${esc(ch.dossiers.length)} dossier(s) technique(s). Tu peux ajouter, retirer ou remplacer des feuilles ici : les dossiers techniques déjà remis ne bougent pas.
        ${absentsDuDoe ? `<button class="btn mini" data-action="completer-doe">＋ Reprendre ${esc(absentsDuDoe)} produit(s) ajouté(s) depuis aux dossiers techniques</button>` : ''}</div>`
    : ch.phase === 'doe' ? `<div class="bandeau">Le DOE est déjà créé : les changements faits dans ce dossier technique ne modifient plus le DOE.</div>` : '';
  return `<div class="chantier-tete">
      <div><h1>${esc(ch.nom || 'Sans nom')}</h1><span id="etat-sauvegarde" class="etat ${CH.etat}"></span></div>
      <div class="actions">
        <button class="btn" data-action="archiver-chantier">${ch.etat === 'archive' ? '📤 Désarchiver' : '🗄️ Archiver'}</button>
        <button class="btn danger-lien" data-action="supprimer-chantier">Supprimer</button>
      </div>
    </div>
    ${ongletsDossiers(ch, sous)}
    ${bandeau}
    <div class="deux-col">
      <div class="col-princ">
        <div class="carte bloc">
          <div class="bloc-tete"><h2>🧾 ${esc(estDoe ? 'Contenu du DOE' : D.nom)} <small>${esc(nb)} produit${nb > 1 ? 's' : ''}</small></h2>
            <button class="btn primaire" data-action="ouvrir-picker">＋ Produits ou ensembles</button></div>
          ${manquants}
          ${sections || `<div class="vide-etat petit"><p>Aucun produit dans ce dossier. Ajoute des produits ou des ensembles depuis la bibliothèque, ou dépose ton CCTP / devis à droite et laisse-moi chercher les produits cités.</p></div>`}
        </div>
      </div>
      <aside class="col-cote">
        <div class="carte bloc generer">
          <h2>${estDoe ? '📘 DOE' : '📗 ' + esc(D.nom)}</h2>
          ${estDoe ? '' : `<div class="champs une-col">
            <label>Nom du dossier<input data-dossier="nom" value="${esc(D.nom)}" list="dl-noms-dossiers"></label>
            <datalist id="dl-noms-dossiers">${NOMS_DOSSIERS.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
          </div>`}
          <div class="champs une-col"><label>Objet (page de garde)<input data-dossier="objet" value="${esc(D.objet || '')}" placeholder="${esc(objetPar(D, estDoe))}" list="dl-objets"></label>
            <datalist id="dl-objets">${OBJETS.map(o => `<option value="${esc(o)}">`).join('')}</datalist></div>
          ${G ? vueGeneration(G) : ''}
          <button class="btn primaire gros plein" data-action="generer" ${nb && !(S.gen && (S.gen.etat === 'calcul' || S.gen.etat === 'envoi')) ? '' : 'disabled'}>✨ Générer ${estDoe ? 'le DOE' : 'ce dossier'}</button>
          ${D.dernier ? `<p class="discret">Dernier : ${esc(dateHeureFr(D.dernier.date))} · ${esc(D.dernier.pages)} pages${D.dernier.par ? ' · ' + esc(D.dernier.par) : ''}<br><a href="${esc(DRIVE.lienDossier(DRIVE.sub.dossiers))}" target="_blank" rel="noopener">Ouvrir le dossier Drive ↗</a></p>` : ''}
          <details><summary>Contenu du PDF</summary>
            <div class="cases">${types.map(([k, t]) => `<label class="case"><input type="checkbox" data-inclure="${k}" ${inc[k] ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
          </details>
          ${!estDoe && ch.dossiers.length > 1 ? '<button class="btn danger-lien" data-action="supprimer-dossier">Supprimer ce dossier</button>' : ''}
        </div>
        <div class="carte bloc">
          <h2>📎 CCTP / devis</h2>
          ${pieces ? `<ul class="docs">${pieces}</ul>` : '<p class="discret">Dépose ici tes pièces (PDF) : je repère les produits de ta bibliothèque qui y sont cités.</p>'}
          <div class="actions"><button class="btn" data-action="ajouter-piece">＋ Ajouter un PDF</button>
          ${pieces ? `<button class="btn primaire" data-action="chercher">🔎 Chercher les produits cités</button>` : ''}</div>
        </div>
        <div class="carte bloc">
          <h2>🏷️ Chantier</h2>
          <div class="champs une-col">
            <label>Nom du chantier<input data-ch="nom" value="${esc(ch.nom)}"></label>
            <label>N° d’affaire<input data-ch="numero" value="${esc(ch.numero)}"></label>
            <label>Maître d’ouvrage<input data-ch="client" value="${esc(ch.client)}"></label>
            <label>Maître d’œuvre<input data-ch="moe" value="${esc(ch.moe)}"></label>
            <label>Adresse<textarea data-ch="adresse" rows="2">${esc(ch.adresse)}</textarea></label>
          </div>
        </div>
      </aside>
    </div>`;
}
const objetPar = (D, estDoe) => (estDoe ? 'Dossier des ouvrages exécutés (DOE)' : `Dossier technique — ${D.nom || 'fiches produits'}`);

function apresRenduChantier() {
  majEtat();
  const b = $('.progres > div');   // largeur posée en JS (pas d'attribut style : CSP)
  if (b && S.gen) b.style.width = Math.round(S.gen.pct * 100) + '%';
}

function vueGeneration(G) {
  if (G.etat === 'calcul' || G.etat === 'envoi') {
    return `<div class="progres" role="progressbar" aria-valuenow="${Math.round(G.pct * 100)}" aria-valuemin="0" aria-valuemax="100"><div></div></div><p class="discret">${esc(G.label || '')}</p>`;
  }
  if (G.etat === 'err') return `<p class="alerte">${esc(G.message)}</p>`;
  const r = G.resultat;
  return `<div class="resultat">
    <p>🎉 <b>${esc(r.pages)} pages</b> prêtes.</p>
    <button class="btn" data-action="telecharger-dossier">⬇️ Télécharger à nouveau</button>
    ${r.depose ? '<p class="discret">Copie déposée dans Drive (dossier « dossiers »).</p>' : r.erreurDepot ? `<p class="alerte">Pas déposé dans Drive : ${esc(r.erreurDepot)}</p>` : ''}
    ${r.avertissements.length ? `<details open><summary>⚠️ ${esc(r.avertissements.length)} point(s) à vérifier</summary><ul class="avert">${r.avertissements.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}

/* ---------- choix des produits et des ensembles ---------- */
function vuePicker(ch) {
  const P = S.picker, R = reglages();
  const pris = new Set((cible(ch).lignes || []).map(l => l.pid));
  const liste = MODELE.filtrer(produits(), P.q, P.lot).sort((a, b) => (a.lot || '').localeCompare(b.lot || '') || titreProduit(a).localeCompare(titreProduit(b), 'fr'));
  const kits = ensembles().filter(k => !P.q || MODELE.sansAccents(k.nom).includes(MODELE.sansAccents(P.q)));
  const visibles = liste.slice(0, P.limite);
  const n = P.sel.size + [...P.selKits].reduce((s, id) => s + ((STORE.get('kit', id) || { pids: [] }).pids.filter(x => !pris.has(x) && !P.sel.has(x)).length), 0);
  return `<div class="voile ${entree()}" data-action="fermer-picker"></div>
  <section class="tiroir ${entree()}" role="dialog" aria-modal="true" aria-label="Ajouter des produits">
    <div class="tiroir-tete"><h2>＋ Produits ou ensembles</h2><button class="x gros" data-action="fermer-picker" aria-label="Fermer">✕</button></div>
    <div class="tiroir-corps">
      <div class="recherche"><input type="search" id="q-picker" placeholder="Chercher…" value="${esc(P.q)}" aria-label="Chercher"></div>
      ${kits.length ? `<h3>🧩 Ensembles</h3><ul class="choix-liste">${kits.map(k => `<li><label class="case"><input type="checkbox" data-pick-kit="${esc(k.id)}" ${P.selKits.has(k.id) ? 'checked' : ''}>
        <span><strong>${esc(k.nom)}</strong><small>${esc(k.pids.length)} produit(s) : ${esc(k.pids.map(id => (STORE.get('produit', id) || {}).designation).filter(Boolean).slice(0, 4).join(', '))}${k.pids.length > 4 ? '…' : ''}</small></span></label></li>`).join('')}</ul><h3>Produits</h3>` : ''}
      <div class="puces"><button class="puce ${!P.lot ? 'active' : ''}" data-action="picker-lot" data-id="">Tout</button>${R.lots.filter(l => produits().some(p => p.lot === l.id)).map(l => `<button class="puce ${P.lot === l.id ? 'active' : ''}" data-action="picker-lot" data-id="${esc(l.id)}">${esc(l.emoji || '')} ${esc(l.nom)}</button>`).join('')}</div>
      ${liste.length ? `<ul class="choix-liste">${visibles.map(p => `<li><label class="case ${pris.has(p.id) ? 'deja' : ''}"><input type="checkbox" data-pick="${esc(p.id)}" ${pris.has(p.id) ? 'checked disabled' : P.sel.has(p.id) ? 'checked' : ''}>
        <span><strong>${esc(p.designation)}</strong><small>${esc(lotDe(p.lot).id)} · ${esc([p.famille, p.marque, p.reference].filter(Boolean).join(' · '))}${pris.has(p.id) ? ' — déjà dans ce dossier' : ''}</small></span></label></li>`).join('')}</ul>
        ${liste.length > visibles.length ? `<div class="actions centrees"><button class="btn" data-action="picker-plus">Afficher plus (${esc(visibles.length)} / ${esc(liste.length)})</button></div>` : ''}`
      : `<p class="discret">Rien à proposer. ${produits().length ? '' : 'La bibliothèque est vide : commence par y ajouter ou importer des produits.'}</p>`}
    </div>
    <div class="tiroir-pied"><span class="espace"></span><button class="btn" data-action="fermer-picker">Annuler</button><button class="btn primaire" data-action="valider-picker" ${n ? '' : 'disabled'}>Ajouter ${n || ''}</button></div>
  </section>`;
}

function vueSuggestions() {
  const G = S.sugg;
  return `<div class="voile ${entree()}" data-action="fermer-sugg"></div>
  <section class="tiroir ${entree()}" role="dialog" aria-modal="true" aria-label="Produits cités">
    <div class="tiroir-tete"><h2>🔎 Produits cités dans tes pièces</h2><button class="x gros" data-action="fermer-sugg" aria-label="Fermer">✕</button></div>
    <div class="tiroir-corps">
      ${G.lecture ? `<p>Lecture des PDF… ${esc(G.lecture)}</p>`
      : G.liste.length ? `<p class="discret">Coche ce que tu veux ajouter au dossier ouvert. Je compare les références, marques et désignations de ta bibliothèque au texte des pièces : vérifie toujours.</p>
        <ul class="choix-liste">${G.liste.map(s => `<li><label class="case"><input type="checkbox" data-sugg="${esc(s.produit.id)}" ${G.sel.has(s.produit.id) ? 'checked' : ''}>
          <span><strong>${esc(s.produit.designation)}</strong><small>${esc([s.produit.marque, s.produit.reference].filter(Boolean).join(' · '))} — trouvé : ${esc(s.raisons.join(', '))}</small></span></label></li>`).join('')}</ul>`
      : `<p>Aucun produit de la bibliothèque n’a été reconnu${G.sansTexte ? ' (certains PDF sont des scans sans texte)' : ''}. Ajoute-les à la main avec « Produits ou ensembles ».</p>`}
      ${G.sansTexte && G.liste.length ? '<p class="discret">⚠️ Certains PDF sont des scans sans texte : ils n’ont pas pu être lus.</p>' : ''}
    </div>
    <div class="tiroir-pied"><span class="espace"></span><button class="btn" data-action="fermer-sugg">Fermer</button>${G.liste.length ? `<button class="btn primaire" data-action="valider-sugg" ${G.sel.size ? '' : 'disabled'}>Ajouter ${G.sel.size || ''}</button>` : ''}</div>
  </section>`;
}

/* ---------- génération (un dossier technique ou le DOE) ---------- */
async function generer(ch, sous) {
  const R = reglages(), D = cible(ch, sous), estDoe = sous === 'doe';
  const G = S.gen = { id: ch.id, sous, etat: 'calcul', pct: 0, label: 'Préparation…' };
  render();
  const majProgres = (pct, label) => { G.pct = pct; G.label = label; const b = $('.progres > div'); if (b) { b.style.width = Math.round(pct * 100) + '%'; b.parentElement.setAttribute('aria-valuenow', Math.round(pct * 100)); const t = b.parentElement.nextElementSibling; if (t) t.textContent = label; } };
  try {
    if (!window.PDFLib) throw { message: 'Bibliothèque PDF non chargée : recharge la page.' };
    if (!DRIVE.valid()) throw { login: true, message: 'Connexion Google expirée.' };
    const plan = MODELE.planDossier(D, new Map(produits().map(p => [p.id, p])), R.lots);
    const e = R.entreprise || {};
    let logo = null, logoAvert = null;
    if (e.logo) {
      try { logo = { bytes: await STORE.fichier(e.logo), mime: e.logo.mime }; }
      catch (err) { if (err && (err.login || err.network)) throw err; logoAvert = 'Logo introuvable : page de garde sans logo.'; }
    }
    const objet = D.objet || objetPar(D, estDoe);
    const r = await DOE.genererDossier({
      PDFLib, plan, chantier: { ...ch, objet }, entreprise: e,
      titre: estDoe ? 'D.O.E.' : 'DOSSIER TECHNIQUE', titreCourt: estDoe ? 'DOE' : 'Dossier technique ' + (D.nom || ''), couleur: R.couleur, logo, date: new Date().toLocaleDateString('fr-FR'),
      charger: d => STORE.fichier(d), rasteriser,
      progres: (fait, total, label) => majProgres(total ? 0.85 * fait / total : 0, label)
    });
    const nom = `${estDoe ? 'DOE' : 'Dossier technique ' + MODELE.nomFichier(D.nom)} - ${MODELE.nomFichier(ch.nom || 'chantier')} - ${new Date().toISOString().slice(0, 10)}.pdf`;
    const blob = new Blob([r.bytes], { type: 'application/pdf' });
    G.blob = blob; G.nom = nom;
    telechargerBlob(blob, nom);
    G.etat = 'envoi'; majProgres(0.9, 'Copie dans Drive…');
    STORE.elaguer();
    const resultat = { pages: r.pages, avertissements: [...(logoAvert ? [logoAvert] : []), ...r.avertissements, ...(plan.manquants.length ? [`${plan.manquants.length} produit(s) supprimé(s) de la bibliothèque : absents du dossier.`] : [])] };
    try {
      await DRIVE.deposerDossier(ch.id + '-' + sous, nom, blob, p => majProgres(0.9 + 0.1 * p, 'Copie dans Drive…'), sous === 'principal' ? [ch.id] : []);
      resultat.depose = true;
    } catch (err) { resultat.erreurDepot = errMsg(err); }
    G.etat = 'fini'; G.resultat = resultat;
    if (CH && CH.id === ch.id && cibleExacte(CH.data, sous)) modifier(d => { cibleExacte(d, sous).dernier = { date: new Date().toISOString(), pages: r.pages, par: (DRIVE.me && DRIVE.me.name) || '' }; });
    else render();
  } catch (err) {
    G.etat = 'err'; G.message = 'Génération impossible : ' + errMsg(err) + (err && err.login ? ' Reconnecte-toi puis relance.' : '');
    if (err && err.login) signaler(err);
    render();
  }
}

/* feuilles et pièces du chantier : à la corbeille quand plus rien ne les cite */
const fichiersDuChantier = ch => [...(ch.pieces || []), ...(ch.dossiers || []).flatMap(d => d.lignes.flatMap(l => l.ajouts || [])), ...((ch.doe && ch.doe.lignes) || []).flatMap(l => l.ajouts || [])].map(f => f.driveId);
function trouverAjout(d, pid, fid) {
  const l = (cible(d).lignes || []).find(x => x.pid === pid);
  return { l, a: l && (l.ajouts || []).find(x => x.fid === fid) };
}

Object.assign(ACTIONS, {
  'nouveau-chantier': async () => {
    const d = { id: randomId(), nom: 'Nouveau chantier', numero: '', client: '', moe: '', adresse: '', etat: 'en cours', creeLe: new Date().toISOString(), pieces: [], phase: 'dt',
      dossiers: [{ id: randomId(), nom: 'Sanitaire', objet: '', lignes: [], inclure: { ...MODELE.INCLURE_DEFAUT } }] };
    await STORE.enregistrer('chantier', d, null);
    aller('#/chantiers/' + d.id);
    setTimeout(() => { const i = $('[data-ch="nom"]'); if (i) { i.focus(); i.select(); } }, 50);
  },
  'nouveau-dossier': () => {
    const id = randomId();
    const deja = new Set(CH.data.dossiers.map(d => d.nom));
    const nom = NOMS_DOSSIERS.find(n => !deja.has(n)) || 'Nouveau dossier';
    modifier(d => { d.dossiers = [...d.dossiers, { id, nom, objet: '', lignes: [], inclure: { ...MODELE.INCLURE_DEFAUT } }]; }, false);
    aller(lienSous(CH.data, id));
    setTimeout(() => { const i = $('[data-dossier="nom"]'); if (i) { i.focus(); i.select(); } }, 50);
  },
  'supprimer-dossier': async () => {
    const ch = CH.data, D = cible(ch);
    if (ch.dossiers.length < 2) return;
    if (!await confirmer(`Supprimer le dossier « ${D.nom} » ?`, `${D.lignes.length} produit(s) en seront retirés (ils restent dans la bibliothèque${ch.phase === 'doe' ? ' et dans le DOE' : ''}).`, 'Supprimer', true)) return;
    const ajouts = D.lignes.flatMap(l => l.ajouts || []).map(a => a.driveId);
    const c = CH;
    modifier(d => { d.dossiers = d.dossiers.filter(x => x.id !== D.id); }, false);
    aller(lienSous(ch, ch.dossiers.find(x => x.id !== D.id).id));
    sauverMaintenant(c).then(() => { if (!c.sale && !c.enVol) jeterFichiers(ajouts.filter(id => !fichiersDuChantier(c.data).includes(id)), null).catch(() => {}); });
  },
  'passer-doe': async () => {
    const ch = CH.data;
    const n = nbProduits(ch);
    if (!n) { toast('Ajoute d’abord des produits dans un dossier technique.', 'err'); return; }
    if (!await confirmer('Passer en DOE ?', `Les ${ch.dossiers.length} dossier(s) technique(s) (${n} produit(s)) sont réunis dans un DOE que tu pourras modifier (ajouter, retirer, remplacer des feuilles) sans toucher aux dossiers techniques déjà remis.`, 'Créer le DOE')) return;
    modifier(d => { const n2 = MODELE.basculerEnDoe(d); d.phase = n2.phase; d.doe = n2.doe; }, false);
    aller(lienSous(ch, 'doe'));
    toast('DOE créé ✓ — modifie-le librement, puis génère-le.');
  },
  'completer-doe': () => modifier(d => {
    const vus = new Set(d.doe.lignes.map(l => l.pid));
    for (const dt of d.dossiers) for (const l of dt.lignes) if (!vus.has(l.pid)) { vus.add(l.pid); d.doe.lignes.push(clone(l)); }
  }),
  'archiver-chantier': () => modifier(d => { d.etat = d.etat === 'archive' ? 'en cours' : 'archive'; }),
  'supprimer-chantier': async () => {
    const ch = CH.data;
    if (!await confirmer(`Supprimer « ${ch.nom} » ?`, 'Le chantier part à la corbeille de Drive (récupérable 30 jours). Les produits de la bibliothèque ne sont pas touchés.', 'Supprimer', true)) return;
    clearTimeout(CH.timer); CH = null;
    await STORE.supprimer('chantier', ch.id);   // un enregistrement encore en vol est refusé (fiche supprimée)
    await jeterFichiers(fichiersDuChantier(ch), null);
    aller('#/chantiers');
  },
  'ouvrir-picker': () => { S.picker = { q: '', lot: '', sel: new Set(), selKits: new Set(), limite: 150 }; ouvrirTiroir(); render(); setTimeout(() => { const q = $('#q-picker'); if (q) q.focus(); }, 60); },
  'fermer-picker': () => { S.picker = null; render(); },
  'picker-lot': el => { S.picker.lot = el.dataset.id; S.picker.limite = 150; render(); },
  'picker-plus': () => { S.picker.limite += 150; render(); },
  'valider-picker': () => {
    const P = S.picker;
    const ids = [...P.sel, ...[...P.selKits].flatMap(id => (STORE.get('kit', id) || { pids: [] }).pids)].filter(id => STORE.get('produit', id));
    S.picker = null; ajouterLignes([...new Set(ids)]);
  },
  'retirer-ligne': el => {
    const c = CH, l = (cible(c.data).lignes || []).find(x => x.pid === el.dataset.pid);
    const ajouts = ((l && l.ajouts) || []).map(a => a.driveId);
    modifier(d => { const D = cible(d); D.lignes = D.lignes.filter(x => x.pid !== el.dataset.pid); });
    if (ajouts.length) sauverMaintenant(c).then(() => { if (!c.sale && !c.enVol) jeterFichiers(ajouts.filter(id => !fichiersDuChantier(c.data).includes(id)), null).catch(() => {}); });
  },
  'nettoyer-lignes': () => modifier(d => { const ok = new Set(produits().map(p => p.id)); const D = cible(d); D.lignes = D.lignes.filter(l => ok.has(l.pid)); }),
  'basculer-doc': el => modifier(d => {
    const l = (cible(d).lignes || []).find(x => x.pid === el.dataset.pid); if (!l) return;
    const s = new Set(l.sans || []); s.has(el.dataset.fid) ? s.delete(el.dataset.fid) : s.add(el.dataset.fid);
    l.sans = [...s];
  }),
  /* feuille propre au chantier (version posée, PV d'essai…) ; pour remplacer une feuille : exclure l'ancienne + ajouter la nouvelle */
  'ajouter-feuille': async el => {
    const pid = el.dataset.pid, c = CH, sous = sousActif(c.data);
    const files = await choisirFichiers('application/pdf,image/*', true);
    for (const f of files) {
      S.envois++; renderEntete();
      try {
        const item = await envoyerFichier(f, { type: IMPORT.typeDepuisNom(f.name) });
        const D = CH === c && cibleExacte(c.data, sous), l = D && D.lignes.find(x => x.pid === pid);
        if (l) modifier(d => { const ll = cibleExacte(d, sous).lignes.find(x => x.pid === pid); ll.ajouts = [...(ll.ajouts || []), item]; });
        else { await DRIVE.corbeilleFichier(item.driveId); toast('Ce produit ou ce dossier a été retiré entre-temps : feuille non ajoutée.', 'err'); }
      } catch (e) { signaler(e); }
      finally { S.envois--; renderEntete(); }
    }
  },
  'voir-feuille': el => { const { a } = trouverAjout(CH.data, el.dataset.pid, el.dataset.fid); if (a) ouvrirFichier(a); },
  'retirer-feuille': el => {
    const c = CH, { a } = trouverAjout(c.data, el.dataset.pid, el.dataset.fid); if (!a) return;
    modifier(d => { const { l } = trouverAjout(d, el.dataset.pid, el.dataset.fid); if (l) l.ajouts = l.ajouts.filter(x => x.fid !== a.fid); });
    sauverMaintenant(c).then(() => { if (!c.sale && !c.enVol && !fichiersDuChantier(c.data).includes(a.driveId)) jeterFichiers([a.driveId], null).catch(() => {}); });
  },
  'ajouter-piece': async () => {
    const files = (await choisirFichiers('application/pdf', true)).filter(f => { if (!estPdf(f)) toast(`« ${f.name} » n’est pas un PDF.`, 'err'); return estPdf(f); });
    const c = CH;
    for (const f of files) {
      S.envois++; renderEntete();
      try { const item = await envoyerFichier(f, { type: /devis/i.test(f.name) ? 'devis' : /cctp/i.test(f.name) ? 'cctp' : 'piece' }); if (CH === c) modifier(d => { d.pieces = [...(d.pieces || []), item]; }); else await DRIVE.corbeilleFichier(item.driveId); }
      catch (e) { signaler(e); }
      finally { S.envois--; renderEntete(); }
    }
  },
  'voir-piece': el => { const d = (CH.data.pieces || []).find(x => x.fid === el.dataset.fid); if (d) ouvrirFichier(d); },
  'retirer-piece': el => {
    const d = (CH.data.pieces || []).find(x => x.fid === el.dataset.fid); if (!d) return;
    const c = CH;
    modifier(x => { x.pieces = x.pieces.filter(p => p.fid !== d.fid); });
    sauverMaintenant(c).then(() => { if (!c.sale && !c.enVol) jeterFichiers([d.driveId], null).catch(() => {}); });
  },
  chercher: async () => {
    const ch = CH.data;
    const G = S.sugg = { id: ch.id, lecture: '…', liste: [], sel: new Set(), sansTexte: false };
    ouvrirTiroir(); render();
    let texte = '';
    for (const p of ch.pieces || []) {
      if (S.sugg !== G) return;   // tiroir fermé pendant la lecture
      G.lecture = p.nom; render();
      try { const t = await textePdf(await STORE.fichier(p)); if (t.replace(/\s/g, '').length < 50) G.sansTexte = true; texte += '\n' + t; }
      catch (e) { if (e && e.login) { signaler(e); break; } toast(`« ${p.nom} » illisible : ${errMsg(e)}`, 'err'); }
    }
    if (S.sugg !== G) return;
    G.lecture = '';
    G.liste = MODELE.suggerer(texte, produits(), (cible(CH ? CH.data : ch).lignes || []).map(l => l.pid));
    G.sel = new Set(G.liste.filter(s => s.score >= 4).map(s => s.produit.id));
    render();
  },
  'fermer-sugg': () => { S.sugg = null; render(); },
  'valider-sugg': () => { const ids = [...S.sugg.sel]; S.sugg = null; ajouterLignes(ids); },
  generer: async () => {
    if (S.gen && (S.gen.etat === 'calcul' || S.gen.etat === 'envoi')) return;
    await sauverMaintenant(CH);
    if (CH) await generer(CH.data, sousActif(CH.data));
  },
  'telecharger-dossier': () => { if (S.gen && S.gen.blob) telechargerBlob(S.gen.blob, S.gen.nom); }
});
function ajouterLignes(ids) {
  if (!ids.length) { render(); return; }
  let ajoutes = 0;
  modifier(d => {
    const D = cible(d), deja = new Set(D.lignes.map(l => l.pid));
    const neufs = ids.filter(id => !deja.has(id));
    ajoutes = neufs.length;
    D.lignes = [...D.lignes, ...neufs.map(pid => ({ pid, repere: '', note: '', sans: [], ajouts: [] }))];
  });
  toast(ajoutes ? `${ajoutes} produit${ajoutes > 1 ? 's' : ''} ajouté${ajoutes > 1 ? 's' : ''} ✓` : 'Ces produits sont déjà dans le dossier.');
}

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.ch && CH) modifier(d => { d[el.dataset.ch] = el.value; }, false);
  else if (el.dataset.dossier && CH) modifier(d => { cible(d)[el.dataset.dossier] = el.value; }, false);
  else if (el.dataset.ligne && CH) modifier(d => { const l = (cible(d).lignes || []).find(x => x.pid === el.dataset.ligne); if (l) l.repere = el.value; }, false);
  else if (el.id === 'q-picker' && S.picker) { S.picker.q = el.value; S.picker.limite = 150; render(); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.inclure && CH) modifier(d => { const D = cible(d); D.inclure = { ...MODELE.INCLURE_DEFAUT, ...(D.inclure || {}), [el.dataset.inclure]: el.checked }; });
  else if (el.dataset.typeFeuille && CH) modifier(d => { const { a } = trouverAjout(d, el.dataset.pid, el.dataset.typeFeuille); if (a) a.type = el.value; });
  else if (el.dataset.pick && S.picker) { el.checked ? S.picker.sel.add(el.dataset.pick) : S.picker.sel.delete(el.dataset.pick); render(); }
  else if (el.dataset.pickKit && S.picker) { el.checked ? S.picker.selKits.add(el.dataset.pickKit) : S.picker.selKits.delete(el.dataset.pickKit); render(); }
  else if (el.dataset.sugg && S.sugg) { el.checked ? S.sugg.sel.add(el.dataset.sugg) : S.sugg.sel.delete(el.dataset.sugg); render(); }
});
/* les titres d'onglets se mettent à jour en quittant le champ « nom » */
document.addEventListener('focusout', e => { if (e.target.dataset && (e.target.dataset.ch === 'nom' || e.target.dataset.dossier === 'nom')) setTimeout(render, 0); });
