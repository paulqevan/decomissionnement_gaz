"""Produit carte/data/transition.json : ce qui aide à lire un décommissionnement commune par commune.

- biomethane : sites d'injection, dernière année connue (ils ancrent le réseau)
- chaleur    : réseaux de chaleur, zones de développement prioritaire et projets (substitution)
- revenus    : revenu médian par commune (ménages à accompagner)

Les réseaux sont rattachés aux communes par leur position réelle, car le champ « communes » de
la source contient des erreurs. Pour les zones et les projets, sans tracé fiable, c'est ce champ
qui sert. Ce script lit carte/data/communes.json et n'a besoin ni de GDAL ni de QGIS.
"""
import csv
import json
import math
import os
import unicodedata
import zipfile
from collections import defaultdict

from commun import CARTE_DATA, SRC_BIOMETHANE, SRC_CHALEUR, SRC_REVENUS

Q = 10              # quantification des coordonnées : 10 m en Lambert-93, comme les autres couches
TOLERANCE_M = 12    # simplification des tracés, comme le réseau GRDF
DEPARTEMENTS = ("Bas-Rhin", "Haut-Rhin")


def lambert93(lon, lat):
    """WGS84 (degrés) -> Lambert-93 (mètres), formules de l'IGN."""
    n, c, xs, ys, e = 0.7256077650532670, 11754255.426096, 700000, 12655612.049876, 0.0818191910428158
    s = math.sin(math.radians(lat))
    r = c * math.exp(-n * (math.atanh(s) - e * math.atanh(e * s)))
    g = n * math.radians(lon - 3)
    return xs + r * math.sin(g), ys - r * math.cos(g)


def simplifier(pts, tol=TOLERANCE_M):
    """Douglas-Peucker : garde la forme d'une ligne avec moins de points."""
    if len(pts) > 3 and pts[0][:2] == pts[-1][:2]:  # anneau fermé : traité en deux moitiés
        milieu = len(pts) // 2
        return simplifier(pts[:milieu + 1], tol)[:-1] + simplifier(pts[milieu:], tol)
    garde, pile = {0, len(pts) - 1}, [(0, len(pts) - 1)]
    while pile:
        a, b = pile.pop()
        (ax, ay), (bx, by) = pts[a][:2], pts[b][:2]
        long = math.hypot(bx - ax, by - ay) or 1
        loin, dmax = None, tol
        for i in range(a + 1, b):
            d = abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / long
            if d > dmax:
                loin, dmax = i, d
        if loin is not None:
            garde.add(loin)
            pile += [(a, loin), (loin, b)]
    return [pts[i] for i in sorted(garde)]


def encoder(pts):
    """Ligne -> entiers delta-encodés (x0,y0,dx,dy,...), décodés par decode() dans app.js."""
    out, px, py = [], 0, 0
    for p in pts:
        x, y = round(p[0] / Q), round(p[1] / Q)
        if out and x == px and y == py:
            continue
        out += [x - px, y - py]
        px, py = x, y
    return out


class Communes:
    """Contours de la carte, pour retrouver la commune d'un point."""

    def __init__(self):
        with open(os.path.join(CARTE_DATA, "communes.json"), encoding="utf-8") as fh:
            geo = json.load(fh)
        self.anneaux = []
        for code, anneaux in geo["c"].items():
            for delta in anneaux:
                x = y = 0
                pts = []
                for i in range(0, len(delta), 2):
                    x += delta[i]
                    y += delta[i + 1]
                    pts.append((x * geo["q"], y * geo["q"]))
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                self.anneaux.append((code, min(xs), max(xs), min(ys), max(ys), pts))

    def code(self, x, y):
        for code, x0, x1, y0, y1, pts in self.anneaux:
            if x0 <= x <= x1 and y0 <= y <= y1 and self._dedans(x, y, pts):
                return code
        return None

    @staticmethod
    def _dedans(x, y, pts):
        dedans = False
        for (ax, ay), (bx, by) in zip(pts, pts[1:] + pts[:1]):
            if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                dedans = not dedans
        return dedans


def sites_biomethane(communes):
    """Dernière année connue de chaque site d'injection."""
    with open(SRC_BIOMETHANE, encoding="utf-8-sig") as fh:
        lignes = list(csv.DictReader(fh))
    par_site = defaultdict(list)
    for r in lignes:
        par_site[r["id_unique_projet"]].append(r)
    sites = []
    for lignes_site in par_site.values():
        r = max(lignes_site, key=lambda l: int(l["annee"]))
        lat, lon = (float(v) for v in r["geolocalisation"].split(","))
        x, y = lambert93(lon, lat)
        code = r["code_insee_commune"].zfill(5)
        if communes.code(x, y) != code:
            print(f"  attention : {r['nom_de_l_installation']} tombe hors de sa commune {code}")
        nom = r["nom_de_l_installation"].split(" - ", 1)
        sites.append({
            "nom": nom[-1].strip(), "c": code, "type": r["typologie"],
            "date": r["date_de_mise_en_service"][:4], "annee": int(r["annee"]),
            "cap": round(float(r["capacite_d_injection_au_31_12_en_nm3_h"])),
            "mwh": round(float(r["quantite_annuelle_injectee_en_mwh"])), "x": round(x), "y": round(y),
        })
    return sorted(sites, key=lambda s: -s["mwh"])


