# Cite 3 chinois

Tape le nom d'une personnalité encore vivante. Le pays s'allume sur la carte. Trois noms, et il est à toi.

Combien de pays peux-tu remplir avec des gens que tu connais vraiment ?

**[Jouer maintenant](https://amelienito.github.io/cite-trois-chinois/)**

---

## Le principe

- Un nom suffit : le pays est trouvé tout seul, pas de menu à parcourir.
- Trois personnalités d'un même pays, et il est complet. Les demi-points existent pour les doubles origines.
- Un défi du jour, le même pour tout le monde, qui donne un coup de main pour la partie libre.
- Des succès secrets. On ne dira pas lesquels.

Les célébrités ont toutes une chose en commun : elles sont encore là. Les autres ont droit à un hommage discret, pas à un point.

<details>
<summary>Côté code</summary>

<br>

Node 20 ou plus.

```
npm run check    # contrôle des données
npm run build    # génère docs/index.html
```

Le site est publié depuis le dossier `docs/` par GitHub Pages. Les entrées sont vérifiées contre Wikidata (`npm run verify`).

Carte : jsvectormap, licence MIT (`vendor/LICENSE-jsvectormap`).

</details>
