# Atlas du gaz en Alsace

Carte interactive des consommations de gaz par commune et par secteur (2019-2025), avec le
réseau GRDF, pour éclairer les élus sur le décommissionnement du réseau de gaz.
Un GeoPackage QGIS avec les mêmes couches est aussi produit.

## Utilisation

```bash
./lancer_carte.sh          # sert carte/ sur http://localhost:8765 (ou le port libre suivant)
./construire.sh            # reconstruit tout depuis donnees/sources/ (~30 s)
```

Prérequis : Python 3 avec GDAL (`python3-gdal`), et QGIS avec GRASS (`qgis_process`) pour la
construction. Le lancement de la carte ne demande que Python.

### Avec Docker (Windows, macOS ou Linux)

Seul Docker est nécessaire, depuis un terminal ouvert dans le dossier du projet :

```bash
docker compose up                     # carte sur http://localhost:8765 (Ctrl+C pour arrêter)
docker compose run --rm construire    # reconstruit tout depuis donnees/sources/ (~40 s)
```

- Autre port : `PORT=8080 docker compose up` (PowerShell : `$env:PORT=8080; docker compose up`).
- La première reconstruction télécharge et prépare l'image QGIS (quelques minutes, ~2 Go).
- `communes-5m.geojson.gz` n'est pas versionné (86 Mo) : le déposer dans `donnees/sources/`
  avant de reconstruire. La carte, elle, fonctionne sans.
- Le GeoPackage et le `.qlr` produits dans `qgis/` s'ouvrent directement dans QGIS sous Windows.
- `.gitattributes` force les fins de ligne Linux sur les scripts : sans lui, un clone sous
  Windows casserait `construire.sh` dans le conteneur.

## Organisation

```
donnees/sources/   fichiers bruts téléchargés, jamais modifiés
scripts/           chaîne de construction, lancée dans l'ordre par construire.sh
  commun.py            chemins, années, lecture et correction des sources
  01_communes.py       communes du 67/68 → qgis/communes_alsace.gpkg
  02_couches_qgis.py   réseau GRDF + consommations → couches du GeoPackage
  03_styles_qgis.py    styles QGIS par défaut + qgis/reseau_et_conso_gaz.qlr
  04_donnees_carte.py  données de la carte web → carte/data/*.json
qgis/              GeoPackage et fichier de couches générés (glisser le .qlr dans QGIS)
carte/             la carte web : index.html, style.css, app.js, data/
build/             fichiers intermédiaires (géométries simplifiées), supprimable
Dockerfile, compose.yaml   environnement Docker (carte + construction)
```

## Sources

| Fichier | Producteur |
|---|---|
| `consommation-annuelle-d-electricite-et-gaz-par-commune.csv` | Agence ORE, consommation annuelle par commune (filtre gaz, 67/68) |
| `cartographie-du-reseau-grdf-en-service.csv` | GRDF, réseau en service |
| `communes-5m.geojson.gz` | Contours des communes (IGN Admin Express, généralisation 1:5M) |

Correction appliquée dans `scripts/commun.py` : les volumes Caléo 2023 et 2024 sont publiés en
GWh au lieu de MWh et sont multipliés par 1 000.

## Indicateurs du réseau

- **Densité énergétique** (MWh/m) : gaz GRDF de l'année ÷ longueur du réseau GRDF de la commune.
- **Réseau par client** (m) : longueur du réseau GRDF ÷ points de livraison GRDF de l'année.

Champs QGIS : `densite_mwh_m_<année>` et `m_reseau_par_client_<année>` (couche
`communes_conso_gaz`). Limites : seul le réseau GRDF est connu, et sa longueur est celle du
tracé actuel, appliquée à toutes les années. Les années où le secret statistique masque une
partie des données sont signalées sur la carte. Pour couvrir les autres gestionnaires (R-GDS,
Vialis…), voir le jeu « Infrastructures de réseau de gaz » de l'Agence ORE sur data.gouv.fr.

## Ajouter des données sur la carte

### Un nouvel indicateur (couleur des communes)

1. Dans `scripts/04_donnees_carte.py`, ajouter la valeur par commune au dictionnaire
   `communes[c]` (ou à `meta`) si elle n'y est pas déjà.
2. Dans `carte/app.js`, ajouter une entrée à `INDICATEURS` : libellé, unité, seuils,
   couleurs (jetons CSS de `style.css`, une de plus que de seuils) et la fonction
   `valeur(c)`. Le bouton « Afficher » est créé automatiquement.

### Une nouvelle couche linéaire (réseau, canalisations, routes…)

1. Déposer le fichier source dans `donnees/sources/` et le charger dans le GeoPackage en
   Lambert-93 (nouveau script `scripts/0x_*.py` ou ajout dans `02_couches_qgis.py`).
2. Dans `construire.sh`, ajouter une ligne `simplifier <couche> <seuil_m> <sortie>`.
3. En bas de `scripts/04_donnees_carte.py`, appeler
   `exporter_lignes(os.path.join(BUILD, "<sortie>.gpkg"), "<id>.json")`.
4. Dans `carte/app.js`, déclarer la couche dans `COUCHES`
   (`{ id, label, fichier: "data/<id>.json", couleur: "--jeton", epaisseur, actif }`)
   et ajouter son jeton de couleur dans `style.css` (thèmes clair et sombre). La case à
   cocher et la légende suivent automatiquement.

### Une autre énergie ou d'autres années

Les années viennent de `ANNEES` dans `scripts/commun.py`, et les périodes comparées de
`P1`/`P2` dans `04_donnees_carte.py`. Pour l'électricité, `lire_conso()` filtre aujourd'hui
`FILIERE == "Gaz"` : il faut remplacer le fichier source par un export qui inclut
l'électricité et faire de ce filtre un paramètre.
