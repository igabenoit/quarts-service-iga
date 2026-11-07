# Clés d’accès des employés — activation progressive

Implémentation testée le 7 novembre 2026 dans une copie isolée du portail. Les employés d’essai sont fictifs. Aucun message ni invitation réelle n’est envoyé. Ce module ne constitue pas une certification de conformité juridique et n’active pas le coffre RH canadien.

## Écrans

- Employé : `/connexion-employe`. Les horaires, congés, disponibilités, chandails, discussions et dossiers proposent ce lien quand le mode est activé.
- Direction : `/acces` → **Clés d’accès des employés**, ou `/cles-employes`.
- Gérants : leurs comptes de travail et leurs périmètres restent ceux du portail existant. Une clé d’employé ne confère aucun droit de gestion.

Sur téléphone personnel, l’employé utilise le déverrouillage de l’appareil. Une clé de sécurité compatible peut aussi servir. Aucun numéro de téléphone, courriel ou compte professionnel n’est requis pour cette fonction. Le serveur conserve une clé publique et un identifiant opaque; aucun visage, empreinte ou code de déverrouillage.

## Configuration préalable

Les variables se configurent dans les secrets de la plateforme, jamais dans le code :

```text
EMPLOYEE_PASSKEY_MODE=pilot
EMPLOYEE_PASSKEY_ORIGIN=https://quarts-service-iga.onrender.com
EMPLOYEE_PASSKEY_ADMIN_IDS=<ID interne vérifié de la fiche principale de direction>
```

`EMPLOYEE_PASSKEY_ADMIN_IDS` contient des identifiants `schedule_store_people.id`, séparés par des virgules. Ce ne sont ni des matricules ni des noms. Pour le premier pilote, l’utilisateur a expressément désigné **Marc-André Benoit seulement**. Aucun gérant ne doit être ajouté. Sa fiche réelle doit être rapprochée par matricule avant activation. Le serveur refuse les activations si le matricule manque ou correspond à plusieurs fiches principales.

Modes :

- `off` (par défaut) : aucune activation ou nouvelle connexion par clé. Une personne déjà activée ne retrouve jamais l’accès par matricule seul. Les sessions par clé déjà émises restent limitées à leur durée normale.
- `pilot` : personnes déjà activées obligatoirement par clé; matricule encore utilisable pour les autres. Ce mode conserve donc le risque existant pour les personnes non migrées.
- `required` : matricule seul refusé pour tout le monde, y compris les anciens liens d’horaire. À activer après avoir équipé les personnes concernées.

L’origine est exacte et sans barre finale. Le domaine devient l’identifiant WebAuthn : conserver ce domaine ou préparer une migration des clés lors d’un changement. HTTPS est obligatoire en production. Pour les essais : `http://localhost:<port>`; pas une adresse IP comme RP dans Chrome.

## Déroulement du pilote

1. Installer les fichiers et les dépendances verrouillées avec `npm ci`. Le script `npm run check` doit réussir. Démarrer le module en mode `pilot`; aucun employé n’est automatiquement inscrit.
2. Rapprocher le compte de direction avec son matricule dans la liste réelle. Configurer son **ID interne** explicitement. Aucune valeur de production n’est prédéfinie dans ce module.
3. Vérifier son identité en personne. Depuis un terminal administratif de confiance, exécuter le script ci-dessous avec les variables de production chargées hors de la conversation. Le script exige une connexion PostgreSQL avec validation TLS. `DATABASE_CA_PEM` permet de fournir une autorité de certification si nécessaire; ne jamais désactiver la validation.

```sh
node scripts/bootstrap-passkey.mjs ID_INTERNE --verified-in-person "Première activation de la direction, identité vérifiée en personne"
```

4. Remettre directement à la personne le lien affiché par le terminal. Ne pas le coller dans un ticket, une conversation ou des journaux partagés. Il expire après 15 minutes et n’est utilisable qu’une fois. Le jeton est placé dans le fragment du lien, retiré de l’adresse dès l’ouverture, et son empreinte seule est stockée.
5. La personne active sa clé sur son appareil personnel ou sur sa clé de sécurité individuelle, puis ouvre `/cles-employes` avec **son accès administrateur existant ET sa session par clé**. Une confirmation par clé datant de moins de cinq minutes est exigée. Le code administrateur partagé seul ne suffit pas.
6. Pour chaque employé pilote : choisir sa fiche exacte, vérifier son identité et son matricule en personne, indiquer le motif et créer le lien. Aucune invitation n’est envoyée automatiquement. Une clé ne peut pas être créée sur la seule connaissance du matricule.
7. Vérifier un horaire et un congé avec le compte pilote. Passer à `required` seulement après un plan d’activation pour tous et un moyen de connexion pour les personnes sans téléphone.

