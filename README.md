# Barrena · Suivi du temps

Application pour téléphone (installable comme une vraie app, fonctionne sans réseau) qui envoie tes heures, notes, photos et factures vers le tableau de bord « Barrena - Tableau de bord » et vers le dossier Drive de ton comptable, **sans Google Cloud ni carte bancaire** (un petit script Google, dans ton tableau de bord, fait le lien).

## Ce que fait l'application

| Onglet | Fonction |
|---|---|
| Chrono | Choisir projet + étape, **Démarrer** (date et heure remplies automatiquement), Pause, **Arrêter**. Au moment d'arrêter : temps réel, ½ heure la plus proche ou ½ heure supérieure. Produit consommé proposé pour FOND/APRET et VERNI/LAQUE. Onglet « Hors projet » avec catégories. Compteurs du jour et de la semaine. Rappel si le chrono dépasse 4 h (réglable). |
| Après coup | Saisie d'une session oubliée (date, début, fin). |
| Notes | Note + photo (difficulté, défaut de matière). La note va dans l'onglet « Notes projets », la photo dans Drive (un dossier par projet). |
| Factures | Scan multi-pages (recadrage, noir & blanc) ou import d'un fichier. Tu tapes seulement le nom juridique et le numéro. Le PDF est nommé `NOM JURIDIQUE NUMERO.pdf`, envoyé dans le dossier du comptable, et une ligne est ajoutée dans l'onglet « Charges ». |
| Bilan | Éléments en attente, bouton **Synchroniser**, réglages, verrouillage. |

Tout est enregistré d'abord sur le téléphone. Rien n'est perdu sans réseau : à la synchronisation (bouton ⟳ en haut, ou automatique quand le réseau revient), tout part vers Google.

## Ce que j'ai modifié dans ton tableau de bord

- Nouvel onglet **App** : liste des étapes (colonne « Consomme un produit » OUI/NON), catégories hors projet, base des **produits de finition** (produit, référence, type, fournisseur, prix au litre). C'est là que tu modifies les listes : l'app les relit à chaque synchronisation. Les prix sont à remplir.
- Nouvel onglet **Notes projets**.
- Onglet **Suivi des heures** : colonnes ajoutées après « Mois » : Étape, Début, Fin, Heures réelles, Mode de calcul, Produit consommé, Quantité (L), Coût produit (€), Utilisateur. Les colonnes A à F gardent leur rôle (Heures = temps retenu).
- Les heures hors projet sont écrites avec le projet « Hors projet » et la catégorie dans « Étape ».
- Un nouveau projet créé dans l'app est ajouté à l'onglet **Projets** avec le statut « En cours » (budget et taux horaire à compléter à la main).
- Dans **Charges**, la facture ajoutée contient : N° facture, Fournisseur, Date du scan, et le lien du PDF dans « Description ». Les montants sont à saisir ensuite.

Les formules existantes ne sont jamais écrasées : l'app écrit dans la première ligne après la dernière ligne remplie.

---

## Installation (≈ 20 minutes, une seule fois, sans carte bancaire)

### 1. Installer le script dans ton tableau de bord

1. Ouvre « Barrena - Tableau de bord » dans Google Sheets → **Extensions → Apps Script**.
2. Efface le contenu de l'éditeur, ouvre le fichier `apps-script/Code.gs` (dans ce dossier, avec le Bloc-notes), copie tout et colle-le.
3. Ligne 8 : remplace `CHANGE-MOI` par une **clé personnelle** : une phrase longue et unique, sans espace de début ni de fin (ex. `cerisier-atelier-valencia-4872-planche`). Note-la : tu la saisiras dans l'app.
4. Clique 💾 **Enregistrer**.

### 2. Publier le script

