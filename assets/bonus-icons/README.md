# Silhouettes de bonus Deadwood

14 icônes créées avec le modèle intégré image_gen le 18 octobre 2026, à la demande du propriétaire. La référence [weapon-silhouette-reference.png](weapon-silhouette-reference.png) est une capture des silhouettes d'armes réelles du jeu, rendues par leur masque CSS existant. La série finale suit cette direction plate et monochrome ; les essais illustrés en volume ont été écartés.

- Originaux sélectionnés : PNG transparents dans [source/](source/), un fichier par bonus.
- Prompts exacts, référence et provenance : [prompts.json](prompts.json).
- Exports runtime : WebP sans perte 128×128 dans public/bonus-icons/, 84 268 octets pour les 14 fichiers.
- Dimensions, poids et SHA-256 : [exports.json](exports.json).

Le jeu utilise l'alpha de ces images comme les silhouettes d'armes, avec une couleur CSS uniforme. Aucun détourage, changement de silhouette, dessin ou correction artistique procédurale : les exports réduisent et encodent seulement les images, en conservant leur alpha.

Pour refaire les exports, utiliser Node avec sharp installé puis lancer node scripts/build-bonus-icons.mjs depuis cabin-coop. DEADWOOD_SHARP_MODULE permet de désigner le module sharp fourni par un runtime local sans l'ajouter aux dépendances du jeu. Les originaux image_gen hors dépôt sont conservés ; les 14 originaux utiles sont également sauvegardés ici.
