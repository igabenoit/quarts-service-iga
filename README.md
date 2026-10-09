# Quarts Service IGA

Application Web pour construire les quarts nécessaires à la caisse, à la supervision et pour les emballeurs avant l’attribution des employés.

L’onglet Horaire permet d’importer une liste JSON d’employés dans la base privée, de corriger
leurs disponibilités, puis d’attribuer les quarts d’une semaine. L’import initial est accepté
uniquement quand la liste est vide. Les quarts attribués manuellement sont conservés lors
d’une nouvelle génération. Les quarts « Aide autre département » restent à couvrir séparément.
Les quarts sans candidat et les totaux par employé sont visibles avant l’impression.

Les heures souhaitées servent de cible à la génération. L’option de dépassement permet
de compléter les quarts libres au-delà de cette cible, jusqu’au maximum hebdomadaire.
Une attribution manuelle peut déjà dépasser la cible, avec ou sans cette option.
Le « Maximum / semaine », les disponibilités, les congés et les limites de jours et
de mineurs restent applicables. Un refus d’attribution indique la contrainte précise.

## Variables requises

- `DATABASE_URL`
- `SESSION_SECRET`
- `MANAGER_CODE`

## Développement

```bash
npm install
npm run check
npm start
```

## Annuler la dernière action

La touche « Annuler la dernière action » fonctionne directement, sans aperçu, dans l’horaire et le suivi des congés. Le libellé précise l’action qui sera annulée. Ctrl+Z (ou Cmd+Z) déclenche le même retour hors des champs de saisie. Plusieurs clics remontent les actions successives. L’historique est commun aux gestionnaires et persiste après un rechargement.

Sont enregistrés : ajouts, modifications et suppressions de quarts, affectations, générations, copie de semaine, budgets et notes, fiches employés et congés manuels, décisions de congé et application des congés. L’enregistrement d’une fiche employé et de ses congés constitue une seule action. Une annulation rétablit uniquement les lignes modifiées par cette commande, avec les affectations supprimées en cascade. L’historique des décisions de congé est conservé. Les réglages de connexion, de partage et de courriel ne font pas partie de ce retour.

Chaque commande et son historique sont enregistrés dans la même transaction. Les erreurs et opérations sans changement ne consomment pas le retour. Une action plus récente ou des données modifiées hors de cet historique bloquent un retour périmé. Les actions antérieures à la mise en service ne sont pas récupérables. Les sauvegardes techniques des recréations de la version précédente restent conservées.

Les tests d’annulation utilisent PostgreSQL embarqué (PGlite, dépendance de développement) : exécuter npm ci puis npm test.

## Employés inactifs et départs définitifs

Décocher « Employé actif » correspond à une absence temporaire (par exemple un arrêt maladie de longue durée) : la fiche reste dans la liste. « Retirer de la liste — départ définitif », visible lors de la modification d’une fiche, masque l’employé et l’exclut des nouvelles propositions d’affectation. Les quarts déjà attribués et l’historique restent conservés; les quarts à venir doivent être vérifiés par le gestionnaire. La touche Annuler peut rétablir la fiche et son statut antérieur.

## Demandes de congé

- Gestion : lien **Demandes de congé** dans l’application, ou /conges-gestion après connexion gestionnaire.
- Employés : ouvrir /conges avec le code commun, inscrire son prénom et son nom, puis choisir son département. Le bouton de l’horaire et public/conges-qr.svg pointent vers cette adresse permanente. Le code commun ne vérifie pas individuellement l’identité; le motif et le courriel restent réservés à la gestion.
- Préavis : avant 9 h le jeudi précédant la première semaine du congé (lundi à dimanche), selon America/Toronto; à 9 h exactement, la demande est hors délai. La date et l’heure de remise proviennent de la base de données. Les tentatives hors délai sont conservées séparément avec le statut « Hors délai » pour le suivi et ne peuvent pas être approuvées par ce formulaire.
- Dates inclusives : toutes les journées sont affichées automatiquement. Pour chacune, choisir journée complète ou heures d’absence avec des boutons aux 15 minutes. Un résumé précède l’envoi; aucun ajout manuel de période n’est nécessaire. La fin de journée est représentée par 24:00, autorisé seulement comme heure de fin.
- Une demande peut couvrir plusieurs semaines : elle est comptée une seule fois et ses plages approuvées sont appliquées à toutes les semaines, y compris celles créées ultérieurement. Les demandes en attente ne bloquent pas les quarts.
- L’approbation libère uniquement les affectations de l’employé qui chevauchent le congé, dans la même transaction que la décision. Les besoins de quarts et toutes les autres affectations sont conservés. Les quarts libérés restent « À couvrir » pour choisir un remplaçant. Les retraits sont consignés dans l’historique de la demande. Pour les congés déjà approuvés, « Appliquer les congés approuvés » effectue ce même ajustement sur la semaine affichée, sans recréer l’horaire. Une deuxième application sans nouveau conflit ne change rien. L’annulation conserve l’historique et ne rétablit pas automatiquement des affectations. Les journées bloquées manuellement restent indépendantes.
- Si une nouvelle demande répète des périodes déjà approuvées, l’approbation ajoute uniquement les périodes supplémentaires. La demande originale reste visible et le suivi précise les périodes effectivement ajoutées. Les périodes répétées restent rattachées à leur demande initiale, notamment pour une annulation. Une demande entièrement couverte est signalée sans modification de l’horaire.
- Tests : /conges-test, accessible avec la session gestionnaire. Les demandes de test ne sont liées à aucun employé réel et sont exclues par défaut des statistiques et de l’horaire.
- Le courriel saisi est une coordonnée de suivi. Les notifications réelles vont au courriel du département, avec une copie générale facultative (sans doublon pour la même adresse); les tests vont uniquement au destinataire de test. Configurer les départements et les destinataires dans le suivi, puis RESEND_API_KEY et RESEND_FROM_EMAIL (expéditeur validé) dans Render. RESEND_FROM ou EMAIL_FROM sont aussi reconnus; sans expéditeur, onboarding@resend.dev est utilisé, uniquement selon les limites du compte de test Resend. LEAVE_TEST_NOTIFY_EMAIL peut fournir le destinataire initial. Aucun secret n’est renvoyé au navigateur. Les envois sont mis en file dans la même transaction que la demande; les reprises utilisent une clé d’idempotence et cessent après 20 heures pour vérification manuelle. « Pris en charge par Resend » ne confirme pas la livraison en boîte de réception. Les instances Render en veille reprennent la file au réveil.
- Les nouvelles tables sont créées automatiquement au démarrage; aucun changement destructif n’est nécessaire.

Validation : npm run check et npm test. Les tests de règles couvrent le jeudi à 9 h (heures d’été et d’hiver), le fuseau horaire, les dates invalides, les périodes multisemaines, les conflits partiels et les statistiques.

Le formulaire permanent reprend initialement le code du dernier horaire partagé; son code devient ensuite indépendant des semaines et peut être changé dans le suivi sans changer le QR. Les adresses des départements sont conservées en base privée. Les statistiques incluent tous les départements avec un filtre et un récapitulatif. Un nom saisi au Service doit être relié explicitement à un employé de l’horaire avant approbation; les autres départements ne modifient pas les quarts du Service.
