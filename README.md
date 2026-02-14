# Subnet Sprint

Mini-jeu web pour s’entraîner aux conversions de masques réseau.

- **CIDR ↔ décimal**
- Masques valides : **/8 à /30**
- Progression par niveaux, vies, timer, bonus et score
- Aucun NetID répété dans les **3 dernières questions**

## Fichiers

- `index.html`
- `style.css`
- `script.js`

## Règles

- Une question est affichée : CIDR ou décimal.
- Tu donnes l’équivalent dans l’autre notation.
- **Bonne réponse** : `score += temps_restant(s) × niveau`.
- **Bonus rapide** (zone bonus) :
  - Si vies < 9 : +1 vie.
  - Si vies = 9 : gain de points **x2**.
- **Mauvaise réponse** : -1 vie + malus `temps_restant(s) × niveau`.
- **Temps écoulé** : -1 vie.
- **Pause** : -10% du temps total du niveau (segment rouge perdu à la reprise).
- 10 bonnes réponses = niveau suivant (temps plus court).

## UI

- Vies en **9 cases** :
  - Actives = rouges.
  - Perdues = transparentes.
  - 9e active = jaune brillante (mode x2).
- Barre de temps bleue + segments bonus à droite :
  - `78-80, 80-82, ..., 94-96, 96-100`.
  - Halo externe sur segments bonus actifs.
  - Extinction progressive selon le palier du niveau.
  - En pause : segment rouge = malus (retiré à la reprise).
- Bouton **Mode** (clair/sombre) en haut.
- Indicateur **x2** à côté de “Score” quand la 9e vie est atteinte.