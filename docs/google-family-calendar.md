# Synchronisation des horaires familiaux avec Google Agenda

## Activation

Créer un client OAuth Google de type « Application Web » dans un projet avec Google Calendar API activée. Configurer la marque et l’audience de l’application Google Auth Platform pour les utilisateurs concernés. Le mode de test OAuth externe limite généralement la durée des autorisations : utiliser une configuration de production adaptée avant de promettre une synchronisation durable.

URI de redirection autorisée pour le service principal :

`https://quarts-service-iga.onrender.com/api/family-portal/google/callback`

Ajouter uniquement dans les secrets Render du service principal :

- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI` (facultatif si l’URI ci-dessus convient)

Ne jamais enregistrer ces secrets dans Git. `SESSION_SECRET` sert déjà à chiffrer les autorisations Google conservées en base. Une rotation nécessite de reconnecter Google.

Depuis `/horaire-famille`, se connecter avec l’accès familial, choisir **Connecter Google**, autoriser les permissions, sélectionner **Famille** et activer. L’autorisation demande la liste des calendriers en lecture et les événements en lecture/écriture. Le mot de passe Google n’est pas transmis au site.

## Comportement

Le serveur vérifie les horaires publiés toutes les deux minutes, même lorsque le portail est fermé. Un processus web doit rester actif. Les quarts des enfants rattachés à l’accès familial, y compris leurs fiches liées et les quarts du Service, sont lus par la même fonction que le portail. Les congés et les brouillons ne créent pas d’événement. Les événements portent les heures de présence et le fuseau `America/Toronto`, avec passage au lendemain si nécessaire.

La fenêtre couvre aujourd’hui et les treize prochaines semaines. Les jours passés sont conservés. Une modification actualise le même événement; un retrait dans la source supprime l’événement futur associé. Les identifiants sont conservés avant les écritures Google afin de reprendre une requête interrompue sans doublon. Aucun événement étranger à cette synchronisation n’est modifié ou supprimé. Les suppressions n’ont lieu qu’après une lecture complète des sources. Les accès familiaux désactivés ne sont plus synchronisés.

Un verrou PostgreSQL par famille protège des processus concurrents. Les erreurs sont visibles dans le portail, sans jetons ni réponses brutes de Google. « Arrêter la synchronisation » efface le jeton local et conserve les événements déjà ajoutés. Il est aussi possible de retirer l’autorisation dans le compte Google. Pour éviter les copies, une famille reste liée au même calendrier lors d’une reconnexion.

## Validation

`node --test test/family-google-calendar.test.js test/family-portal.test.js`

Tests sans accès au Google réel : calendrier et fuseau, quart de nuit, chiffrement, état OAuth à usage unique lié au navigateur, séparation des familles, insertions et mises à jour, annulations, conservation du passé, échec de lecture et reprise après insertion ambiguë. L’essai réel OAuth reste nécessaire après configuration du client et consentement du propriétaire.

Références : https://developers.google.com/identity/protocols/oauth2/web-server et https://developers.google.com/calendar/api/v3/reference/events/insert

