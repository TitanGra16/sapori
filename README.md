# 🍴 Sapori — Il Tuo Ricettario Personale

**Sapori** è una Progressive Web App (PWA) per gestire le tue ricette preferite. Funziona offline, è installabile su qualsiasi dispositivo e salva tutti i dati localmente.

## ✨ Funzionalità

- 📝 **Crea e modifica ricette** con ingredienti, passaggi, foto e altro
- 🔍 **Cerca e filtra** per nome, categoria o ordinamento
- ❤️ **Preferiti** per tenere a portata di mano le ricette del cuore
- 📸 **Foto delle ricette** con compressione automatica
- 🌙 **Tema scuro** e palette colori personalizzabili
- 📦 **Esporta e importa** le tue ricette in formato JSON
- 📱 **Installabile** come app su smartphone e desktop
- 🔒 **Offline** — funziona senza connessione internet
- 🇮🇹 **Interfaccia in italiano**

## 📱 Installazione come PWA

### Su smartphone (Android / iOS)
1. Apri l'app nel browser (Chrome, Safari, Edge)
2. Tocca il menu del browser (⋮ o condividi)
3. Seleziona **"Aggiungi alla schermata Home"** / **"Installa app"**
4. Conferma l'installazione

### Su desktop (Chrome / Edge)
1. Apri l'app nel browser
2. Clicca sull'icona di installazione nella barra degli indirizzi
3. Conferma l'installazione

## 🛠️ Tecnologie

| Tecnologia | Utilizzo |
|---|---|
| **HTML5** | Struttura semantica |
| **CSS3** | Custom Properties, Grid, Flexbox, animazioni |
| **JavaScript ES6+** | Logica applicativa, moduli |
| **IndexedDB** | Database locale per ricette e impostazioni |
| **Service Worker** | Cache offline e strategia di aggiornamento |
| **Web App Manifest** | Installabilità PWA |

## 📁 Struttura del progetto

```
cucina/
├── index.html          # Shell dell'applicazione SPA
├── manifest.json       # Manifest PWA
├── sw.js               # Service Worker
├── css/
│   ├── variables.css   # Variabili CSS e temi
│   ├── base.css        # Stili base e reset
│   ├── components.css  # Componenti UI
│   └── animations.css  # Animazioni e transizioni
├── js/
│   ├── db.js           # Modulo IndexedDB
│   ├── utils.js        # Utility e helpers
│   ├── theme.js        # Gestione temi
│   ├── recipes.js      # Logica ricette e validazione
│   ├── views.js        # Rendering delle viste
│   └── app.js          # Controller principale
└── icons/
    ├── icon-192.png    # Icona PWA 192x192
    └── icon-512.png    # Icona PWA 512x512
```

## 📸 Screenshot

> _Aggiungi qui gli screenshot dell'app_

## 📄 Licenza

Distribuito sotto licenza [MIT](https://opensource.org/licenses/MIT).

---

Creato con ❤️ in Italia
