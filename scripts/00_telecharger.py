"""Télécharge les données ouvertes complémentaires dans donnees/sources/ (Python seul, accès Internet).

À lancer à la main pour rafraîchir les sources ; construire.sh ne l'appelle pas, pour que la
construction reste reproductible hors ligne. Usage : python3 scripts/00_telecharger.py [nom ...]
Sans argument, tout est téléchargé. Les sources déjà présentes sont écrasées.

Chaque entrée de SOURCES : nom -> (fichier de sortie, fonction de téléchargement).
"""
import csv
import gzip
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request

from commun import SOURCES

AGENT = {"User-Agent": "atlas-gaz-alsace/1.0"}
ODRE = "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets"
GRDF = "https://opendata.grdf.fr/api/explore/v2.1/catalog/datasets"
ORE = "https://opendata.agenceore.fr/data-fair/api/v1/datasets/infrastructures-reseau-gaz/lines"
INSEE = "https://www.insee.fr/fr/statistiques/fichier"
ENTREPRISES = "https://recherche-entreprises.api.gouv.fr/search"
ALSACE = '("67","68")'

# Industries dont le gaz est difficilement substituable selon la CRE (annexe « Analyses locales »,
# 2026, d'après la mission IGEDD 2025) : chimie (NAF 20), verre et autres produits minéraux non
# métalliques (NAF 23), métallurgie (NAF 24).
NAF_NON_SUBSTITUABLE = {
    "20": "11Z 12Z 13A 13B 14Z 15Z 16Z 17Z 20Z 30Z 41Z 42Z 51Z 52Z 53Z 59Z 60Z",
    "23": "11Z 12Z 13Z 14Z 19Z 20Z 31Z 32Z 41Z 42Z 43Z 44Z 49Z 51Z 52Z 61Z 62Z 63Z 64Z 65Z 69Z 70Z 91Z 99Z",
    "24": "10Z 20Z 31Z 32Z 33Z 34Z 41Z 42Z 43Z 44Z 45Z 46Z 51Z 52Z 53Z 54Z",
}
EFFECTIF_MIN = "12,21,22,31,32,41,42,51,52,53"   # tranches INSEE : 20 salariés et plus


def lire(url, essais=4):
    for i in range(essais):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=120) as r:
                return r.read()
        except Exception as e:  # réseau capricieux : on réessaie avant d'abandonner
            if i == essais - 1:
                raise
            print(f"  nouvel essai ({e})")
            time.sleep(3 * (i + 1))


def ecrire(nom, contenu):
    with open(os.path.join(SOURCES, nom), "wb") as fh:
        fh.write(contenu)


def opendatasoft(base, jeu, fmt, where, select=None):
    q = {"where": where, "delimiter": ";"}
    if select:
        q["select"] = select
    return lire(f"{base}/{jeu}/exports/{fmt}?" + urllib.parse.urlencode(q))


def reseau_ore(sortie):
    """Tracés des canalisations de distribution, tous gestionnaires publiés (GRDF, R-GDS, Vialis)."""
    params = {"qs": "code_departement:(67 OR 68)", "size": 10000,
              "select": "geometry,nom_grd,code_insee,niveau_de_pression"}
    url, n, total = ORE + "?" + urllib.parse.urlencode(params), 0, "?"
    with gzip.open(os.path.join(SOURCES, sortie), "wt", encoding="utf-8") as fh:
        while url:
            page = json.loads(lire(url))
            for r in page["results"]:
                fh.write(json.dumps({k: r.get(k) for k in ("nom_grd", "code_insee", "niveau_de_pression", "geometry")}, ensure_ascii=False) + "\n")
            n += len(page["results"])
            total = page.get("total", total)
            print(f"  {n} / {total} tronçons")
            url = page.get("next") if page["results"] else None


