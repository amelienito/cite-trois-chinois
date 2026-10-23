# Cite 3 chinois

On tape le nom d'une personnalité *encore vivante*, le pays est détecté, et trois noms complètent un pays sur la carte. Le but est de remplir le plus de pays possible.

Jouer : https://amelienito.github.io/cite-trois-chinois/

## Développement

Node 20 ou plus.

```
npm run check    # contrôle des données
npm run build    # génère docs/index.html
```

Le site est publié depuis le dossier `docs/` par GitHub Pages.

## Données

Les entrées sont vérifiées contre Wikidata (`npm run verify`).

## Licences

Carte : jsvectormap, licence MIT (`vendor/LICENSE-jsvectormap`).
