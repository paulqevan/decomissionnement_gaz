#!/usr/bin/env bash
# Reconstruit tout à partir de donnees/sources/ : GeoPackage QGIS, styles, données de la carte web.
# Prérequis : GDAL pour Python (python3-gdal) et QGIS avec GRASS (qgis_process).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

GPKG=qgis/communes_alsace.gpkg
export PYTHONPATH="/usr/share/qgis/python${PYTHONPATH:+:$PYTHONPATH}"
export QT_QPA_PLATFORM=offscreen   # PyQGIS sans fenêtre

echo "1/7 Communes du 67 et du 68"
python3 scripts/01_communes.py

echo "2/7 Couches réseau et consommations dans $GPKG"
python3 scripts/02_couches_qgis.py

echo "3/7 Styles QGIS"
python3 scripts/03_styles_qgis.py 2>&1 | grep -v -e "^QStandardPaths" -e "^QThreadStorage" || true

echo "4/7 Simplification des géométries pour le web (GRASS, topologie conservée)"
mkdir -p build
qgis_process plugins enable grassprovider >/dev/null 2>&1 || true   # désactivé dans un profil neuf (Docker)
simplifier() {  # couche, seuil en mètres, sortie
  rm -f "build/$3.gpkg"
  qgis_process run grass:v.generalize -- input="$GPKG|layername=$1" method=0 threshold="$2" \
    output="build/$3.gpkg" error="build/$3_erreurs.gpkg" >/dev/null
}
simplifier communes 40 communes_simpl
simplifier reseau_grdf 12 reseau_simpl

echo "5/7 Données de la carte (carte/data/)"
python3 scripts/04_donnees_carte.py

echo "6/7 Territoire de TEA (carte/data/tea.json)"
python3 scripts/05_territoire_tea.py

echo "7/7 Biométhane, réseaux de chaleur et revenus (carte/data/transition.json)"
python3 scripts/06_transition.py

echo "Terminé. Lancer la carte : ./lancer_carte.sh"