def industries(sortie):
    """Établissements actifs de 20 salariés et plus (unité légale) dont l'activité est en NAF 20, 23 ou 24."""
    codes = [f"{div}.{c}" for div, liste in NAF_NON_SUBSTITUABLE.items() for c in liste.split()]
    vus, lignes = set(), []
    for i in range(0, len(codes), 20):   # l'API limite la longueur de la liste de codes
        page, pages = 1, 1
        while page <= pages:
            q = {"activite_principale": ",".join(codes[i:i + 20]), "departement": "67,68", "etat_administratif": "A",
                 "tranche_effectif_salarie": EFFECTIF_MIN, "per_page": 25, "page": page}
            d = json.loads(lire(ENTREPRISES + "?" + urllib.parse.urlencode(q)))
            pages = d.get("total_pages", 1)
            for u in d["results"]:
                for e in u.get("matching_etablissements", []):
                    naf = (e.get("activite_principale") or "")[:2]
                    if e.get("etat_administratif") != "A" or naf not in NAF_NON_SUBSTITUABLE or e["siret"] in vus:
                        continue
                    if (e.get("commune") or "")[:2] not in ("67", "68"):
                        continue
                    vus.add(e["siret"])
                    lignes.append({"siret": e["siret"], "nom": u.get("nom_raison_sociale") or u.get("nom_complet"),
                                   "naf": e.get("activite_principale"), "commune": e.get("commune"),
                                   "effectif_unite_legale": u.get("tranche_effectif_salarie"),
                                   "latitude": e.get("latitude"), "longitude": e.get("longitude")})
            page += 1
            time.sleep(0.2)   # 7 requêtes par seconde au plus
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(lignes[0]), delimiter=";")
    w.writeheader(); w.writerows(lignes)
    ecrire(sortie, buf.getvalue().encode("utf-8"))
    print(f"  {len(lignes)} établissements")


SOURCES_OUVERTES = {
    "densite": ("grille_densite_7_niveaux_2024.xlsx", lambda f: ecrire(f, lire(f"{INSEE}/6439600/grille_densite_7_niveaux_2024.xlsx"))),
    # 87 Mo, non versionné : fichier détail des logements du recensement 2022, zone C (Grand Est, Pays de la Loire, Bretagne)
    "logements": ("RP2022_logemtzc.zip", lambda f: ecrire(f, lire(f"{INSEE}/8647099/RP2022_logemtzc.zip"))),
    "reseau_ore": ("ore-infrastructures-gaz-alsace.jsonl.gz", reseau_ore),
    "natran": ("natran-trace-reseau-alsace.geojson", lambda f: ecrire(f, opendatasoft(ODRE, "trace-du-reseau-grt-250", "geojson", 'departement in ("Bas-Rhin","Haut-Rhin")'))),
    "zonages": ("zonages-acces-biomethane-alsace.geojson", lambda f: ecrire(f, opendatasoft(ODRE, "cartographie-acces-biomethane", "geojson", f"code_departement in {ALSACE}"))),
    "rebours": ("sites-rebours-natran.csv", lambda f: ecrire(f, opendatasoft(ODRE, "sites-rebours-grtgaz", "csv", f"code_departement in {ALSACE}"))),
    "registre": ("sites-injection-biomethane-alsace.csv", lambda f: ecrire(f, opendatasoft(GRDF, "les-sites-dinjection-de-biomethane-en-france", "csv", f"code_dep in {ALSACE}"))),
    "prospectif": ("gaz-renouvelable-prospectif-epci.csv", lambda f: ecrire(f, opendatasoft(ODRE, "prod-igr-prosp-epci-grtgaz", "csv", f"code_departement in {ALSACE}", "epci_code,epci_name,nb_id_projet,export"))),
    "industries": ("industries-gaz-non-substituable.csv", industries),
}

if __name__ == "__main__":
    for nom in sys.argv[1:] or SOURCES_OUVERTES:
        fichier, telecharger = SOURCES_OUVERTES[nom]
        print(f"{nom} -> donnees/sources/{fichier}")
        telecharger(fichier)
