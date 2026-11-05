"""Chemins du projet et lecture des sources, partagés par les scripts de construction."""
import csv
import os

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(RACINE, "donnees", "sources")
BUILD = os.path.join(RACINE, "build")          # fichiers intermédiaires, régénérables
GPKG = os.path.join(RACINE, "qgis", "communes_alsace.gpkg")
QLR = os.path.join(RACINE, "qgis", "reseau_et_conso_gaz.qlr")
CARTE_DATA = os.path.join(RACINE, "carte", "data")

SRC_COMMUNES = os.path.join(SOURCES, "communes-5m.geojson.gz")
SRC_RESEAU = os.path.join(SOURCES, "cartographie-du-reseau-grdf-en-service.csv")
SRC_CONSO = os.path.join(SOURCES, "consommation-annuelle-d-electricite-et-gaz-par-commune.csv")

DEPARTEMENTS = ("67", "68")
ANNEES = list(range(2019, 2026))

csv.field_size_limit(10**9)


def lire_conso():
    """Lignes du fichier de consommation, normalisées et corrigées.

    Renvoie des dicts : commune, annee, operateur, secteur (grand secteur ORE),
    mwh, sites, epci, nom_epci, secret (ligne masquée par le secret statistique).
    """
    with open(SRC_CONSO, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r["FILIERE"] != "Gaz":
                continue
            annee, op = int(r["annee"]), r["OPERATEUR"]
            mwh = float(r["Conso totale (MWh)"] or 0)
            if op == "Caléo" and annee in (2023, 2024):  # publiées en GWh au lieu de MWh
                mwh *= 1000
            yield {
                "commune": r["Code Commune"].zfill(5), "annee": annee, "operateur": op,
                "secteur": r["CODE GRAND SECTEUR"], "mwh": mwh,
                "sites": int(float(r["Nb sites"] or 0)),
                "epci": r["Code EPCI"], "nom_epci": r["Nom EPCI"],
                "secret": int(float(r["nombre_de_mailles_secretisees"] or 0)) > 0,
            }


def lire_reseau():
    """Tronçons du réseau GRDF : dicts avec geojson (WGS84), code_insee, nom, departement, etat."""
    with open(SRC_RESEAU, encoding="utf-8") as fh:
        for r in csv.DictReader(fh, delimiter=";"):
            yield {
                "geojson": r["geo_shape"], "code_insee": r["code_insee_administratif"].zfill(5),
                "nom": r["nom_de_commune_administratif"], "departement": r["departement_administratif"],
                "etat": r["etat_serv"],
            }
