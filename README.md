# K2 — Back-office mobile Comedy Club Everest

PWA mobile-first pour piloter les sessions du Comedy Club Everest.

## Stack

- **Front** : HTML/CSS/JS vanilla (zero framework)
- **API** : Cloudflare Worker (proxy securise HubSpot)
- **Hebergement** : Cloudflare Pages (CDN, deploy auto)
- **Donnees** : HubSpot API + GitHub YAML + Cloudflare KV

## Structure

```
k2-everest/
├── index.html              # SPA shell
├── css/styles.css          # Themes, layout, composants
├── js/
│   ├── app.js              # Router, state, rendu
│   ├── api.js              # Client API + offline queue
│   └── charts.js           # Graphiques SVG
├── service-worker.js       # Cache + offline
├── manifest.json           # PWA metadata
├── icons/                  # Icones PWA
├── worker/index.js         # Cloudflare Worker (API)
└── wrangler.toml           # Config Worker
```

## Deploiement

Le front se deploie automatiquement sur push via Cloudflare Pages.
Le Worker se deploie via `npx wrangler deploy`.

## Setup

```bash
# 1. Creer le KV namespace
npx wrangler kv:namespace create K2_STATE

# 2. Mettre a jour l'ID dans wrangler.toml

# 3. Configurer les secrets
npx wrangler secret put HUBSPOT_TOKEN
npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_PIN
npx wrangler secret put TEAM_PIN

# 4. Deployer le Worker
npx wrangler deploy
```

## Ecrans

1. **Dashboard** : phase, metriques, checklist, actions
2. **Lineup** : artistes, statuts, DM copiables
3. **Stats** : frequentation, chapeau, parite
4. **Jour J** : checklist interactive, pointage, chapeau
5. **Paiements** : suivi par artiste
