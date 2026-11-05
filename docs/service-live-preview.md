# Aperçu du Service pendant la planification

**Aperçu avant impression**, **Imprimer les besoins** et **Master vide** ouvrent un panneau non bloquant. Sur ordinateur, il se place à droite et réserve de la place pour les formulaires. Sur téléphone, il se place en bas. **Agrandir** permet de lire la feuille en grand; **Revenir à côté** rétablit la planification avec aperçu.

Les modifications enregistrées (quarts, affectations, employés, budgets et semaine) actualisent l’aperçu ouvert sans déplacer le défilement du panneau. Aucun enregistrement supplémentaire n’est créé par l’aperçu. Les documents imprimés conservent leur format légal et leur pagination, indépendamment de la taille d’affichage.

Un PDF déjà préparé est masqué dès que l’aperçu change. Pendant la génération, les feuilles sources restent stables. Si une modification survient, le PDF de l’ancienne version n’est pas proposé : l’aperçu est actualisé et un nouveau PDF doit être préparé. Les boutons du panneau sont temporairement désactivés pendant cette génération, sans bloquer la planification.

Vérifications : `test/browser-live-preview.mjs` (édition réelle, semaines, formats d’écran, agrandissement et modification pendant un PDF), `test/browser-service-needs.mjs` (PDF, impression et pagination).
