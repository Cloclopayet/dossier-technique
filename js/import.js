/* Import d'une arborescence de fiches techniques (dossier Drive) : règles pures, testées sous node.
   Arborescence attendue : Catégorie / [famille] / MARQUE / [famille] / fichier.pdf (ex. 1 PLOMBERIE/ALLIA/WC/x.pdf). */
'use strict';
(function (root) {
  const M = root.MODELE || (typeof require !== 'undefined' ? require('./modele.js') : null);
  const sa = s => M.sansAccents(s);

  /* dossiers écartés par défaut (catalogues, doublons de synchro, documents client, vignettes…) */
  const EXCLUS = /catalogue|caseconflict|@__thumb|^client$|d[ée]claration pr[ée]alable|page de garde|crack|setup|installeur|formation|vid[ée]o|^cours\b|^photos?$/i;
  /* catégories de 1er niveau décochées par défaut (pas des fiches techniques) */
  const HORS_FT = /fournisseur|[ée]tude|sport|cao|assainissement|vrd|aep|catalogue/i;
  /* sous-dossiers proposés mais décochés : supports de stage, tarifs, logiciels… */
  const GROUPE_DOUTEUX = /supp?ort|stage|tarif|devis|logiciel|annexe|estimation|quiz/i;
  /* noms de dossiers génériques, jamais des marques */
  const PAS_MARQUE = /^(notices?|data|ft|fp|doc|docs|documentation|photos?|pdf|divers|autres?|fiches?|plans?|schemas?|selection|tests?|archives?|old|new|fr|en)$/i;
  const A_CLASSER = /^0*0\s*-\s*a classer$/i;

  /* catégorie (1er niveau) → lot, d'après des mots-clés ; '' = à choisir */
  const LOT_MOTS = [
    [/plomberie|sanitaire|surpresseur|pompe|solaire|eau chaude|ecs/, '09'],
    [/vmc|ventilation|climatisation|clim|cvc|chauffage/, '10'],
    [/photovolta|electri|irve|courant fort/, '11'],
    [/courant faible|telecom|alarme/, '12'],
    [/incendie|desenfumage|ligne de vie/, '13'],
    [/vrd|assainissement|aep/, '14'],
    [/tole|couverture|charpente/, '02'],
    [/menuiserie/, '05'],
    [/peinture/, '08']
  ];
  function lotDepuisCategorie(cat) {
    const t = sa(cat).replace(/^[0-9]+\s*-?\s*/, '');
    for (const [re, lot] of LOT_MOTS) if (re.test(t)) return lot;
    return '';
  }

  const TYPE_MOTS = [
    [/\b(pv|proces|essai|classement|avis technique|atec|dta|rapport d.essai)\b/, 'pv'],
    [/\b(certif\w*|garantie|attestation|cstb|acs|nf|declaration de performance|dop|ce)\b/, 'certificat'],
    [/\b(notice|montage|installation|instal|pose|mounting|assembly|guide d.installation)\b/, 'montage'],
    [/\b(entretien|maintenance|utilisation|utilisateur|user|mode d.emploi)\b/, 'entretien'],
    [/\b(fds|fiche de (donnees de )?securite)\b|^s fr /, 'autre']
  ];
  const MONTAGE = /\b(montage|installation|instal|pose|mounting|assembly)\b/;
  const ENTRETIEN = /\b(entretien|maintenance|utilisation|utilisateur|user|mode d.emploi)\b/;
  function typeDepuisNom(nom) {
    const t = ' ' + sa(nom).replace(/\.[a-z0-9]+$/, '').replace(/[_\-.()']+/g, ' ') + ' ';
    if (ENTRETIEN.test(t) && !MONTAGE.test(t)) return 'entretien';   // « notice d'entretien » avant « notice »
    for (const [re, type] of TYPE_MOTS) if (re.test(t)) return type;
    return 'fiche';
  }

  /* une MARQUE est écrite en majuscules dans l'arborescence (ALLIA, DELABIE, SANITAIRE-DIJOUX) */
  const estMarque = s => { const l = s.replace(/[^A-Za-zÀ-ÿ]/g, ''); return l.length >= 2 && l === l.toUpperCase() && !A_CLASSER.test(s) && !PAS_MARQUE.test(s.trim()); };
  const propre = s => s.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const casse = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  /* chemin d'un fichier (segments sous la racine, sans le nom) → catégorie, marque, famille */
  function analyserChemin(segments) {
    const [cat = '', ...reste] = segments;
    const utiles = reste.filter(s => !/^\.@__thumb$/i.test(s));
    const iMarque = utiles.findIndex(estMarque);
    const marque = iMarque >= 0 ? propre(utiles[iMarque].replace(/-/g, ' ')) : '';
    const familles = utiles.filter((s, i) => i !== iMarque).map(s => (A_CLASSER.test(s) ? 'À classer' : casse(propre(s))));
    return { categorie: cat, familleVraie: familles.length > 0, marque: marque ? casse(marque.toLowerCase()).replace(/\b\w/g, c => c.toUpperCase()) : '', famille: familles.length ? familles[familles.length - 1] : casse(propre(cat.replace(/^[0-9]+\s*-?\s*/, '').toLowerCase())) };
  }

  const MOTS_TYPE = /\b(fiche[s]? technique[s]?|fiche|ft|fp|notice[s]?|montage|installation|entretien|maintenance|utilisation|pv|proc[eè]s[- ]verbal|cstb|avis technique|atec|certificat|garantie|attestation|technical ?data|datasheet|data ?sheet|fr|francais|français)\b/gi;
  /* petits mots laissés seuls une fois les mots de type retirés (« notice de montage » → « de ») */
  const MOTS_VIDES = /\s+\b(de|du|des|d|la|le|les|l|et|pour|en)\b(?=\s*$)/gi;
  const nettoyerFin = s => { let t = s, avant; do { avant = t; t = t.replace(MOTS_VIDES, '').trim(); } while (t !== avant); return t; };
  /* désignation lisible depuis un nom de fichier : sans extension, sans la marque, sans les mots de type */
  function designationDepuisNom(nom, marque) {
    let t = nom.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_]+/g, ' ').replace(/\s*\(\d+\)\s*$/, '');
    if (marque) t = t.replace(new RegExp('\\b' + marque.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]*') + '\\b', 'ig'), ' ');
    const sansType = t.replace(MOTS_TYPE, ' ').replace(/\s*-\s*$/, '').replace(/^\s*-\s*/, '');
    const r = nettoyerFin(propre(sansType.replace(/\s+-\s+/g, ' - ')).replace(/^(de|du|des|d)\s+/i, ''));
    return casse(r.length >= 3 ? r : propre(t)) || 'Sans nom';
  }

  const estCode = s => /\d/.test(s) && !/[a-zà-ÿ]{4,}/i.test(s.replace(/[0-9]+/g, ' ').split(/\s+/).filter(m => m.length >= 4 && /[a-z]{2}/.test(m) && /[aeiouyé]/i.test(m)).join(' ')) && s.length <= 24;

  /* clé de regroupement : dans un même dossier, « X fiche technique.pdf » et « X notice.pdf » = un seul produit */
  const cleProduit = (dossier, designation) => dossier + '|' + sa(designation).replace(/[^a-z0-9]/g, '');

  /* fichiers bruts {id, path, name, mimeType, size} → produits proposés.
     opts : { categories: Set des catégories retenues, lots: {categorie: lot}, dejaImportes: Set d'id Drive source, tailleMax } */
  function preparerImport(fichiers, opts) {
    const o = { tailleMax: 100 * 1024 * 1024, ...opts };
    const vusContenu = new Set();
    const produits = new Map();
    const ecartes = { exclus: 0, format: 0, taille: 0, doublon: 0, deja: 0 };
    for (const f of fichiers) {
      const segs = String(f.path || '').split('/').filter(Boolean);
      if (!segs.length || !o.categories.has(segs[0])) continue;
      if (segs.some(s => EXCLUS.test(s))) { ecartes.exclus++; continue; }
      if (f.mimeType !== 'application/pdf') { ecartes.format++; continue; }
      if (f.size && f.size > o.tailleMax) { ecartes.taille++; continue; }
      if (o.dejaImportes && o.dejaImportes.has(f.id)) { ecartes.deja++; continue; }
      const sig = sa(f.name).replace(/\s*\(\d+\)(?=\.[a-z0-9]+$)/, '') + '|' + (f.size || '');   // « x (1).pdf » = copie de « x.pdf »
      if (vusContenu.has(sig)) { ecartes.doublon++; continue; }   // même fichier rangé deux fois
      vusContenu.add(sig);
      const ch = analyserChemin(segs);
      let designation = designationDepuisNom(f.name, ch.marque), reference = '';
      // nom de fichier = simple code (« 18468.pdf », « AO131890.pdf ») : c'est une référence
      if (estCode(designation)) { reference = designation; designation = [ch.familleVraie ? ch.famille : '', ch.marque].filter(Boolean).join(' ') + ' ' + reference; }
      const k = cleProduit(segs.join('/'), designation);
      if (!produits.has(k)) produits.set(k, { cle: k, categorie: ch.categorie, lot: (o.lots && o.lots[ch.categorie]) || lotDepuisCategorie(ch.categorie) || '99', famille: ch.famille, marque: ch.marque, reference, designation: designation.trim(), chemin: segs.join('/'), fichiers: [] });
      produits.get(k).fichiers.push({ id: f.id, nom: f.name, taille: f.size || 0, type: typeDepuisNom(f.name) });
    }
    // dans un produit, si tout est « fiche » sauf un, rien à changer ; si plusieurs fiches, la plus grosse reste fiche, les autres « autre »
    for (const p of produits.values()) {
      const fiches = p.fichiers.filter(x => x.type === 'fiche');
      if (fiches.length > 1) fiches.sort((a, b) => b.taille - a.taille).slice(1).forEach(x => { x.type = 'autre'; });
    }
    return { produits: [...produits.values()].sort((a, b) => a.chemin.localeCompare(b.chemin, 'fr') || a.designation.localeCompare(b.designation, 'fr')), ecartes };
  }

  /* catégories de 1er niveau proposées (cochées par défaut si ce sont des fiches techniques) */
  function categoriesProposees(fichiers) {
    const c = new Map();
    for (const f of fichiers) {
      const cat = String(f.path || '').split('/').filter(Boolean)[0];
      if (!cat) continue;
      if (!c.has(cat)) c.set(cat, { nom: cat, pdf: 0, fichiers: 0, taille: 0 });
      const x = c.get(cat); x.fichiers++;
      if (f.mimeType === 'application/pdf') { x.pdf++; x.taille += f.size || 0; }
    }
    return [...c.values()].map(x => ({ ...x, lot: lotDepuisCategorie(x.nom), coche: !EXCLUS.test(x.nom) && !HORS_FT.test(x.nom) && x.pdf > 0 && x.pdf / x.fichiers >= 0.25 }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
  }

  /* groupes « Catégorie/sous-dossier » d'un aperçu, pour cocher/décocher finement */
  function groupes(produits) {
    const g = new Map();
    for (const p of produits) {
      const k = p.chemin.split('/').slice(0, 2).join('/');
      if (!g.has(k)) g.set(k, { cle: k, produits: 0, fichiers: 0, taille: 0, coche: !GROUPE_DOUTEUX.test(k.split('/')[1] || '') });
      const x = g.get(k); x.produits++; x.fichiers += p.fichiers.length; x.taille += p.fichiers.reduce((s, f) => s + f.taille, 0);
    }
    return [...g.values()].sort((a, b) => a.cle.localeCompare(b.cle, 'fr', { numeric: true }));
  }

  const api = { preparerImport, groupes, categoriesProposees, analyserChemin, typeDepuisNom, designationDepuisNom, lotDepuisCategorie, EXCLUS, HORS_FT };
  root.IMPORT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
