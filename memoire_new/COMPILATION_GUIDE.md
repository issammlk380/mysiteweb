# Guide de Compilation - Mémoire de Fin d'Études

## Structure du Projet

```
memoire_new/
├── main.tex                    # Fichier principal LaTeX
├── references.bib              # Bibliographie BibLaTeX
├── COMPILATION_GUIDE.md        # Ce fichier
├── logo_ibn_tofail.png         # Logo université (à copier depuis ../memoire/)
├── logo_sews.png               # Logo SEWS (à copier depuis ../memoire/)
└── chapters/
    ├── 00_cover.tex            # Page de couverture
    ├── 01_dedication.tex       # Dédicace
    ├── 02_acknowledgements.tex # Remerciements
    ├── 03_abstract_fr.tex      # Résumé français
    ├── 04_abstract_en.tex      # Abstract anglais
    ├── 05_acronyms.tex         # Liste des acronymes
    ├── 06_introduction.tex     # Introduction générale
    ├── 07_chapter1_context.tex # Chapitre 1: Contexte et État de l'Art
    ├── 08_chapter2_analysis.tex # Chapitre 2: Présentation Entreprise
    ├── 09_chapter3_requirements.tex # Chapitre 3: Analyse Besoins
    ├── 10_system_design.tex    # Chapitre 4: Conception Système
    ├── 11_hardware_architecture.tex # Chapitre 5: Architecture Matérielle
    ├── 12_software_architecture.tex # Chapitre 6: Architecture Logicielle
    ├── 13_database_design.tex  # Chapitre 7: Conception Base Données
    ├── 14_communication_architecture.tex # Chapitre 8: Communication
    ├── 15_esp32_implementation.tex # Chapitre 9: Implémentation ESP32
    ├── 16_backend_implementation.tex # Chapitre 10: Backend
    ├── 17_frontend_implementation.tex # Chapitre 11: Frontend
    ├── 18_experimental_results.tex # Chapitre 12: Résultats Expérimentaux
    ├── 20_conclusion.tex       # Conclusion Générale
    └── 21_appendices.tex       # Annexes
```

## Compilation sur Overleaf

### 1. Préparation des Fichiers

Avant d'uploader sur Overleaf, assurez-vous d'avoir:
- Tous les fichiers .tex listés ci-dessus
- Le fichier references.bib
- Les logos: logo_ibn_tofail.png et logo_sews.png

### 2. Upload sur Overleaf

1. Créer un nouveau projet vide sur Overleaf
2. Uploader main.tex à la racine
3. Uploader references.bib à la racine
4. Uploader les logos à la racine
5. Créer un dossier "chapters"
6. Uploader tous les fichiers .tex du dossier chapters

### 3. Configuration du Compilateur

Dans Overleaf, configurer:
- **Compiler**: pdfLaTeX
- **Bibliographie**: Biber
- **Main document**: main.tex

### 4. Compilation

Cliquer sur "Recompile". La compilation peut prendre 30-60 secondes.

Le processus exécute automatiquement:
1. pdfLaTeX (premier passage)
2. Biber (traitement bibliographie)
3. pdfLaTeX (second passage - références croisées)
4. pdfLaTeX (troisième passage - finalisation)

## Compilation Locale (TeXLive/MiKTeX)

### Installation des Dépendances

**Ubuntu/Debian**:
```bash
sudo apt-get install texlive-full texlive-lang-french biber
```

**Windows (MiKTeX)**:
1. Télécharger MiKTeX depuis https://miktex.org/download
2. Installer avec l'option "Install missing packages on-the-fly"

**macOS**:
```bash
brew install --cask mactex
```

### Commandes de Compilation

```bash
cd memoire_new/

# Compilation complète
pdflatex main.tex
biber main
pdflatex main.tex
pdflatex main.tex

# Ou avec latexmk (recommandé)
latexmk -pdf -pdflatex="pdflatex -interaction=nonstopmode" main.tex
```

## Ajout d'Images

Pour ajouter une image réelle (remplacer placeholder):

1. Créer un dossier `images/` à la racine
2. Placer l'image dans ce dossier (ex: `images/mqtt_architecture.png`)
3. Dans le fichier .tex correspondant, remplacer:

```latex
\figplaceholder{Architecture MQTT}{fig:mqtt_architecture}
```

Par:

```latex
\begin{figure}[htbp]
\centering
\includegraphics[width=0.8\textwidth]{images/mqtt_architecture.png}
\caption{Architecture MQTT}
\label{fig:mqtt_architecture}
\end{figure}
```

## Résolution des Problèmes Courants

### Erreur "File not found: chapters/XX.tex"
- Vérifier que le dossier `chapters/` existe
- Vérifier l'orthographe exacte des noms de fichiers

### Erreur bibliographie
- Vérifier que references.bib est à la racine
- S'assurer que Biber est configuré (pas BibTeX)
- Recompiler 3 fois après modification bibliographie

### Dépassement mémoire LaTeX
- Sur Overleaf: impossible, ressources suffisantes
- En local: ajouter `-synctex=1 -interaction=nonstopmode` aux options pdflatex

### Images non trouvées
- Vérifier chemins relatifs corrects
- Formats supportés: PNG, JPG, PDF
- Éviter espaces dans noms de fichiers

## Nombre de Pages Estimé

Avec le contenu actuel (sans images complètes):
- Front matter: ~15 pages
- Chapitres 1-12: ~75-80 pages
- Conclusion: ~5 pages
- Annexes: ~10 pages
- Bibliographie: ~3 pages

**Total estimé: 108-113 pages**

Pour réduire si nécessaire:
1. Réduire marges légèrement dans main.tex (geometry package)
2. Réduire interligne: `\setstretch{1.15}` au lieu de `1.2`
3. Condenser annexes (garder essentiel uniquement)
4. Réduire exemples de code (garder extraits significatifs)

## Support

Pour questions techniques LaTeX:
- Documentation Overleaf: https://www.overleaf.com/learn
- TeX Stack Exchange: https://tex.stackexchange.com
- Documentation packages: `texdoc <package>` en ligne de commande

Bon courage pour la finalisation!
