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
  00_telecharger.py    rafraîchit les données ouvertes complémentaires (à la main, accès Internet)
  commun.py            chemins, années, lecture et correction des sources
  01_communes.py       communes du 67/68 → qgis/communes_alsace.gpkg
  02_couches_qgis.py   réseau GRDF + consommations → couches du GeoPackage
  03_styles_qgis.py    styles QGIS par défaut + qgis/reseau_et_conso_gaz.qlr
  04_donnees_carte.py  données de la carte web → carte/data/*.json
  05_territoire_tea.py territoire de TEA → carte/data/tea.json (openpyxl, ni GDAL ni QGIS)
  06_transition.py     biométhane, chaleur, revenus → carte/data/transition.json (Python seul)
  07_electricite.py    électricité, logements, EPCI → carte/data/electricite.json, epci.json (Python seul)
  08_criteres_cre.py   critères de la CRE → carte/data/cre.json, natran.json, reseau_autres.json (Python seul)
qgis/              GeoPackage et fichier de couches générés (glisser le .qlr dans QGIS)
carte/             la carte web : index.html, style.css, app.js, data/
build/             fichiers intermédiaires (géométries simplifiées), supprimable
Dockerfile, compose.yaml   environnement Docker (carte + construction)
```

## Sources

| Fichier | Producteur |
|---|---|
| `consommation-annuelle-gaz-par-commune.csv` | Agence ORE, consommation annuelle de gaz par commune (67/68) |
| `consommation-annuelle-d-electricite-par-commune.csv` | Agence ORE, consommation annuelle d'électricité par commune (67/68), avec des données sur les logements |
| `cartographie-du-reseau-grdf-en-service.csv` | GRDF, réseau en service |
| `communes-5m.geojson.gz` | Contours des communes (IGN Admin Express, généralisation 1:5M) |
| `Communes_TEA_INSEE.xlsx` | TEA, liste des 390 communes membres |
| `capacite-et-quantite-dinjection-de-biomethane-2.csv` | Sites d'injection de biométhane : capacité et volumes par an |
| `opendata-fcu.zip` | France Chaleur Urbaine : réseaux de chaleur, zones de développement prioritaire, projets |
| `revenu-des-francais-a-la-commune-*.csv` | Revenus par commune, 2021 |
| `grille_densite_7_niveaux_2024.xlsx` | INSEE, grille communale de densité à 7 niveaux (segmentation de la CRE) |
| `RP2022_logemtzc.zip` | INSEE, fichier détail des logements du recensement 2022, zone C (87 Mo, non versionné) |
| `ore-infrastructures-gaz-alsace.jsonl.gz` | Agence ORE, tracés GRDF, R-GDS et Vialis avec niveau de pression (non versionné) |
| `natran-trace-reseau-alsace.geojson` | NaTran via ODRÉ, réseau de transport à 250 m près |
| `zonages-acces-biomethane-alsace.geojson` | ODRÉ, zonages de raccordement du biométhane et projets en attente |
| `sites-rebours-natran.csv` | NaTran via ODRÉ, sites de rebours |
| `sites-injection-biomethane-alsace.csv` | GRDF, registre des sites d'injection |
| `gaz-renouvelable-prospectif-epci.csv` | NaTran via ODRÉ, projets de biométhane inscrits au registre par EPCI |
| `industries-gaz-non-substituable.csv` | Base SIRENE (API Recherche d'entreprises) : NAF 20, 23, 24, 20 salariés et plus |

Les fichiers ajoutés pour les critères de la CRE se rafraîchissent avec `python3 scripts/00_telecharger.py`
(ou `… 00_telecharger.py logements reseau_ore` pour les deux fichiers non versionnés). Sans eux,
`08_criteres_cre.py` reprend les logements et le réseau déjà présents dans `carte/data/cre.json`.

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

Le menu « Territoire » limite à TEA ou à un EPCI les chiffres clés, la carte, le réseau affiché,
la recherche et les classements. L'échelle « EPCI » colore la carte et classe les EPCI, à partir
de la fonction `agreg` de chaque indicateur ; cliquer sur un EPCI l'ouvre comme territoire. Après une mise à jour de `Communes_TEA_INSEE.xlsx`, seul
`python3 scripts/05_territoire_tea.py` est à relancer (avec `pip install openpyxl` hors Docker).
Le total TEA est à périmètre constant, comme celui de l'Alsace.

## Organisation de l'interface

- **Thèmes** (`THEMES` dans `carte/app.js`) : ils regroupent les indicateurs et règlent les couches
  affichées par défaut, pour ne pas tout superposer. La légende des couches est dans le menu Couches.
- **Panneau** : l'essentiel d'une commune ou d'un territoire.
- **Fiche** : le bouton du panneau ouvre la fiche complète, prévue pour tenir sur une page A4.
  Elle s'imprime toujours en mode jour (`imprimerFiche()`, règles `@media print` de `style.css`).

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

Le thème **Synthèse** résume ces lectures en un profil par commune (`calculerProfil()`) : le premier
qui s'applique parmi réseau ancré, ménages à accompagner, substitution possible, réseau peu sollicité
et à suivre. La partie « Méthode et limites » de la carte détaille les règles.

**Gaz et électricité** : le thème Alternatives compare les consommations résidentielles. Un report
est signalé quand le gaz recule d'au moins 5 % et l'électricité progresse d'au moins 1 %, pour au
moins 1 GWh de gaz par an. C'est un indice, pas une preuve. `07_electricite.py` écarte les années où
le nombre de sites d'un gestionnaire saute d'une année à l'autre (ruptures de série).

Après une mise à jour de ces sources, relancer `python3 scripts/06_transition.py` et
`python3 scripts/07_electricite.py`. Ils lisent `carte/data/communes.json` et `conso.json`, et
passent donc après `04_donnees_carte.py`. Le premier signale les sites hors de leur commune et les
noms de communes inconnus.

## Critères de la CRE et grille de ciblage

La CRE propose, dans l'annexe « Analyses locales » de son rapport 2026 sur l'avenir des
infrastructures gazières, six critères pour repérer les zones propices à un repli organisé du gaz.
La carte les reprend ainsi :

| Critère CRE | Dans la carte | Source |
|---|---|---|
| 1. Biométhane en service ou en projet | sites d'injection (y compris R-GDS, Gaz de Barr, Caléo, NaTran via le registre) et rebours ; projets par zonage et par EPCI (affichés, non comptés) | GRDF, ODRÉ |
| 2. Industrie non substituable | gaz des NAF 20, 23, 24 ≥ 1 GWh par an (`INDUSTRIE_MIN`) ; établissements SIRENE | Agence ORE, SIRENE |
| 3. Réseau de chaleur au gaz | réseaux dont le mix comprend du gaz | France Chaleur Urbaine |
| 4. Position sur le réseau | longueur par gestionnaire, pression (Vialis), densité et réseau par client tous gestionnaires | Agence ORE |
| 5. Énergie de substitution | chaleur, logements au gaz par type (maison, collectif, chaudière d'immeuble), propriétaires | FCU, INSEE |
| 6. Équilibre économique | non publié : à demander au concessionnaire | — |

- Thème **Usages durables** : nombre d'usages des critères 1 à 3 par commune (0 à 3), et grille de densité.
- Thème **Ciblage** : la grille. Une commune avec un usage durable (ou un site raccordé au transport)
  est écartée ; les autres comptent un point par critère favorable coché (`CRITERES` dans `app.js`,
  seuils en tête de fichier). Le bouton du classement exporte la liste complète en CSV, avec tous les
  critères, pour n'importe quel indicateur.
- La **fiche** de chaque commune contient la grille de la CRE, critère par critère, avec ce qui reste
  à demander au gestionnaire.

## Couleurs

- **Rouge et vert sont réservés aux évolutions** : baisse en rouge, hausse en vert, sur la carte,
  les chiffres et le classement (`evo()` dans `app.js`, jetons `--baisse`, `--hausse`, `--d*`).
  Flèche et signe accompagnent toujours la couleur. Le vert émeraude est choisi pour rester
  distinct du rouge pour les personnes daltoniennes.
- **Bleu** pour les grandeurs sans hausse ni baisse (jetons `--q1` à `--q5`).
- **Profils** : jetons `--p-*`, validés pour rester distincts deux à deux, y compris pour les personnes daltoniennes.
- **Densité INSEE** : `--dens1` à `--dens7`, bleu pour l'urbain, ambre pour le rural. **Grille de ciblage** : échelle
  bleue `--q*`, gris `--ecarte` pour les communes écartées.
- **Couches CRE** : NaTran en orange brique (`--natran`), réseaux R-GDS et Vialis en violet (`--net2`), industries en
  triangles violets (`--industrie`), rebours en triangle ambre, zonages biométhane en tirets ambre.
- **Secteurs** en bleu, ambre, violet et gris (`--s-*`), sans rouge ni vert.
- **Couches** : magenta pour la chaleur (`--chaleur`), losanges ambre pour le biométhane (`--biomethane`).
- **Revenus** : même échelle bleue, inversée pour que les communes modestes ressortent.

## Ajouter des données sur la carte

### Un nouvel indicateur (couleur des communes)

1. Dans `scripts/04_donnees_carte.py`, ajouter la valeur par commune au dictionnaire
   `communes[c]` (ou à `meta`) si elle n'y est pas déjà.
2. Dans `carte/app.js`, ajouter une entrée à `INDICATEURS` : libellé, unité, seuils,
   couleurs (jetons CSS de `style.css`, une de plus que de seuils), la fonction
   `valeur(c)`, `agreg(e)` pour l'échelle EPCI, les `bornes` de la légende, la phrase
   `lecture()` et le `classement`. Ajouter ensuite son identifiant à un thème de `THEMES`.

### Une nouvelle couche linéaire (réseau, canalisations, routes…)

1. Déposer le fichier source dans `donnees/sources/` et le charger dans le GeoPackage en
   Lambert-93 (nouveau script `scripts/0x_*.py` ou ajout dans `02_couches_qgis.py`).
2. Dans `construire.sh`, ajouter une ligne `simplifier <couche> <seuil_m> <sortie>`.
3. En bas de `scripts/04_donnees_carte.py`, appeler
   `exporter_lignes(os.path.join(BUILD, "<sortie>.gpkg"), "<id>.json")`.
4. Dans `carte/app.js`, déclarer la couche dans `COUCHES`
   (`{ id, label, fichier: "data/<id>.json", couleur: "--jeton", epaisseur, actif, cles }`),
   l'ajouter aux thèmes concernés et ajouter son jeton de couleur dans `style.css` (thèmes
   clair et sombre). La case à cocher et la légende suivent automatiquement.

### Une autre énergie ou d'autres années

Les années viennent de `ANNEES` dans `scripts/commun.py`, et les périodes comparées de
`P1`/`P2` dans `04_donnees_carte.py` et `carte/app.js`.
