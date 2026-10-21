# Mise en page des horaires PDF

Les PDF des huit départements, du Service, des sommaires et des pièces jointes
d’horaires utilisent `prepareSchedulePages`. Les copies de travail sont mesurées
dans le navigateur après le chargement des polices et images. Les cases peuvent
grandir; les lignes complètes passent à la page suivante si nécessaire. Les
en-têtes et titres de groupe sont répétés, les sous-totaux restent à la fin du
groupe et les totaux originaux ne sont pas recalculés.

Les pages restent au format légal. Un horaire ordinaire garde une page; une
équipe plus grande ou des précisions longues peuvent nécessiter plusieurs pages.
Les PDF sont paginés. Un bloc exceptionnellement plus haut qu’une page est
conservé intégralement et réduit proportionnellement lors de la capture PDF.
Les textes, données sauvegardées et horaires publiés ne sont pas modifiés.
L’impression directe du Service utilise les mêmes copies ajustées.

## Vérifications

`node --test test/department-print-fit.test.js test/service-print.test.js test/grocery-night-order.test.js test/department-night.test.js`

Le test navigateur `node test/browser-schedule-layout.mjs` requiert Playwright.
`PLAYWRIGHT_MODULE` permet de sélectionner son installation et
`BROWSER_EXECUTABLE` un navigateur Chromium/Edge local. Il démarre un serveur
local isolé avec des données fictives, vérifie les limites des pages et des cases,
l’absence de perte ou duplication d’employés, les horaires vierges/remplis de
tous les départements, le Service avec absence partielle et disponibilités
longues, les contrôles et le sommaire. Il crée un PDF réel et des images dans
`tmp/pdf-layout` pour inspection visuelle. Aucun courriel n’est envoyé.

Les quarts ordinaires affichent le début et la fin sur deux lignes, sans encadré.
Les cases contenant plusieurs portions conservent des blocs distincts et leurs
couleurs. Les mentions de poste et d’absence sont conservées sous les heures.
