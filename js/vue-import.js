/* Assistant d'import : un dossier Google Drive de fiches techniques → produits de la bibliothèque.
   Étapes : lien → catégories (lot de chacune) → lecture + aperçu par sous-dossier → copie des PDF et création des produits.
   Relancer l'import ne crée pas de doublon (chaque produit garde l'identifiant de ses fichiers d'origine). */
'use strict';

const IMPORT_PARALLELE = 3;
let IMP = { etape: 'lien', lien: '' };

const moTaille = n => (n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1).replace('.', ',') + ' Mo';
const dejaImportes = () => new Set(produits().flatMap(p => p.sources || []));

function vueImport() {
  const R = reglages();
  const optionsLot = sel => `<option value="99" ${sel === '99' || !sel ? 'selected' : ''}>99 — Divers</option>` + R.lots.map(l => `<option value="${esc(l.id)}" ${l.id === sel ? 'selected' : ''}>${esc(l.id)} — ${esc(l.nom)}</option>`).join('');
  const etapes = ['lien', 'categories', 'apercu', 'import'];
  const n = Math.max(0, etapes.indexOf(IMP.etape === 'lecture' ? 'categories' : IMP.etape === 'fini' ? 'import' : IMP.etape));
  const fil = `<ol class="fil-etapes">${['Dossier Drive', 'Catégories', 'Aperçu', 'Import'].map((t, i) => `<li class="${i < n ? 'fait' : i === n ? 'actif' : ''}">${i + 1}. ${t}</li>`).join('')}</ol>`;
  let corps = '';

  if (IMP.etape === 'lien') {
    corps = `<div class="carte bloc">
      <h2>Quel dossier importer ?</h2>
      <p>Colle le lien du dossier Google Drive qui contient tes fiches techniques (par ex. « 03 - Fiche techniques »). Seuls les <b>PDF</b> sont importés ; ils sont <b>copiés</b> dans le dossier partagé de l’appli, tes originaux ne bougent pas.</p>
      <form class="inviter" data-form="import-lien"><input name="lien" value="${esc(IMP.lien)}" placeholder="https://drive.google.com/drive/folders/…" aria-label="Lien du dossier Drive" required><button class="btn primaire">Lire le dossier</button></form>
      ${IMP.erreur ? `<p class="alerte">${esc(IMP.erreur)}</p>` : ''}
    </div>`;
  } else if (IMP.etape === 'categories' || IMP.etape === 'lecture') {
    const lecture = IMP.etape === 'lecture';
    corps = `<div class="carte bloc">
      <h2>📁 ${esc(IMP.racine.name)} <small>${esc(IMP.cats.length)} dossiers</small></h2>
      <p class="discret">Coche les catégories qui contiennent des fiches techniques et choisis leur lot. Les catalogues, doublons de synchronisation, documents client et supports de formation sont écartés automatiquement.</p>
      <table class="table-produits table-cats"><thead><tr><th></th><th>Catégorie</th><th>Lot</th></tr></thead><tbody>
      ${IMP.cats.map((c, i) => `<tr><td><input type="checkbox" data-imp-cat="${i}" ${c.coche ? 'checked' : ''} ${lecture ? 'disabled' : ''} aria-label="Importer ${esc(c.nom)}"></td><td>${esc(c.nom)}${c.exclu ? ' <small class="discret">(écarté d’office)</small>' : ''}</td>
        <td><select data-imp-lot="${i}" ${lecture || !c.coche ? 'disabled' : ''} aria-label="Lot de ${esc(c.nom)}">${optionsLot(c.lot)}</select></td></tr>`).join('')}
      </tbody></table>
      ${lecture ? `<div class="progres"><div></div></div><p class="discret">${esc(IMP.label || 'Lecture…')}</p>`
        : `<div class="actions"><button class="btn" data-action="import-retour">◀ Changer de dossier</button><button class="btn primaire" data-action="import-lire" ${IMP.cats.some(c => c.coche) ? '' : 'disabled'}>Lire les fiches ▶</button></div>`}
    </div>`;
  } else if (IMP.etape === 'apercu') {
    const P = IMP.prep, choisis = produitsChoisis();
    const tailleTot = choisis.reduce((s, p) => s + p.fichiers.reduce((m, f) => m + f.taille, 0), 0);
    const e = P.ecartes;
    corps = `<div class="carte bloc">
      <h2>Aperçu <small>${esc(choisis.length)} produits · ${esc(choisis.reduce((s, p) => s + p.fichiers.length, 0))} PDF · ${esc(moTaille(tailleTot))}</small></h2>
      <p class="discret">Écartés : catalogues, doublons de synchronisation, documents client et supports de formation (dossiers non lus) ; ${esc(e.format)} fichier(s) non PDF, ${esc(e.doublon)} doublon(s), ${esc(e.taille)} trop gros (> 100 Mo)${e.deja ? `, <b>${esc(e.deja)} déjà importé(s)</b>` : ''}. La marque, la famille et le type de document sont devinés d’après les dossiers et les noms : tu corrigeras ensuite dans la bibliothèque.</p>
      <div class="groupes-import">${IMP.groupes.map((g, i) => `<label class="case"><input type="checkbox" data-imp-groupe="${i}" ${g.coche ? 'checked' : ''}><span><strong>${esc(g.cle)}</strong><small>${esc(g.produits)} produit(s) · ${esc(moTaille(g.taille))}</small></span></label>`).join('')}</div>
      <h3>Exemples <small>${esc(Math.min(40, choisis.length))} sur ${esc(choisis.length)}</small></h3>
      <div class="table-defil"><table class="table-produits"><thead><tr><th>Désignation</th><th>Marque</th><th>Réf.</th><th>Lot</th><th>Famille</th><th>Documents</th></tr></thead><tbody>
      ${choisis.slice(0, 40).map(p => `<tr><td class="t-des">${esc(p.designation)}</td><td>${esc(p.marque || '—')}</td><td class="mono">${esc(p.reference || '—')}</td><td class="mono">${esc(p.lot)}</td><td>${esc(p.famille)}</td><td><span class="badges">${p.fichiers.map(f => `<span class="badge plein" title="${esc(f.nom)}">${esc((MODELE.TYPES_DOC.find(t => t.id === f.type) || {}).court || f.type)}</span>`).join('')}</span></td></tr>`).join('')}
      </tbody></table></div>
      <div class="actions"><button class="btn" data-action="import-categories">◀ Catégories</button><button class="btn primaire" data-action="import-lancer" ${choisis.length ? '' : 'disabled'}>Importer ${esc(choisis.length)} produits</button></div>
    </div>`;
  } else {
    const p = IMP.progres, fini = IMP.etape === 'fini';
    corps = `<div class="carte bloc">
      <h2>${fini ? (p.annule ? '⏸ Import interrompu' : '✓ Import terminé') : '⏫ Import en cours'} <small>${esc(p.fait)} / ${esc(p.total)} produits</small></h2>
      ${fini ? '' : `<div class="progres"><div></div></div><p class="discret">${esc(p.label || '')}</p><p class="discret">Tu peux continuer à utiliser l’appli dans cet onglet ; ne le ferme pas avant la fin. Interrompu, l’import reprend où il s’était arrêté si tu le relances.</p>`}
      ${p.erreurs.length ? `<details ${fini ? 'open' : ''}><summary>⚠️ ${esc(p.erreurs.length)} fichier(s) non importé(s)</summary><ul class="avert">${p.erreurs.slice(0, 50).map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      <div class="actions">${fini ? `<a class="btn primaire" href="#/biblio">Voir la bibliothèque</a><button class="btn" data-action="import-nouveau">Importer un autre dossier</button>${p.annule || p.erreurs.length ? '<button class="btn" data-action="import-lire">Relancer (reprend sans doublon)</button>' : ''}` : '<button class="btn danger-lien" data-action="import-arreter">Arrêter</button>'}</div>
    </div>`;
  }
  return `<section class="page etroite">
    <div class="titre-page"><h1>⇪ Importer des fiches depuis Drive</h1><a class="btn" href="#/biblio">◀ Bibliothèque</a></div>
    ${fil}${corps}
  </section>`;
}

function produitsChoisis() {
  const ok = new Set(IMP.groupes.filter(g => g.coche).map(g => g.cle));
  return IMP.prep.produits.filter(p => ok.has(p.chemin.split('/').slice(0, 2).join('/')));
}
function majBarre(fraction, label) {
  IMP.pct = fraction; IMP.label = label;
  const b = $('.progres > div'); if (b) b.style.width = Math.round(fraction * 100) + '%';
  const t = b && b.parentElement.nextElementSibling; if (t) t.textContent = label;
}
function renduImport() { if (S.route.vue === 'import') { render(); majBarre(IMP.pct || 0, IMP.label || ''); } }

async function lireDossier(lien) {
  const id = DRIVE.idDepuisLien(lien);
  if (!id) { IMP = { etape: 'lien', lien, erreur: 'Lien non reconnu : colle l’adresse d’un dossier Google Drive.' }; render(); return; }
  try {
    const info = await DRIVE.infoDossier(id);
    if (info.mimeType !== 'application/vnd.google-apps.folder') throw { message: 'Ce lien n’est pas un dossier.' };
    const enf = await DRIVE.enfants(id);
    const cats = enf.filter(e => e.mimeType === 'application/vnd.google-apps.folder')
      .map(e => { const exclu = IMPORT.EXCLUS.test(e.name); return { id: e.id, nom: e.name, exclu, coche: !exclu && !IMPORT.HORS_FT.test(e.name), lot: IMPORT.lotDepuisCategorie(e.name) || '99' }; })
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
    if (!cats.length) throw { message: 'Ce dossier ne contient pas de sous-dossiers (catégories).' };
    IMP = { etape: 'categories', lien, racine: { id, name: info.name }, cats };
  } catch (e) {
    if (e && e.login) { signaler(e); return; }
    IMP = { etape: 'lien', lien, erreur: e && e.status === 404 ? 'Dossier introuvable, ou pas partagé avec ce compte Google.' : errMsg(e) };
  }
  render();
}

async function lireFiches() {
  const cats = IMP.cats.filter(c => c.coche);
  IMP.etape = 'lecture'; IMP.pct = 0; render();
  try {
    const fichiers = [];
    for (const [i, c] of cats.entries()) {
      const nomCat = c.nom.replace(/\//g, '∕');
      const liste = await DRIVE.arbre(c.id, chemin => IMPORT.EXCLUS.test(chemin.split('/').pop()),
        (lus, n) => majBarre((i + Math.min(0.95, lus / 60)) / cats.length, `${c.nom} : ${lus} dossiers lus, ${n} fichiers`));
      for (const f of liste) fichiers.push({ ...f, path: f.path ? nomCat + '/' + f.path : nomCat });
    }
    const noms = cats.map(c => c.nom.replace(/\//g, '∕'));
    const prep = IMPORT.preparerImport(fichiers, { categories: new Set(noms), lots: Object.fromEntries(cats.map((c, i) => [noms[i], c.lot])), dejaImportes: dejaImportes() });
    IMP.prep = prep;
    IMP.groupes = IMPORT.groupes(prep.produits);
    IMP.etape = 'apercu';
  } catch (e) {
    IMP.etape = 'categories';
    signaler(e);
  }
  render();
}

async function lancerImport() {
  const liste = produitsChoisis();
  const p = IMP.progres = { fait: 0, total: liste.length, erreurs: [], annule: false, label: '' };
  IMP.etape = 'import'; IMP.pct = 0; render();
  let i = 0;
  const travail = async () => {
    while (i < liste.length && !p.annule) {
      const prod = liste[i++];
      const copies = [];   // { source, doc }
      try {
        for (const f of prod.fichiers) {
          const driveId = await DRIVE.copierDepuis(f.id, `${randomId()} - ${MODELE.nomFichier(f.nom)}`);
          copies.push({ source: f.id, doc: { fid: randomId(), driveId, nom: f.nom, mime: 'application/pdf', taille: f.taille, type: f.type } });
        }
        // un produit n'est créé que complet : sinon ses copies partent à la corbeille et la relance le refait proprement
        const idProduit = randomId();   // même identifiant à chaque essai : jamais deux fiches pour un produit
        await DRIVE.reessayer(() => STORE.enregistrer('produit', { id: idProduit, lot: prod.lot, famille: prod.famille, marque: prod.marque, reference: prod.reference || '', designation: prod.designation,
          description: '', docs: copies.map(c => c.doc), photos: [], sources: copies.map(c => c.source) }, null, { silencieux: true }));
      } catch (e) {
        for (const c of copies) DRIVE.corbeille(c.doc.driveId).catch(() => {});
        if (e && e.login) { p.annule = true; signaler(e); break; }
        p.erreurs.push(`${prod.chemin} — ${prod.designation} : ${errMsg(e)}`);
      }
      p.fait++;
      majBarre(p.fait / p.total, `${p.fait} / ${p.total} — ${prod.designation}`);
    }
  };
  await Promise.all(Array.from({ length: IMPORT_PARALLELE }, travail));
  IMP.etape = 'fini';
  STORE.onChange();
  toast(p.annule ? `Import interrompu : ${p.fait} produit(s) traité(s).` : `Import terminé : ${p.fait} produit(s) traité(s) ✓`, p.annule ? 'err' : 'ok', 7000);
  renduImport();
}
const importEnCours = () => IMP.etape === 'import' || IMP.etape === 'lecture';
window.addEventListener('beforeunload', e => { if (importEnCours()) { e.preventDefault(); e.returnValue = ''; } });

Object.assign(ACTIONS, {
  'import-retour': () => { IMP = { etape: 'lien', lien: IMP.lien }; render(); },
  'import-nouveau': () => { IMP = { etape: 'lien', lien: '' }; render(); },
  'import-categories': () => { IMP.etape = 'categories'; render(); },
  'import-lire': () => { if (!importEnCours()) lireFiches(); },
  'import-lancer': async () => {
    const n = produitsChoisis().length;
    if (!await confirmer(`Importer ${n} produits ?`, `Depuis « ${IMP.racine.name} ». Les PDF sont copiés dans le dossier partagé de l’appli, visible par toute l’équipe (tes originaux ne bougent pas). Compte quelques minutes pour quelques centaines de fiches.`, 'Importer')) return;
    lancerImport();
  },
  'import-arreter': () => { if (IMP.progres) { IMP.progres.annule = true; majBarre(IMP.pct || 0, 'Arrêt après les fiches en cours…'); } }
});
document.addEventListener('submit', e => {
  if (e.target.dataset.form !== 'import-lien') return;
  e.preventDefault();
  lireDossier(e.target.lien.value);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.impCat !== undefined) { const c = IMP.cats[+el.dataset.impCat]; c.coche = el.checked; render(); }
  else if (el.dataset.impLot !== undefined) IMP.cats[+el.dataset.impLot].lot = el.value;
  else if (el.dataset.impGroupe !== undefined) { IMP.groupes[+el.dataset.impGroupe].coche = el.checked; render(); }
});