1. En haut à droite : **Déployer → Nouveau déploiement** → roue ⚙ → **Application Web**.
2. **Exécuter en tant que : Moi**. **Qui a accès : Tout le monde** (c'est ce qui permet à l'app de l'appeler ; la clé protège l'accès).
3. **Déployer**. Google demande une autorisation : **Autoriser l'accès** → choisis ton compte → « Google n'a pas validé cette application » → **Paramètres avancés → Accéder à … (non sécurisé)** → **Autoriser**. C'est ton propre script : cet avertissement est normal.
4. Copie l'**URL de l'application Web** (elle finit par `/exec`).

Si un jour tu modifies `Code.gs` : **Déployer → Gérer les déploiements → ✏ → Version : Nouvelle version → Déployer** (l'adresse ne change pas).

### 3. Mettre l'application en ligne (GitHub Pages, gratuit, sans carte)

1. Crée un compte sur https://github.com, puis un dépôt **public** nommé `barrena-temps`. (Les pages gratuites exigent un dépôt public. Il ne contient aucun secret : ni clé, ni adresse du script.)
2. **Add file → Upload files** : glisse le **contenu** du dossier de l'app (`index.html`, `js`, `icons`, etc., sans le dossier `apps-script`) → **Commit**.
3. **Settings → Pages** : « Deploy from a branch », branche `main`, dossier `/ (root)`. Après 1 à 2 minutes : `https://TON-PSEUDO.github.io/barrena-temps/`.

### 4. Installer sur le téléphone (Android)

Ouvre l'adresse dans Chrome → menu ⋮ → **Installer l'application**.

### 5. Premier lancement

1. Choisis un **code de 4 à 6 chiffres** (accepte l'empreinte/schéma si proposé).
2. Appuie sur **⟳** : une fenêtre demande l'**adresse du script** (étape 2.4) et ta **clé** (étape 1.3). **Tester et enregistrer**.
3. Les projets, étapes et produits se chargent.

Pour mettre à jour l'app plus tard : re-glisser les fichiers modifiés dans GitHub, puis fermer et rouvrir l'app (deux fois si besoin).

---

## Liste de tests à faire sur ton téléphone

À cocher dans l'ordre. En cas de souci, note l'étape et le message affiché.

**A. Ouverture et sécurité**
- [ ] Code créé, l'app s'ouvre. Ferme l'app, rouvre : elle demande le code (ou l'empreinte/schéma).
- [ ] Mets l'app en arrière-plan plus de 30 secondes, reviens : elle est verrouillée.
- [ ] Bilan → « Activer l'empreinte / schéma » fonctionne.

**B. Synchronisation et listes**
- [ ] ⟳ : saisie de l'adresse et de la clé, puis « Connexion réussie » et « Synchro terminée ». Les projets en cours de ta feuille apparaissent.
- [ ] Avec une clé fausse : message « Clé refusée ».
- [ ] Les 12 étapes sont visibles. Dans la feuille, change le nom d'une étape (onglet App), resynchronise : l'app suit.

**C. Chrono**
- [ ] Projet + étape → Démarrer → attends 1 minute → Pause → Reprendre → Arrêter. Les trois modes de calcul affichent des valeurs cohérentes.
- [ ] Enregistrer, puis **Synchroniser**. Ouvre « Suivi des heures » : une ligne après la dernière, avec date, heures, étape, début, fin, mode.
- [ ] Ferme l'app chrono lancé, rouvre : le chrono continue.
- [ ] Avec FOND/APRET ou VERNI/LAQUE : choisis un produit (après l'avoir saisi dans l'onglet App) et une quantité : le coût apparaît dans la ligne.
- [ ] Hors projet : une catégorie, démarrer, arrêter, synchroniser.
- [ ] Compteurs « Aujourd'hui » / « Cette semaine » cohérents.

**D. Après coup**
- [ ] Une session oubliée d'hier est écrite avec la bonne date.

**E. Projet**
- [ ] « + Nouveau projet » → présent dans l'onglet Projets après synchro, statut « En cours ».

**F. Notes et photos**
- [ ] Note + photo prise avec l'appareil → après synchro : ligne dans « Notes projets » avec un lien. Le lien ouvre la photo, rangée dans Drive → « Barrena - Photos projets » → dossier du projet.

**G. Factures**
- [ ] Scanner une page (appareil photo), ajuster les coins, Valider. Vérifie la lisibilité en noir & blanc ; teste « Gris » si le texte est trop pâle.
- [ ] Ajoute une 2ᵉ page. Saisis nom juridique + numéro : le nom du fichier s'affiche. Enregistrer, synchroniser.
- [ ] Le PDF est dans le dossier du comptable avec le bon nom. Une ligne est ajoutée dans « Charges ».
- [ ] Même nom une 2ᵉ fois : le fichier reçoit « (2) », sans écraser le premier.

**H. Sans réseau**
- [ ] Mode avion : l'app s'ouvre, tu peux chronométrer, saisir, noter, scanner. Bandeau « Hors ligne » visible.
- [ ] Coupe le mode avion → Synchroniser → tout est envoyé.

**I. Rappel**
- [ ] Dans Bilan, règle le rappel sur 0,5 h, lance un chrono, laisse l'app ouverte 30 minutes : une alerte s'affiche. Remets 4 h.

---

## Limites à connaître

- **Sécurité du script.** Son adresse est publique pour Google (« Tout le monde »), mais personne ne peut écrire sans ta clé. Garde l'adresse et la clé pour toi. Si tu penses qu'elles ont fuité : change la clé dans le script, redéploie (nouvelle version) et saisis-la dans l'app. Le script a accès à ton Drive (il en a besoin pour écrire dans le dossier du comptable), mais le code ne touche qu'à ce dossier, au dossier « Barrena - Photos projets » et au tableau de bord.
- **Clé stockée sur le téléphone.** Elle est gardée dans l'app, derrière ton code ou ton empreinte. Si tu perds le téléphone, change la clé.
- **Rappel de chrono.** Une application web ne peut pas réveiller le téléphone en arrière-plan de façon fiable. Le rappel s'affiche quand l'app est ouverte ou quand tu y reviens (avec vibration, et notification si autorisée et si Android laisse l'app active). Ne compte pas dessus pour un chrono oublié dans la poche toute la journée.
- **Verrou.** Le code / l'empreinte protègent l'accès à l'écran de l'app. Les données gardées sur le téléphone en attente de synchro ne sont pas chiffrées ; elles sont protégées par le verrouillage du téléphone lui-même.
- **Scan.** Recadrage manuel (pas de détection automatique des bords, pas de correction de perspective). Pour un document photographié bien à plat, le résultat est correct ; Adobe Scan reste plus précis. Tu peux importer le PDF d'Adobe Scan avec « Importer ».
- **Réseau.** Tout part à la synchronisation (⟳, ou automatique au retour du réseau). Pas de connexion qui expire. Si Google bloque l'accès, vérifie que le déploiement est bien « Tout le monde ».
- **Compteurs jour/semaine.** Ils comptent les saisies faites avec cette app sur ce téléphone.
- **Formules de la feuille.** La colonne « Heures passées » des Projets lit « Suivi des heures » jusqu'à la ligne 502. Si tu dépasses, l'app te le signale : il suffit d'étendre la plage dans les formules.
- **Date de la facture.** La colonne Date de « Charges » reçoit la date du scan ; corrige-la avec la date réelle de la facture si besoin. Catégorie, montant HT et TVA sont à compléter.
- **Doublons.** Chaque envoi porte un identifiant unique : si le réseau coupe et que l'app renvoie, le script reconnaît l'opération (mémoire de 6 heures) et n'écrit pas deux fois.
- **Quotas Google.** L'usage normal d'un atelier reste très loin des limites gratuites d'Apps Script.

## Évolutions prévues dans la conception
- La colonne « Utilisateur » est déjà écrite (réglage `USER` dans `js/config.js`), prête pour un second utilisateur.
- La liste des produits et leurs prix se précisent dans l'onglet App, sans toucher à l'app.
