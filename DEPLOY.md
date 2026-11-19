# Déploiement Trocly API (F3)

## 1. Déploiement local / VPS avec Docker Compose

```bash
cp .env.example .env
# Éditer .env (JWT_SECRET, QR_SECRET, mot de passe DB)
docker compose up -d --build
```

Vérifier la santé :
- `GET http://<host>:3000/health`
- `GET http://<host>:3000/cities`
- `GET http://<host>:3000/api/docs` (une fois `feature/F1-openapi` mergée)

## 2. Déploiement Railway / Render (Démo)

1. Créer un service PostgreSQL managé et récupérer `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`.
2. Connecter le dépôt `trocly_api` (détection automatique du `Dockerfile`).
3. Configurer les variables d'environnement listées dans `.env.example`.
4. Dans `trocly_mobile`, compiler l'APK en pointant sur l'URL déployée :
   ```bash
   flutter build apk --release --dart-define=API_URL=https://votre-api.up.railway.app
   ```
