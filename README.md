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


## Confirmation des approbations et courriels des employés

Chaque nouvelle approbation met sa confirmation dans une file transactionnelle distincte des notifications au département. Le message va seulement au courriel de la demande, même si les notifications au département sont désactivées. Il contient les périodes effectivement ajoutées, le département et la référence, sans motif privé ni note de gestion. Le responsable du département est proposé comme adresse de réponse. Les approbations antérieures à cette fonction ne déclenchent aucun envoi rétroactif. Les tests vont exclusivement au destinataire de test.

La file attend au moins 15 secondes avant le premier traitement (passage toutes les 30 secondes), annule les envois en attente lorsque la décision ou sa version change, fige le contenu avant l’envoi et réutilise sa clé d’idempotence pour les reprises. Après 20 heures depuis la première tentative, une vérification dans Resend est requise. L’état est visible sur chaque demande. Un courriel déjà pris en charge par Resend ne peut pas être retiré par Annuler; une décision modifiée ensuite doit être communiquée à l’employé par la gestion. Aucun nouvel envoi automatique de refus ou d’annulation n’est ajouté.

/courriels est accessible depuis l’horaire et le suivi des congés. Son API et ses modifications exigent une session gestionnaire; les écritures exigent aussi la même origine. Les compteurs comparent les adresses aux employés actifs non retirés du Service. Les demandes réelles, y compris archivées, alimentent la liste. Un lien existant ou une correspondance de nom normalisé unique au Service permet le rapprochement; plusieurs adresses distinctes demandent un choix explicite. Les adresses non rapprochées peuvent être reliées manuellement sans modifier la demande ni l’horaire. Une adresse choisie par la gestion reste prioritaire. Les employés inactifs/retirés et les tests sont exclus de la copie Cci. L’export de toutes les adresses reçues inclut les anciens employés, sans les tests. La copie Cci est dédoublonnée. Les CSV neutralisent les formules. Les préférences et liens de contact sont conservés dans des tables privées distinctes et ne font pas partie de l’annulation des horaires.

La liste se recharge à l’ouverture, au retour dans l’onglet et toutes les minutes lorsqu’elle est visible, sans écraser une saisie en cours. Les tests d’envoi utilisent un fournisseur simulé et PostgreSQL embarqué; aucun courriel réel n’est envoyé par la suite de tests.
