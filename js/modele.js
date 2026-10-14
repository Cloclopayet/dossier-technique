/* Modèle pur (sans navigateur ni Drive) : lots, types de documents, plan du dossier, suggestions depuis un devis.
   Chargé tel quel dans la page et dans les tests node. */
'use strict';
(function (root) {

  const TYPES_DOC = [
    { id: 'fiche', nom: 'Fiche technique', court: 'Fiche' },
    { id: 'montage', nom: 'Notice de montage', court: 'Montage' },
    { id: 'entretien', nom: 'Notice d’entretien', court: 'Entretien' },
    { id: 'pv', nom: 'PV / procès-verbal', court: 'PV' },
    { id: 'certificat', nom: 'Certificat / garantie', court: 'Certificat' },
    { id: 'autre', nom: 'Autre document', court: 'Autre' }
  ];
  const ORDRE_TYPE = Object.assign(Object.create(null), Object.fromEntries(TYPES_DOC.map((t, i) => [t.id, i])));
  const NOM_TYPE = Object.assign(Object.create(null), Object.fromEntries(TYPES_DOC.map(t => [t.id, t.nom])));

  const LOTS_DEFAUT = [
    ['01', '🧱', 'Gros œuvre – Maçonnerie'],
    ['02', '🏠', 'Charpente – Couverture – Zinguerie'],
    ['03', '🛡️', 'Étanchéité'],
    ['04', '🪟', 'Menuiseries extérieures'],
    ['05', '🚪', 'Menuiseries intérieures'],
    ['06', '🧩', 'Plâtrerie – Cloisons – Faux plafonds'],
    ['07', '🟫', 'Revêtements de sols – Faïence'],
    ['08', '🎨', 'Peinture'],
    ['09', '🚿', 'Plomberie – Sanitaire'],
    ['10', '🌬️', 'CVC – Ventilation – Climatisation'],
    ['11', '⚡', 'Électricité courants forts'],
    ['12', '📡', 'Courants faibles'],
    ['13', '🔥', 'Sécurité incendie'],
    ['14', '🛣️', 'VRD – Espaces verts']
  ].map(([id, emoji, nom]) => ({ id, emoji, nom }));

  /* ce que le dossier contient par défaut */
  const INCLURE_DEFAUT = { fiche: true, montage: true, entretien: true, pv: true, certificat: true, autre: true, photos: true, pageProduit: true };

  const LOT_DIVERS = { id: '99', emoji: '📦', nom: 'Divers' };
  const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'fr', { sensitivity: 'base', numeric: true });

  /* Plan du dossier d'un chantier : lots (ordre des réglages) → familles → produits avec leurs documents retenus.
     Les lignes dont le produit a été supprimé sont rendues à part (manquants). */
  function planDossier(chantier, produits, lots) {
    const parId = produits instanceof Map ? produits : new Map(produits.map(p => [p.id, p]));
    const inclure = { ...INCLURE_DEFAUT, ...(chantier.inclure || {}) };
    const ordreLot = new Map((lots || []).map((l, i) => [l.id, i]));
    const sections = new Map();
    const manquants = [];
    const vus = new Set();
    for (const ligne of chantier.lignes || []) {
      if (vus.has(ligne.pid)) continue;          // un produit n'apparaît qu'une fois dans le dossier
      vus.add(ligne.pid);
      const p = parId.get(ligne.pid);
      if (!p) { manquants.push(ligne); continue; }
      const lot = (lots || []).find(l => l.id === p.lot) || LOT_DIVERS;
      if (!sections.has(lot.id)) sections.set(lot.id, { lot, familles: new Map() });
      const fam = (p.famille || '').trim() || 'Autres';
      const s = sections.get(lot.id);
      if (!s.familles.has(fam)) s.familles.set(fam, []);
      const sans = new Set(ligne.sans || []);
      // feuilles de la bibliothèque (filtrées) + feuilles ajoutées pour ce chantier (DOE : version posée, PV d'essai…)
      const docs = [
        ...(p.docs || []).filter(d => d.driveId && inclure[Object.prototype.hasOwnProperty.call(ORDRE_TYPE, d.type) ? d.type : 'autre'] && !sans.has(d.fid)),
        ...(ligne.ajouts || []).filter(d => d.driveId).map(d => ({ ...d, ajout: true }))
      ].sort((a, b) => (ORDRE_TYPE[a.type] ?? 99) - (ORDRE_TYPE[b.type] ?? 99));
      const photos = inclure.photos ? (p.photos || []).filter(ph => ph.driveId && !sans.has(ph.fid)) : [];
      s.familles.get(fam).push({ produit: p, ligne, docs, photos });
    }
    const out = [...sections.values()]
      .sort((a, b) => (ordreLot.has(a.lot.id) ? ordreLot.get(a.lot.id) : 999) - (ordreLot.has(b.lot.id) ? ordreLot.get(b.lot.id) : 999) || cmp(a.lot.id, b.lot.id))
      .map(s => ({
        lot: s.lot,
        familles: [...s.familles.entries()]
          .sort((a, b) => (a[0] === 'Autres') - (b[0] === 'Autres') || cmp(a[0], b[0]))
          .map(([nom, items]) => ({ nom, items: items.sort((a, b) => cmp(a.produit.marque, b.produit.marque) || cmp(a.produit.designation, b.produit.designation)) }))
      }));
    return { sections: out, manquants, inclure };
  }

  /* ---------- texte des PDF (polices standard = jeu WinAnsi) ---------- */
  const WIN_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  const REMPLACE = { ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '×': 'x', '✓': 'v', '⌀': 'Ø', 'Ø': 'Ø', '−': '-', '‐': '-', '‑': '-', '\t': ' ' };
  function pdfTexte(s) {
    let out = '';
    for (const ch of String(s == null ? '' : s).normalize('NFC')) {
      const c = ch.codePointAt(0);
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_EXTRA.includes(ch)) out += ch;
      else if (ch in REMPLACE) out += REMPLACE[ch];
      else if (ch === '\n' || ch === '\r') out += ' ';
      else {
        const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (base && base !== ch && [...base].every(x => x.codePointAt(0) < 0x7f)) out += base;   // lettre accentuée hors Latin-1
        // le reste (émojis, symboles) est retiré
      }
    }
    return out.replace(/ {2,}/g, ' ').trim();
  }

  /* ---------- suggestions depuis le texte d'un CCTP / devis ---------- */
  const sansAccents = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const compact = s => sansAccents(s).replace(/[^a-z0-9]/g, '');
  const MOTS_VIDES = new Set(['avec', 'pour', 'sans', 'dans', 'sous', 'type', 'mise', 'place', 'compris', 'yc', 'fourniture', 'pose', 'blanc', 'blanche', 'serie', 'gamme', 'modele', 'ensemble', 'unite']);
  const motsUtiles = s => sansAccents(s).split(/[^a-z0-9]+/).filter(m => m.length >= 4 && !MOTS_VIDES.has(m));

  function suggerer(texte, produits, dejaPris) {
    const plat = ' ' + sansAccents(texte).replace(/[^a-z0-9]+/g, ' ') + ' ';
    const serre = compact(texte);
    const pris = new Set(dejaPris || []);
    const out = [];
    for (const p of produits) {
      if (pris.has(p.id)) continue;
      const raisons = [];
      let score = 0;
      const ref = compact(p.reference);
      if (ref.length >= 4 && /[0-9]/.test(ref) && serre.includes(ref)) { score += 3; raisons.push('référence ' + p.reference); }
      const marque = sansAccents(p.marque).replace(/[^a-z0-9]+/g, ' ').trim();
      const aMarque = marque.length >= 2 && plat.includes(' ' + marque + ' ');
      if (aMarque) { score += 1; raisons.push('marque ' + p.marque); }
      const mots = [...new Set(motsUtiles(p.designation))];
      if (mots.length) {
        const trouves = mots.filter(m => plat.includes(' ' + m));   // début de mot : « tube » trouve « tubes »
        const part = trouves.length / mots.length;
        if (part >= 0.6) { score += aMarque ? 2 : 1; raisons.push('désignation'); }
      }
      if (score >= 3) out.push({ produit: p, score, raisons });
    }
    return out.sort((a, b) => b.score - a.score || cmp(a.produit.designation, b.produit.designation));
  }

  /* recherche dans la bibliothèque : tous les mots doivent apparaître quelque part */
  function filtrer(produits, q, lot) {
    const mots = sansAccents(q).split(/\s+/).filter(Boolean);
    return produits.filter(p => {
      if (lot && p.lot !== lot) return false;
      if (!mots.length) return true;
      const t = sansAccents([p.designation, p.marque, p.reference, p.famille, p.description].join(' '));
      return mots.every(m => t.includes(m));
    });
  }

  /* ---------- fusion à 3 voies (deux personnes ont modifié la même fiche) ----------
     base = version lue avant modification, mien = ma version, leur = version enregistrée entre-temps.
     Chacun garde ce qu'il a changé ; sur un même champ, ma saisie (la dernière) l'emporte.
     Les listes d'objets sont fusionnées par identifiant (fid, pid, id), les listes simples comme des ensembles. */
  const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const CLES_INTERDITES = new Set(['__proto__', 'constructor', 'prototype']);
  const estObjet = v => v && typeof v === 'object' && !Array.isArray(v);
  const cleDe = o => (estObjet(o) ? ['fid', 'pid', 'id'].find(k => o[k] != null) : undefined);

  function fusionner(base, mien, leur) {
    if (egal(mien, base)) return leur === undefined ? mien : leur;
    if (egal(leur, base) || leur === undefined) return mien;
    if (Array.isArray(mien) && Array.isArray(leur)) return fusionListe(Array.isArray(base) ? base : [], mien, leur);
    if (estObjet(mien) && estObjet(leur)) {
      const b = estObjet(base) ? base : {};
      const out = {};
      for (const k of new Set([...Object.keys(leur), ...Object.keys(mien)])) {
        if (CLES_INTERDITES.has(k)) continue;
        const v = fusionner(b[k], mien[k], leur[k]);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    return mien;
  }
  function fusionListe(base, mien, leur) {
    const k = cleDe(mien[0]) || cleDe(leur[0]) || cleDe(base[0]);
    if (!k) {   // valeurs simples : ensemble
      const retires = new Set(base.filter(x => !mien.includes(x)).map(x => JSON.stringify(x)));
      const out = leur.filter(x => !retires.has(JSON.stringify(x)));
      for (const x of mien) if (!base.some(b => egal(b, x)) && !out.some(o => egal(o, x))) out.push(x);
      return out;
    }
    const parCle = l => new Map(l.map(x => [x[k], x]));
    const B = parCle(base), Mi = parCle(mien);
    const out = [];
    for (const x of leur) {
      const id = x[k];
      if (B.has(id) && !Mi.has(id)) continue;                        // je l'ai retiré
      out.push(Mi.has(id) ? fusionner(B.get(id), Mi.get(id), x) : x);
    }
    const dansLeur = new Set(leur.map(x => x[k]));
    for (const x of mien) if (!B.has(x[k]) && !dansLeur.has(x[k])) out.push(x);   // ajouté par moi
    return out;
  }

  /* ---------- contrôle des fiches lues sur Drive ----------
     Un collaborateur peut écrire n'importe quoi dans le dossier partagé (directement par l'API) : chaque fiche est
     remise en forme à la lecture (types, longueurs, identifiants, formats de fichiers) avant d'être affichée ou utilisée. */
  const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
  const MIME_DOC = new Set(['application/pdf', 'image/jpeg', 'image/png']);
  const MIME_IMAGE = new Set(['image/jpeg', 'image/png']);
  const MIME_PDF = new Set(['application/pdf']);
  const txt = (v, max = 300) => (typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : '').slice(0, max);
  const num = v => { const n = Number(v); return isFinite(n) && n >= 0 ? Math.floor(n) : 0; };
  const liste = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
  const idOk = v => (typeof v === 'string' && ID_RE.test(v) ? v : null);

  function fichierOk(d, mimes, avecType) {
    if (!estObjet(d) || !idOk(d.fid) || !idOk(d.driveId) || !mimes.has(d.mime)) return null;
    const out = { fid: d.fid, driveId: d.driveId, nom: txt(d.nom, 200) || 'document', mime: d.mime, taille: num(d.taille) };
    if (avecType) out.type = Object.prototype.hasOwnProperty.call(ORDRE_TYPE, d.type) ? d.type : 'autre';
    return out;
  }
  const fichiers = (v, mimes, avecType, max = 200) => liste(v, max).map(d => fichierOk(d, mimes, avecType)).filter(Boolean);
  const signature = d => ({ maj: txt(d.maj, 40), majPar: txt(d.majPar, 120) });

  function lignesOk(v) {
    const vus = new Set();
    return liste(v, 2000).filter(l => estObjet(l) && idOk(l.pid) && !vus.has(l.pid) && vus.add(l.pid))
      .map(l => ({ pid: l.pid, repere: txt(l.repere, 80), note: txt(l.note, 300), sans: liste(l.sans, 400).filter(idOk), ajouts: fichiers(l.ajouts, MIME_DOC, true, 40) }));
  }
  const inclureOk = v => { const inc = estObjet(v) ? v : {}; return Object.fromEntries(Object.keys(INCLURE_DEFAUT).map(k => [k, typeof inc[k] === 'boolean' ? inc[k] : INCLURE_DEFAUT[k]])); };
  const dernierOk = v => (estObjet(v) ? { dernier: { date: txt(v.date, 40), pages: num(v.pages), par: txt(v.par, 120) } } : {});

  /* passage en DOE : tous les dossiers techniques réunis (un produit une seule fois), devenus modifiables à part */
  function basculerEnDoe(ch, quand) {
    const vus = new Set();
    const lignes = [];
    for (const dt of ch.dossiers || []) for (const l of dt.lignes || []) if (!vus.has(l.pid)) { vus.add(l.pid); lignes.push(JSON.parse(JSON.stringify(l))); }
    return { ...ch, phase: 'doe', doe: { lignes, inclure: { ...INCLURE_DEFAUT }, basculeLe: quand || new Date().toISOString(), objet: 'Dossier des ouvrages exécutés (DOE)' } };
  }

  function normaliser(col, id, brut) {
    const d = estObjet(brut) ? brut : {};
    if (col === 'produit') {
      return { id, lot: txt(d.lot, 10), famille: txt(d.famille, 120), marque: txt(d.marque, 120), reference: txt(d.reference, 120),
        designation: txt(d.designation, 300), description: txt(d.description, 4000),
        docs: fichiers(d.docs, MIME_DOC, true), photos: fichiers(d.photos, MIME_IMAGE, false, 60),
        sources: liste(d.sources, 400).filter(idOk),   // fichiers d'origine (import Drive) : relancer l'import ne crée pas de doublon
        ...signature(d) };
    }
    if (col === 'chantier') {
      // ancien format (une seule liste de lignes) : devient le premier dossier technique
      const brutsDossiers = Array.isArray(d.dossiers) ? d.dossiers : [{ id: 'principal', nom: 'Dossier technique', objet: d.objet, lignes: d.lignes, inclure: d.inclure, dernier: d.dernier }];
      const vusD = new Set();
      const dossiers = liste(brutsDossiers, 40).filter(x => estObjet(x) && idOk(x.id) && x.id !== 'doe' && !vusD.has(x.id) && vusD.add(x.id))   // « doe » est réservé au DOE
        .map(x => ({ id: x.id, nom: txt(x.nom, 120) || 'Dossier', objet: txt(x.objet, 200), lignes: lignesOk(x.lignes), inclure: inclureOk(x.inclure), ...dernierOk(x.dernier) }));
      if (!dossiers.length) dossiers.push({ id: 'principal', nom: 'Dossier technique', objet: '', lignes: [], inclure: inclureOk(null) });
      const doe = d.phase === 'doe' && estObjet(d.doe)
        ? { lignes: lignesOk(d.doe.lignes), inclure: inclureOk(d.doe.inclure), basculeLe: txt(d.doe.basculeLe, 40), objet: txt(d.doe.objet, 200), ...dernierOk(d.doe.dernier) } : null;
      return { id, nom: txt(d.nom, 200), numero: txt(d.numero, 80), client: txt(d.client, 200), moe: txt(d.moe, 200), adresse: txt(d.adresse, 400),
        etat: d.etat === 'archive' ? 'archive' : 'en cours', creeLe: txt(d.creeLe, 40),
        pieces: liste(d.pieces, 50).map(x => { const f = fichierOk(x, MIME_PDF, false); return f && { ...f, type: ['cctp', 'devis'].includes(x.type) ? x.type : 'piece' }; }).filter(Boolean),
        dossiers, phase: doe ? 'doe' : 'dt', doe, ...signature(d) };
    }
    if (col === 'kit') {
      const vus = new Set();
      return { id, nom: txt(d.nom, 200), description: txt(d.description, 1000), lot: txt(d.lot, 10),
        pids: liste(d.pids, 100).filter(x => idOk(x) && !vus.has(x) && vus.add(x)), ...signature(d) };
    }
    if (col === 'reglages') {
      const e = estObjet(d.entreprise) ? d.entreprise : {};
      const vus = new Set();
      const lots = liste(d.lots, 60).filter(l => estObjet(l) && txt(l.id, 6).trim() && !vus.has(txt(l.id, 6).trim()) && vus.add(txt(l.id, 6).trim()))
        .map(l => ({ id: txt(l.id, 6).trim(), emoji: txt(l.emoji, 8), nom: txt(l.nom, 120) || 'Lot' }));
      return { id, entreprise: { nom: txt(e.nom, 200), adresse: txt(e.adresse, 400), tel: txt(e.tel, 40), email: txt(e.email, 120), logo: fichierOk(e.logo, MIME_IMAGE, false) },
        couleur: /^#[0-9a-f]{6}$/i.test(d.couleur) ? d.couleur : '#a77bf3', lots: lots.length ? lots : LOTS_DEFAUT, ...signature(d) };
    }
    return null;
  }

  const nomFichier = s => pdfTexte(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'document';

  const api = { TYPES_DOC, NOM_TYPE, ORDRE_TYPE, LOTS_DEFAUT, LOT_DIVERS, INCLURE_DEFAUT, planDossier, pdfTexte, suggerer, filtrer, nomFichier, sansAccents, fusionner, normaliser, basculerEnDoe, ID_RE };
  root.MODELE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