## Téléphone perdu ou remplacé

La direction désignée choisit **Récupération**, vérifie l’identité en personne et consigne le motif. Le serveur révoque immédiatement toutes les anciennes clés et sessions de cette personne, puis crée un nouveau lien de 15 minutes. Il ne réactive jamais le matricule comme mot de passe.

La personne de direction ne peut pas utiliser ce parcours pour sa propre récupération. Prévoir une deuxième personne explicitement désignée avec sa propre clé avant la généralisation. À défaut, une reprise administrative hors du portail, avec identité et mandat vérifiés et intervention consignée, est nécessaire. Le script de première activation refuse de remplacer une clé déjà inscrite; il ne constitue pas une porte de secours permanente.

## Durées et stockage

- Personnel : session de 12 heures maximum, expiration après deux heures sans activité signalée par la page.
- Partagé : session de 30 minutes maximum, expiration après cinq minutes sans activité; une vérification automatique de session ne prolonge pas le délai. Choisir l’option **appareil partagé** à chaque connexion sur un poste commun. Ne pas y créer de clé personnelle.
- Défis cryptographiques : cinq minutes, usage unique, liés au navigateur par cookie HttpOnly, même en cas d’échec de vérification.
- Cookies de session : jeton aléatoire de 256 bits; seule son empreinte est stockée, HttpOnly, SameSite Strict et Secure en production. L’identité active, la révocation de la clé et la version d’accès sont vérifiées à chaque requête.
- Limitation des tentatives : compteur en base, 300 requêtes WebAuthn par adresse sur 15 minutes, conservé lors d’un redémarrage. L’adresse IP est remplacée dans ce compteur par une empreinte HMAC. Ce plafond laisse plusieurs employés se connecter depuis le réseau du magasin.

Les tables `schedule_passkey_*` utilisent actuellement la base d’identité existante du portail, pas le coffre RH Supabase. Il faut inscrire ce traitement et ses sauvegardes à l’inventaire/EFVP : il ne devient pas canadien du seul fait que le coffre RH l’est. Les liens expirés, historiques d’activation et clés révoquées ne sont pas tous purgés automatiquement : leurs durées et leur destruction doivent être approuvées par le responsable, puis implémentées sans effacer des traces utiles à un incident. Les fichiers RH, leurs droits et leur blocage de collecte demeurent gérés séparément.

## Vérification reproductible

```sh
npm ci
npm run check
node --test --test-concurrency=2 test/*.test.js
```

`test/employee-passkeys.test.js` utilise de véritables signatures ES256 avec le vérificateur WebAuthn. Il vérifie les origines, le RP, l’utilisateur, la présence/vérification locale, les rejouements, les défis expirés, la récupération, les anciens cookies, le retrait d’accès et le redémarrage. Le mode obligatoire couvre aussi l’ancien point d’entrée des horaires.

`test/passkey-browser.mjs` utilise Chromium et son authentificateur virtuel : activation par la direction sur ordinateur, inscription et connexion mobile, retour au portail, rejet du matricule seul, mode partagé. Les variables `PLAYWRIGHT_MODULE` et `BROWSER_EXECUTABLE` permettent de choisir l’installation locale de Playwright/Chrome. Les tests ne remplacent pas un essai réel sur iPhone/Safari et Android/Chrome avant généralisation.

Bibliothèques verrouillées : `@simplewebauthn/server` 14.0.3, `@simplewebauthn/browser` 14.0.0. Le bundle navigateur est servi localement, sans CDN. Documentation du fournisseur : https://simplewebauthn.dev/docs/packages/server et https://simplewebauthn.dev/docs/packages/browser.

Le lot intègre également les correctifs de l’audit précédent : liaison des demandes à l’identité, restrictions de périmètre des gérants, suppression de l’affichage des mots de passe, révocation à la déconnexion et échappement CSV. Les essais historiques ont été adaptés à ces règles : une identité fictive est fournie dans les fixtures; aucune règle de production n’a été relâchée pour faire passer un test.