def sans_accents(texte):
    texte = unicodedata.normalize("NFD", texte).encode("ascii", "ignore").decode()
    return texte.lower().replace("-", " ").replace("'", " ").strip()


def codes_par_nom(noms, index):
    """Champ « communes » de la source (noms séparés par des virgules) -> codes INSEE."""
    codes = []
    for nom in (noms or "").split(","):
        code = index.get(sans_accents(nom))
        if code:
            codes.append(code)
        elif nom.strip():
            print(f"  attention : commune inconnue « {nom.strip()} »")
    return codes


def lignes_de(geometrie):
    if geometrie["type"] == "MultiLineString":
        return geometrie["coordinates"]
    if geometrie["type"] == "MultiPolygon":
        return [anneau for poly in geometrie["coordinates"] for anneau in poly]
    return []


def en_alsace(entite):
    return entite["properties"].get("departement") in DEPARTEMENTS


def reseaux_de_chaleur(communes, index):
    """Réseaux, zones de développement prioritaire et projets de l'Alsace."""
    with zipfile.ZipFile(SRC_CHALEUR) as archive:
        def lire(nom):
            with archive.open(nom + ".geojson") as fh:
                return [f for f in json.load(fh)["features"] if en_alsace(f)]
        traces, points = lire("reseaux_de_chaleur"), lire("reseaux_de_chaleur_sans_traces")
        zones, projets = lire("pdp"), lire("zones_et_reseaux_en_construction")

    reseaux = []
    for f in traces + points:
        p, g = f["properties"], f["geometry"]
        production = p.get("production_totale_MWh") or 0
        gaz = p.get("prod_MWh_gaz_naturel")
        r = {
            "nom": p["nom_reseau"], "gest": p.get("Gestionnaire"), "km": p.get("longueur_reseau"),
            "pdl": p.get("nb_pdl"), "enr": p.get("Taux EnR&R"), "annee": p.get("annee_creation"),
            "gaz": round(100 * gaz / production) if production and gaz is not None else None,
            "liv": p.get("livraisons_totale_MWh"), "prix": p.get("PM"), "classe": bool(p.get("reseaux classes")),
        }
        if g["type"] == "Point":
            x, y = g["coordinates"][:2]
            r["pt"] = [round(x), round(y)]
            ici = {communes.code(x, y)}
        else:
            lignes = [simplifier(l) for l in lignes_de(g)]
            r["l"] = [e for e in (encoder(l) for l in lignes) if len(e) >= 4]
            ici = {communes.code(*pt[:2]) for l in lignes for pt in l}
        ici.discard(None)
        r["c"] = sorted(ici) or codes_par_nom(p.get("communes"), index)
        declares = set(codes_par_nom(p.get("communes"), index))
        if declares and not declares & ici:
            print(f"  note : « {r['nom']} » déclaré à {p.get('communes')}, situé en {sorted(ici)}")
        reseaux.append(r)

    zones_out = [{"c": codes_par_nom(f["properties"].get("communes"), index),
                  "l": [encoder(simplifier(a)) for a in lignes_de(f["geometry"])]} for f in zones]
    projets_out = [{"c": codes_par_nom(f["properties"].get("communes"), index),
                    "gest": (f["properties"].get("gestionnaire") or "").strip(),
                    "date": f["properties"].get("mise_en_service"),
                    "zone": f["geometry"]["type"] == "MultiPolygon",
                    "l": [encoder(simplifier(a)) for a in lignes_de(f["geometry"])]} for f in projets]
    return {"q": Q, "reseaux": reseaux, "zones": zones_out, "projets": projets_out}


def revenus(codes):
    """Code INSEE -> [revenu médian, 1er décile, ménages fiscaux] ; médiane absente si secret statistique."""
    def nombre(texte):
        return round(float(texte)) if texte else None
    out = {}
    with open(SRC_REVENUS, encoding="utf-8-sig", newline="") as fh:
        lecteur = csv.DictReader(fh, delimiter=";")
        decile = next(c for c in lecteur.fieldnames if c.startswith("[DISP] 1") and "décile" in c)
        for r in lecteur:
            c = r["Code géographique"]
            if c in codes and r["[DISP] Médiane (€)"]:
                out[c] = [nombre(r["[DISP] Médiane (€)"]), nombre(r[decile]), nombre(r["[DISP] Nbre de ménages fiscaux"])]
    return out


if __name__ == "__main__":
    with open(os.path.join(CARTE_DATA, "conso.json"), encoding="utf-8") as fh:
        meta = json.load(fh)["meta"]
    index = {sans_accents(m[0]): c for c, m in meta.items()}
    communes = Communes()
    sites = sites_biomethane(communes)
    chaleur = reseaux_de_chaleur(communes, index)
    rev = revenus(set(meta))
    with open(os.path.join(CARTE_DATA, "transition.json"), "w", encoding="utf-8") as fh:
        json.dump({"biomethane": sites, "chaleur": chaleur, "revenus": rev}, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"sites de biométhane : {len(sites)} | réseaux de chaleur : {len(chaleur['reseaux'])} | "
          f"zones : {len(chaleur['zones'])} | projets : {len(chaleur['projets'])} | communes avec revenu : {len(rev)}")
