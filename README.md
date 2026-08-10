# 🍴 Sapori — Il tuo ricettario personale

Sapori è una Progressive Web App in italiano per creare, organizzare e consultare ricette.
Funziona anche offline e conserva ricette e preferenze localmente nel browser tramite IndexedDB.

**Demo:** https://titangra16.github.io/sapori/

## Nota sullo sviluppo

Questo progetto è stato sviluppato con un uso significativo di strumenti AI.

Ho usato l'AI soprattutto come supporto per trasformare l'idea iniziale in un'applicazione funzionante,
iterare sulle funzionalità, fare debugging, testare il comportamento dell'applicazione e approfondire
progressivamente il codice prodotto.

Il progetto rappresenta quindi sia un'applicazione completa sia un percorso di apprendimento.
Non considero automaticamente tutte le tecnologie presenti nel repository come competenze che padroneggio
in piena autonomia.

## Funzionalità principali

- Creazione e modifica di ricette con ingredienti, quantità, note, passaggi e foto
- Ricerca e filtri per categoria e preferiti
- Modalità **Svuotafrigo** con confronto per ingredienti
- Modalità cottura con timer persistente e wake lock
- Tema chiaro/scuro e palette personalizzabili
- Backup e ripristino tramite JSON
- Stampa / esportazione PDF delle ricette
- Installazione PWA e utilizzo offline

## Dati e backup

Le ricette non vengono inviate a un server: restano nel database locale del browser.
La cancellazione dei dati del sito può quindi rimuoverle.

È possibile creare un **backup JSON** dalla pagina Impostazioni e successivamente:

- unire i dati con quelli esistenti;
- sostituire il ricettario;
- ripristinare categorie e preferenze del tema.

La sezione di sincronizzazione prepara solamente una coda locale.
Account e cloud non sono ancora collegati.

## Avvio locale

Il progetto non richiede una build, ma deve essere servito tramite HTTP perché service worker e PWA
non funzionano aprendo direttamente `index.html`.

```bash
python -m http.server 8000
```

Poi apri:

```text
http://127.0.0.1:8000/
```

## Test

Richiede Node.js 22 o successivo.

```bash
npm install
npx playwright install chromium
npm run check
npm test
npm run test:e2e
```

`npm run test:all` esegue controlli statici, test unitari e test browser.

I test E2E verificano i principali flussi su diversi form factor e includono anche controlli
sul funzionamento PWA/offline.

## Sicurezza e compatibilità

- Escaping dei contenuti inseriti dall'utente prima del rendering
- Validazione e compressione delle immagini JPEG, PNG e WebP
- Content Security Policy limitata alla stessa origine
- Gestione del focus, preferenze reduced-motion e safe area iOS

## Licenza

Distribuito con licenza [MIT](./LICENSE).
