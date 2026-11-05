# Corriger un congé accepté

Dans **Congés**, ouvrir **Corriger les journées et les heures du congé accepté** sur une demande approuvée non archivée. Modifier les périodes, indiquer la raison, puis **Enregistrer la correction**. Pour retirer entièrement le congé, utiliser **Annuler la demande**.

La demande reste approuvée et conserve son numéro. L’historique conserve les périodes avant et après correction et sa raison. Une nouvelle confirmation « Congé corrigé » est mise en file pour l’employé; elle précise qu’elle remplace la précédente. Les anciennes confirmations envoyées restent dans la boîte du destinataire. Les anciennes prises de connaissance ne valent pas pour la nouvelle version.

Le recalcul porte sur les anciennes et les nouvelles périodes. Les absences partielles sont ajustées en tenant compte des autres congés approuvés. Les quarts devenus incompatibles sont remis à couvrir. Les quarts précédemment libérés ne sont pas réattribués automatiquement : la gestion doit vérifier l’horaire.

Les contrôles gestionnaire, département, version, archive et validation des périodes restent obligatoires. L’enregistrement, l’historique, les changements d’horaire et la mise en file du courriel sont transactionnels et compatibles avec **Annuler**. Une erreur ou une version périmée ne sauvegarde aucune modification.

Vérifications : `node --test test/leave-correction.test.js` et `node test/browser-leave-correction.mjs` (Playwright/Chromium configurés comme les autres parcours navigateur du projet).
