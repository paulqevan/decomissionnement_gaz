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
  05_territoire_tea.py territoire de TEA → carte/data/tea.json (openpyxl, ni GDAL ni QGIS)
  06_transition.py     biométhane, chaleur, revenus → carte/data/transition.json (Python seul)
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
| `Communes_TEA_INSEE.xlsx` | TEA, liste des 390 communes membres |
| `capacite-et-quantite-dinjection-de-biomethane-2.csv` | Sites d'injection de biométhane : capacité et volumes par an |
| `opendata-fcu.zip` | France Chaleur Urbaine : réseaux de chaleur, zones de développement prioritaire, projets |
| `revenu-des-francais-a-la-commune-*.csv` | Revenus par commune, 2021 |

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

## Territoire de TEA

Le filtre « Territoire » limite à TEA les chiffres clés, la carte, le réseau affiché, la
recherche et le classement. Après une mise à jour de `Communes_TEA_INSEE.xlsx`, seul
`python3 scripts/05_territoire_tea.py` est à relancer (avec `pip install openpyxl` hors Docker).
Le total TEA est à périmètre constant, comme celui de l'Alsace.

## Lire un décommissionnement

Chaque fiche commune répond à trois questions dans le bloc « Pour décider ». Les seuils sont des
constantes en haut de `carte/app.js`. Ce sont des repères de lecture, pas des critères réglementaires.

- **Ancrage** : un site de biométhane qui injecte plus que sa commune ne consomme a besoin du
  réseau pour évacuer son gaz (losange plein sur la carte, en tête de la liste des sites). Un
  réseau de chaleur produisant au moins 50 % de sa chaleur au gaz ancre aussi le réseau.
- **Substitution** : réseaux de chaleur produisant moins de 50 % au gaz et desservant au moins
  3 clients, zones de développement prioritaire et projets. L'indicateur « Réseau de chaleur »
  affiche le gaz des logements et du tertiaire de ces communes : c'est un maximum.
- **Accompagnement** : revenu médian de la commune, repère à 23 000 € par an.

Après une mise à jour de ces sources, relancer `python3 scripts/06_transition.py`. Le script
lit `carte/data/communes.json` et `conso.json`, il passe donc après `04_donnees_carte.py`, et
signale les sites hors de leur commune et les noms de communes inconnus.

## Couleurs

- **Rouge et vert sont réservés aux évolutions** : baisse en rouge, hausse en vert, sur la carte,
  les chiffres et le classement (`evo()` dans `app.js`, jetons `--baisse`, `--hausse`, `--d*`).
  Flèche et signe accompagnent toujours la couleur. Le vert émeraude est choisi pour rester
  distinct du rouge pour les personnes daltoniennes.
- **Bleu** pour les grandeurs sans hausse ni baisse (jetons `--q1` à `--q5`).
- **Secteurs** en bleu, ambre, violet et gris (`--s-*`), sans rouge ni vert.
- **Couches** : magenta pour la chaleur (`--chaleur`), losanges ambre pour le biométhane (`--biomethane`).
- **Revenus** : même échelle bleue, inversée pour que les communes modestes ressortent.

## Ajouter des données sur la carte

### Un nouvel indicateur (couleur des communes)

1. Dans `scripts/04_donnees_carte.py`, ajouter la valeur par commune au dictionnaire
   `communes[c]` (ou à `meta`) si elle n'y est pas déjà.
2. Dans `carte/app.js`, ajouter une entrée à `INDICATEURS` : libellé, unité, seuils,
   couleurs (jetons CSS de `style.css`, une de plus que de seuils), la fonction
   `valeur(c)`, les `bornes` de la légende, la phrase `lecture()` et le `classement`.
   Le bouton « Afficher » est créé automatiquement.

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
