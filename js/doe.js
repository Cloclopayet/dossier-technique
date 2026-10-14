/* Fabrication du dossier technique (PDF) avec pdf-lib : couverture, sommaire paginé, intercalaire par lot,
   page de présentation par produit (photos), documents fusionnés, pied de page numéroté.
   Pur : reçoit pdf-lib et des fonctions de chargement ; utilisé dans la page et dans les tests node. */
'use strict';
(function (root) {
  const M = root.MODELE || (typeof require !== 'undefined' ? require('./modele.js') : null);
  const T = M.pdfTexte;

  const A4 = [595.28, 841.89];
  const MARGE = 50;
  const H_LOT = 30, H_FAMILLE = 20, H_PRODUIT = 32;
  const SOMMAIRE_HAUT_1 = 640, SOMMAIRE_HAUT_N = 700;   // hauteur utile du sommaire : 1re page (avec titre), suivantes
  const PHOTOS_PAR_PAGE = 4;

  /* connexion ou réseau perdu : on arrête tout (sinon le dossier se remplirait de pages « à joindre ») */
  const bloquante = e => !!(e && (e.login || e.network));
  const hauteurEntree = e => (e.niv === 'lot' ? H_LOT : e.niv === 'famille' ? H_FAMILLE : H_PRODUIT);

  /* découpe des entrées du sommaire en pages */
  function paginerSommaire(entrees, h1 = SOMMAIRE_HAUT_1, hn = SOMMAIRE_HAUT_N) {
    const pages = [[]];
    let reste = h1;
    entrees.forEach((e, i) => {
      let h = hauteurEntree(e);
      // un titre (lot, famille) ne reste pas seul en bas de page : il part avec les titres qui suivent et le 1er produit
      for (let j = i + 1; e.niv !== 'produit' && entrees[j]; j++) { h += hauteurEntree(entrees[j]); if (entrees[j].niv === 'produit') break; }
      if (h > reste && pages[pages.length - 1].length) { pages.push([]); reste = hn; }
      pages[pages.length - 1].push(e);
      reste -= hauteurEntree(e);
    });
    return pages;
  }

  function entreesSommaire(plan) {
    const out = [];
    for (const s of plan.sections) {
      out.push({ niv: 'lot', texte: `LOT ${s.lot.id} — ${s.lot.nom}`, cle: 'lot:' + s.lot.id });
      for (const f of s.familles) {
        out.push({ niv: 'famille', texte: f.nom });
        for (const it of f.items) {
          const p = it.produit;
          const docs = [...new Set(it.docs.map(d => (M.TYPES_DOC.find(t => t.id === d.type) || M.TYPES_DOC[5]).court))];
          if (it.photos.length) docs.push('Photos');
          const sous = [p.reference && 'Réf. ' + p.reference, it.ligne.repere && 'Repère ' + it.ligne.repere, docs.join(', ')].filter(Boolean).join('  ·  ');
          out.push({ niv: 'produit', texte: [p.marque, p.designation].filter(Boolean).join(' — '), sous, cle: 'p:' + p.id });
        }
      }
    }
    return out;
  }

  function couleurRgb(PDFLib, hex, clair) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') || [0, 'a77bf3'];
    const n = parseInt(m[1], 16);
    let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    if (clair) { r = r + (1 - r) * clair; g = g + (1 - g) * clair; b = b + (1 - b) * clair; }
    return PDFLib.rgb(r, g, b);
  }

  function couper(texte, font, taille, largeur) {
    const lignes = [];
    for (const para of String(texte || '').split(/\n+/)) {
      let cur = '';
      for (const mot of T(para).split(' ')) {
        if (!mot) continue;
        const essai = cur ? cur + ' ' + mot : mot;
        if (font.widthOfTextAtSize(essai, taille) <= largeur) { cur = essai; continue; }
        if (cur) lignes.push(cur);
        // mot plus long que la ligne : coupé net
        let m = mot;
        while (font.widthOfTextAtSize(m, taille) > largeur && m.length > 1) {
          let k = m.length - 1;
          while (k > 1 && font.widthOfTextAtSize(m.slice(0, k), taille) > largeur) k--;
          lignes.push(m.slice(0, k)); m = m.slice(k);
        }
        cur = m;
      }
      if (cur) lignes.push(cur);
    }
    return lignes;
  }
  /* texte sur une ligne, raccourci avec « … » s'il dépasse */
  function tronquer(texte, font, taille, largeur) {
    let t = T(texte);
    if (font.widthOfTextAtSize(t, taille) <= largeur) return t;
    while (t.length > 1 && font.widthOfTextAtSize(t + '…', taille) > largeur) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  }

  async function genererDossier(o) {
    const { PDFLib, plan, chantier } = o;
    const { PDFDocument, StandardFonts, PDFName, degrees } = PDFLib;
    const ent = o.entreprise || {};
    const progres = o.progres || (() => {});
    const avertissements = [];
    const doc = await PDFDocument.create();
    doc.setTitle(T(`${o.titreCourt || 'Dossier technique'} — ${chantier.nom || ''}`));
    doc.setCreator('Dossier technique GSE'); doc.setProducer('GSE');
    if (ent.nom) doc.setAuthor(T(ent.nom));
    const F = await doc.embedFont(StandardFonts.Helvetica);
    const FB = await doc.embedFont(StandardFonts.HelveticaBold);
    const C = couleurRgb(PDFLib, o.couleur), CL = couleurRgb(PDFLib, o.couleur, 0.85), CXL = couleurRgb(PDFLib, o.couleur, 0.94);
    const NOIR = PDFLib.rgb(0.11, 0.08, 0.19), GRIS = PDFLib.rgb(0.42, 0.4, 0.48), BLANC = PDFLib.rgb(1, 1, 1);
    const largeurUtile = A4[0] - 2 * MARGE;
    const texte = (page, t, x, y, taille, gras, couleur) => page.drawText(T(t), { x, y, size: taille, font: gras ? FB : F, color: couleur || NOIR });

    const images = new Map();   // une image (photo, logo) n'est intégrée qu'une fois
    async function image(bytes, mime) {
      const png = mime === 'image/png' || (bytes[0] === 0x89 && bytes[1] === 0x50);
      return png ? doc.embedPng(bytes) : doc.embedJpg(bytes);
    }
    async function imageDe(item) {
      if (images.has(item.driveId)) return images.get(item.driveId);
      const img = await image(await o.charger(item), item.mime);
      images.set(item.driveId, img);
      return img;
    }
    const logo = o.logo ? await image(o.logo.bytes, o.logo.mime).catch(() => { avertissements.push('Logo illisible : ignoré.'); return null; }) : null;
    const dessinerImage = (page, img, x, y, w, h) => {
      const k = Math.min(w / img.width, h / img.height);
      const iw = img.width * k, ih = img.height * k;
      page.drawImage(img, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih });
    };

    /* ---------- corps ---------- */
    const entrees = entreesSommaire(plan);
    const pagesSommaire = paginerSommaire(entrees);
    const debutCorps = 1 + pagesSommaire.length;     // nombre de pages avant le corps
    const pageDe = {};                                 // clé → index de page (0 = première page du corps)
    const total = plan.sections.reduce((n, s) => n + s.familles.reduce((m, f) => m + f.items.reduce((k, it) => k + it.docs.length + it.photos.length + 1, 0), 0), 0);
    let fait = 0;

    for (const s of plan.sections) {
      pageDe['lot:' + s.lot.id] = doc.getPageCount();
      intercalaire(s);
      for (const f of s.familles) {
        for (const it of f.items) {
          const p = it.produit;
          const titre = [p.marque, p.designation].filter(Boolean).join(' — ');
          progres(fait, total, titre);
          const debut = doc.getPageCount();
          pageDe['p:' + p.id] = debut;
          let photos = it.photos;
          if (plan.inclure.pageProduit) { await pageProduit(s, f, it); photos = photos.slice(PHOTOS_PAR_PAGE); }
          for (let i = 0; i < photos.length; i += PHOTOS_PAR_PAGE) await pagePhotos(titre, photos.slice(i, i + PHOTOS_PAR_PAGE));
          fait += 1 + it.photos.length;
          for (const d of it.docs) {
            progres(fait, total, `${titre} : ${M.NOM_TYPE[d.type] || 'document'}`);
            await ajouterDocument(d, titre);
            fait++;
          }
          if (doc.getPageCount() === debut) delete pageDe['p:' + p.id];   // produit sans aucune page : pas de numéro
        }
      }
    }
    progres(total, total, 'Mise en page');

    function nouvellePage() { return doc.addPage(A4); }

    function intercalaire(s) {
      const page = nouvellePage();
      page.drawRectangle({ x: 0, y: 0, width: 150, height: A4[1], color: C });
      texte(page, 'LOT', 40, A4[1] - 140, 22, true, BLANC);
      texte(page, s.lot.id, 36, A4[1] - 210, 64, true, BLANC);
      const x = 185, w = A4[0] - x - MARGE;
      let y = A4[1] - 150;
      for (const l of couper(s.lot.nom, FB, 30, w)) { texte(page, l, x, y, 30, true); y -= 36; }
      y -= 6;
      page.drawRectangle({ x, y, width: 60, height: 5, color: C });
      y -= 40;
      const produits = s.familles.reduce((n, f) => n + f.items.length, 0);
      texte(page, `${produits} produit${produits > 1 ? 's' : ''} dans ce lot`, x, y, 11, false, GRIS);
      y -= 34;
      let restants = produits;
      for (const f of s.familles) {
        if (y < 110) break;
        texte(page, f.nom.toUpperCase(), x, y, 10.5, true, C); y -= 18;
        for (const it of f.items) {
          if (y < 110) break;
          const p = it.produit;
          texte(page, tronquer([p.marque, p.designation].filter(Boolean).join(' — '), F, 11, w - 12), x + 12, y, 11);
          page.drawCircle({ x: x + 4, y: y + 3.5, size: 2, color: C });
          y -= 17; restants--;
        }
        y -= 8;
      }
      if (restants > 0) texte(page, `… et ${restants} autre${restants > 1 ? 's' : ''} (voir le sommaire)`, x, y, 10, false, GRIS);
      if (ent.nom) texte(page, tronquer(ent.nom, F, 9, w), x, 60, 9, false, GRIS);
    }

    async function pageProduit(s, f, it) {
      const p = it.produit;
      const page = nouvellePage();
      page.drawRectangle({ x: 0, y: A4[1] - 70, width: A4[0], height: 70, color: CXL });
      texte(page, tronquer(`LOT ${s.lot.id} · ${s.lot.nom} · ${f.nom}`, FB, 10, largeurUtile), MARGE, A4[1] - 42, 10, true, C);
      let y = A4[1] - 115;
      for (const l of couper(p.designation || 'Produit', FB, 22, largeurUtile).slice(0, 3)) { texte(page, l, MARGE, y, 22, true); y -= 27; }
      const ligne2 = [p.marque, p.reference && 'Réf. ' + p.reference].filter(Boolean).join('   ·   ');
      if (ligne2) { texte(page, ligne2, MARGE, y, 12.5, false, GRIS); y -= 24; }
      if (it.ligne.repere || it.ligne.note) {
        const t = [it.ligne.repere && 'Repère CCTP / devis : ' + it.ligne.repere, it.ligne.note].filter(Boolean).join('  —  ');
        const lignes = couper(t, F, 10.5, largeurUtile - 20).slice(0, 3);
        page.drawRectangle({ x: MARGE, y: y - lignes.length * 14 + 4, width: largeurUtile, height: lignes.length * 14 + 10, color: CXL });
        for (const l of lignes) { texte(page, l, MARGE + 10, y - 4, 10.5); y -= 14; }
        y -= 18;
      }
      if (p.description) {
        for (const l of couper(p.description, F, 10.5, largeurUtile).slice(0, 8)) { texte(page, l, MARGE, y, 10.5); y -= 14.5; }
        y -= 12;
      }
      texte(page, 'DOCUMENTS JOINTS', MARGE, y, 10, true, C); y -= 18;
      const liste = it.docs.map(d => `${M.NOM_TYPE[d.type] || 'Document'} — ${d.nom || ''}`);
      if (it.photos.length) liste.push(`${it.photos.length} photo${it.photos.length > 1 ? 's' : ''}`);
      if (!liste.length) liste.push('Aucun document joint');
      for (const l of liste.slice(0, 10)) {
        page.drawRectangle({ x: MARGE, y: y - 1, width: 7, height: 7, color: C });
        texte(page, tronquer(l, F, 10.5, largeurUtile - 16), MARGE + 15, y, 10.5); y -= 16;
      }
      // photos : grille 2 × 2 dans l'espace restant
      const photos = it.photos.slice(0, PHOTOS_PAR_PAGE);
      if (photos.length) await grillePhotos(page, photos, MARGE, 60, largeurUtile, Math.min(y - 20, 380) - 60);
    }

    async function grillePhotos(page, photos, x, y, w, h) {
      if (h < 120) return;
      const cols = photos.length === 1 ? 1 : 2, rangs = Math.ceil(photos.length / cols), gap = 10;
      const cw = (w - gap * (cols - 1)) / cols, ch = (h - gap * (rangs - 1)) / rangs;
      for (let i = 0; i < photos.length; i++) {
        const cx = x + (i % cols) * (cw + gap), cy = y + h - (Math.floor(i / cols) + 1) * ch - Math.floor(i / cols) * gap;
        page.drawRectangle({ x: cx, y: cy, width: cw, height: ch, color: CXL });
        try { dessinerImage(page, await imageDe(photos[i]), cx + 4, cy + 4, cw - 8, ch - 8); }
        catch (e) { if (bloquante(e)) throw e; avertissements.push(`Photo illisible : ${photos[i].nom || ''}`); texte(page, 'Photo illisible', cx + 10, cy + ch / 2, 10, false, GRIS); }
      }
    }

    async function pagePhotos(titre, photos) {
      const page = nouvellePage();
      texte(page, tronquer(titre + ' — photos', FB, 13, largeurUtile), MARGE, A4[1] - 60, 13, true);
      await grillePhotos(page, photos, MARGE, 60, largeurUtile, A4[1] - 140);
    }

    function pageIllisible(d, titre, raison) {
      avertissements.push(`${titre} : « ${d.nom || 'document'} » non intégré (${raison}).`);
      const page = nouvellePage();
      page.drawRectangle({ x: MARGE, y: A4[1] / 2 - 60, width: largeurUtile, height: 130, color: CXL });
      texte(page, 'Document à joindre manuellement', MARGE + 20, A4[1] / 2 + 35, 16, true, C);
      texte(page, tronquer(titre, F, 11, largeurUtile - 40), MARGE + 20, A4[1] / 2 + 8, 11);
      texte(page, tronquer(`${M.NOM_TYPE[d.type] || 'Document'} : ${d.nom || ''}`, F, 11, largeurUtile - 40), MARGE + 20, A4[1] / 2 - 12, 11);
      texte(page, tronquer('Raison : ' + raison, F, 9.5, largeurUtile - 40), MARGE + 20, A4[1] / 2 - 36, 9.5, false, GRIS);
    }

    async function ajouterDocument(d, titre) {
      let bytes;
      try { bytes = await o.charger(d); }
      catch (e) { if (bloquante(e)) throw e; return pageIllisible(d, titre, (e && e.message) || 'téléchargement impossible'); }
      if (/^image\//.test(d.mime || '')) {
        try {
          const img = await imageDe(d);
          const paysage = img.width > img.height;
          const page = doc.addPage(paysage ? [A4[1], A4[0]] : A4);
          const { width, height } = page.getSize();
          dessinerImage(page, img, 30, 40, width - 60, height - 70);
        } catch (e) { if (bloquante(e)) throw e; pageIllisible(d, titre, 'image illisible'); }
        return;
      }
      let src = null;
      try {
        src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
        if (src.isEncrypted) src = null;                // protégé : le contenu copié serait illisible
      } catch (_) { src = null; }
      if (src) {
        try {
          const pages = await doc.copyPages(src, src.getPageIndices());
          // liens, formulaires et actions du PDF d'origine retirés : le dossier remis au client ne contient que l'impression
          pages.forEach(pg => { pg.node.delete(PDFName.of('Annots')); pg.node.delete(PDFName.of('AA')); doc.addPage(pg); });
          return;
        } catch (_) { /* structure exotique : on passe par le rendu en images */ }
      }
      if (!o.rasteriser) return pageIllisible(d, titre, 'PDF protégé ou abîmé');
      try {
        const rendus = await o.rasteriser(bytes);
        for (const r of rendus) {
          const img = await doc.embedJpg(r.bytes);
          const page = doc.addPage([r.w, r.h]);
          page.drawImage(img, { x: 0, y: 0, width: r.w, height: r.h });
        }
      } catch (e) { pageIllisible(d, titre, 'PDF protégé ou abîmé'); }
    }

    /* ---------- couverture et sommaire (insérés devant le corps) ---------- */
    const couverture = doc.insertPage(0, A4);
    {
      const page = couverture;
      page.drawRectangle({ x: 0, y: A4[1] - 12, width: A4[0], height: 12, color: C });
      let yHaut = A4[1] - 50;
      if (logo) dessinerImage(page, logo, MARGE, yHaut - 80, 170, 80);
      const coord = [ent.nom, ...(String(ent.adresse || '').split('\n')), ent.tel, ent.email].map(s => (s || '').trim()).filter(Boolean);
      coord.slice(0, 6).forEach((l, i) => {
        const t = tronquer(l, i ? F : FB, i ? 9.5 : 11.5, 240);
        const taille = i ? 9.5 : 11.5;
        texte(page, t, A4[0] - MARGE - (i ? F : FB).widthOfTextAtSize(t, taille), yHaut - 12 - i * 14, taille, !i, i ? GRIS : NOIR);
      });
      let y = A4[1] - 290;
      texte(page, o.titre || 'DOSSIER TECHNIQUE', MARGE, y, 34, true, C); y -= 30;
      for (const l of couper(chantier.objet || 'Dossier des ouvrages exécutés', F, 15, largeurUtile).slice(0, 2)) { texte(page, l, MARGE, y, 15, false, GRIS); y -= 20; }
      y -= 20;
      page.drawRectangle({ x: MARGE, y, width: 80, height: 6, color: C });
      y -= 48;
      for (const l of couper(chantier.nom || 'Chantier', FB, 24, largeurUtile).slice(0, 3)) { texte(page, l, MARGE, y, 24, true); y -= 30; }
      y -= 14;
      const champs = [['Adresse', chantier.adresse], ['Maître d’ouvrage', chantier.client], ['Maître d’œuvre', chantier.moe], ['N° d’affaire', chantier.numero], ['Date', o.date]].filter(c => c[1]);
      for (const [k, v] of champs) {
        texte(page, k.toUpperCase(), MARGE, y, 8.5, true, C);
        const lignes = couper(v, F, 11.5, largeurUtile - 130).slice(0, 2);
        lignes.forEach((l, i) => texte(page, l, MARGE + 130, y - i * 15, 11.5));
        y -= 15 * lignes.length + 9;
      }
      // lots du dossier, en bas
      const lots = plan.sections.map(s => `${s.lot.id}  ${s.lot.nom}`);
      if (lots.length) {
        const h = 26 + Math.min(lots.length, 14) * 15;
        page.drawRectangle({ x: MARGE, y: 60, width: largeurUtile, height: h, color: CXL });
        texte(page, 'LOTS DU DOSSIER', MARGE + 14, 60 + h - 18, 8.5, true, C);
        lots.slice(0, 14).forEach((l, i) => texte(page, tronquer(l, F, 10.5, largeurUtile - 28), MARGE + 14, 60 + h - 36 - i * 15, 10.5));
      }
    }
    pagesSommaire.forEach((lot, n) => {
      const page = doc.insertPage(1 + n, A4);
      let y = A4[1] - 70;
      if (n === 0) { texte(page, 'SOMMAIRE', MARGE, y, 24, true, C); y -= 14; page.drawRectangle({ x: MARGE, y, width: 50, height: 4, color: C }); y -= 36; }
      else y += 10;
      for (const e of lot) {
        const num = e.cle in pageDe ? String(pageDe[e.cle] + debutCorps + 1) : '';
        if (e.niv === 'lot') {
          page.drawRectangle({ x: MARGE, y: y - 7, width: largeurUtile, height: 22, color: CL });
          texte(page, tronquer(e.texte, FB, 11.5, largeurUtile - 60), MARGE + 8, y, 11.5, true);
          texte(page, num, A4[0] - MARGE - 8 - FB.widthOfTextAtSize(num, 11.5), y, 11.5, true);
        } else if (e.niv === 'famille') {
          texte(page, tronquer(e.texte.toUpperCase(), FB, 9, largeurUtile - 20), MARGE + 12, y, 9, true, C);
        } else {
          const t = tronquer(e.texte, F, 10.5, largeurUtile - 90);
          texte(page, t, MARGE + 22, y, 10.5);
          const xFin = MARGE + 22 + F.widthOfTextAtSize(t, 10.5) + 6, xNum = A4[0] - MARGE - 8 - F.widthOfTextAtSize(num, 10.5);
          for (let px = xFin; px < xNum - 6; px += 4) page.drawCircle({ x: px, y: y + 2.5, size: 0.6, color: GRIS });
          texte(page, num, xNum, y, 10.5);
          if (e.sous) texte(page, tronquer(e.sous, F, 8.5, largeurUtile - 90), MARGE + 22, y - 12, 8.5, false, GRIS);
        }
        y -= hauteurEntree(e);
      }
    });

    /* ---------- pied de page sur toutes les pages sauf la couverture ---------- */
    const n = doc.getPageCount();
    const gauche = T([chantier.nom, o.titreCourt || 'Dossier technique'].filter(Boolean).join('  ·  '));
    for (let i = 1; i < n; i++) {
      const page = doc.getPage(i);
      piedDePage(page, tronquer(gauche, F, 8, 300), `Page ${i + 1} / ${n}`);
    }

    function piedDePage(page, g, d) {
      const box = page.getCropBox ? page.getCropBox() : { x: 0, y: 0, ...page.getSize() };
      const rot = ((page.getRotation().angle % 360) + 360) % 360;
      const vw = rot % 180 ? box.height : box.width;          // largeur vue à l'écran
      // passage des coordonnées « vues » (origine en bas à gauche de l'écran) aux coordonnées de la page
      const vers = (vx, vy) => rot === 90 ? [box.x + box.width - vy, box.y + vx]
        : rot === 180 ? [box.x + box.width - vx, box.y + box.height - vy]
        : rot === 270 ? [box.x + vy, box.y + box.height - vx]
        : [box.x + vx, box.y + vy];
      const r = degrees(rot);
      const largD = F.widthOfTextAtSize(d, 8), largG = F.widthOfTextAtSize(g, 8);
      const fond = (vx, larg) => { const [x, y] = vers(vx - 4, 8); page.drawRectangle({ x, y, width: larg + 8, height: 14, color: BLANC, opacity: 0.85, rotate: r }); };
      fond(MARGE / 2, largG); fond(vw - MARGE / 2 - largD, largD);
      let [x, y] = vers(MARGE / 2, 12); page.drawText(g, { x, y, size: 8, font: F, color: GRIS, rotate: r });
      [x, y] = vers(vw - MARGE / 2 - largD, 12); page.drawText(d, { x, y, size: 8, font: F, color: GRIS, rotate: r });
    }

    const bytes = await doc.save({ useObjectStreams: true });
    return { bytes, pages: n, avertissements };
  }

  const api = { genererDossier, paginerSommaire, entreesSommaire, couper };
  root.DOE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
