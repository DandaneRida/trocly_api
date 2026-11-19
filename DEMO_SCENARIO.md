# Scénario de Démonstration — Trocly (F4 · PI_4A_12)

Durée estimée : **7 minutes** · Deux comptes : **Yassine** (`+212611111111`) et **Salma** (`+212622222222`).

---

## Prérequis avant la présentation
1. PostgreSQL actif (`trocly_db`).
2. Lancer l'API :
   ```bash
   cd trocly_api && npm run start:dev
   ```
3. Lancer l'application mobile (Android APK `app-release.apk` ou Chrome `flutter run -d chrome`).
4. En mode développement, le code OTP s'affiche dans le terminal API (`[DEV] OTP for ...`) et `123456` fonctionne comme code universel.

---

## Déroulé pas à pas

### 1. Découverte sans compte & changement de ville (`A1`, `B5`)
- Ouvrir Trocly → appuyer sur **Explorer les annonces**.
- Sans être connecté, parcourir les annonces de **Meknès**, filtrer par catégorie (onglets soulignés) et changer de ville (`Fès`, `Rabat`, retour `Meknès`).

### 2. Connexion OTP WhatsApp & complétion profil (`A2`, `A3`, `A4`)
- Appuyer sur **Connexion** → saisir `+212 6 11 11 11 11` (Yassine).
- Lire le code OTP dans le terminal API → saisir les 6 chiffres.
- Compléter le profil (`Yassine B.`, ville `Meknès`) → réception du JWT + refresh token.

### 3. Publier une annonce & règle anti-doublon (`B1`, `B2`, `B3`, `B4`)
- Onglet **Publier** : ajouter 1 photo, titre `VTT Btwin Rockrider 520`, catégorie `Sport`, état `Très bon état`, souhait `Console de jeux`.
- Vérifier que l'annonce apparaît immédiatement dans le fil de Meknès et dans **Mes annonces**.
- Tenter de republier exactement la même annonce → la **Règle B2 (`409 Conflict`)** bloque le doublon.
- Tester la recherche/filtre dans **Explorer** (`B4`).

### 4. Offre multi-objets, contre-offre & chat temps réel (`C1`, `C2`, `C3`, `C4`, `C5`)
- Connecter **Salma** (`+212 6 22 22 22 22`), publier `Console PS4 Slim` et `Lot de 9 BD`.
- Sur l'annonce du VTT de Yassine, appuyer sur **Proposer un échange** → sélectionner les 2 objets + soulte `200 DH`.
- Yassine reçoit une **notification** (`C5`), ouvre la **conversation temps réel** (`C4`), discute en direct via Socket.IO et **accepte** l'offre (`C3`).

### 5. Rendez-vous, QR codes & double scan (`D1`, `D2`, `D3`, `D4`)
- Depuis le chat, cliquer sur l'icône calendrier → proposer `Place El Hedim, Meknès` à `15:00` (`D1`, expiration automatique à `17:00` — `D4`).
- Le partenaire accepte → **2 QR codes signés HMAC-SHA256** sont générés et affichés sur le billet découpé (`D2`).
- Yassine scanne le QR de Salma (**1/2**), puis Salma scanne le QR de Yassine (**2/2**) → statut `validated` et annonces automatiquement passées en `exchanged` (`D3`).

### 6. Avis mutuels à l'aveugle & score de confiance (`D5`, `E1`, `E2`)
- Chaque participant choisit une note (★), sélectionne des tags (`Ponctuel`, `Objet conforme`) et publie son avis.
- Dès que les 2 avis sont soumis, ils sont révélés et le **score de confiance** se met à jour sur le profil (`E1`).

---

## Vérification automatisée
Exécuter le script E2E complet contre l'API locale :
```bash
node scripts/demo_e2e.mjs
```
