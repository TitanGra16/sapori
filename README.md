# 🍴 Sapori — Il tuo ricettario personale

Sapori è una Progressive Web App in italiano per creare, organizzare, cucinare
e stampare ricette. Funziona offline e conserva ricette e
preferenze esclusivamente nel browser tramite IndexedDB.

Provala online: [titangra16.github.io/sapori](https://titangra16.github.io/sapori/)

## Funzionalità

- Creazione e modifica con ingredienti, quantità, note, passaggi e foto.
- Ricerca senza distinzione di accenti su tutti i campi, inclusa la conservazione.
- Filtri per categoria, preferiti e ordinamento.
- Modalità Svuotafrigo con confronto per ingredienti.
- Modalità cottura con timer persistente, avanzamento, wake lock e controlli da tastiera.
- Tema chiaro/scuro e sette palette con contrasti accessibili.
- Esportazione diretta in PDF/stampa della singola ricetta e ricettario completo.
- Backup versione 2 con data dell’ultima esportazione, ricette, categorie e tema.
- Schermata account con preparazione locale e coda leggera per la futura sincronizzazione.
- Installazione PWA, uso offline e aggiornamenti senza versioni miste in cache.

## Dati e backup

Le ricette non vengono inviate a un server: restano nel database locale del
browser. Cancellare i dati del sito o usare una pulizia completa del browser può
eliminarle. È quindi consigliato creare periodicamente un **Backup JSON** dalla
pagina Impostazioni.

Il pulsante **Attiva sincronizzazione** prepara soltanto il dispositivo: crea una
coda locale per contenuto, preferiti, foto e categorie, senza duplicare le immagini
e senza inviare richieste esterne. Account e cloud non sono ancora collegati; la
coda servirà in seguito per integrare Supabase senza perdere le ricette esistenti.

L’importazione mostra un’anteprima e permette di:

- unire dati, aggiornando gli ID esistenti e ignorando i duplicati;
- sostituire il ricettario in una singola transazione;
- ripristinare categorie personalizzate e preferenze del tema.

## Avvio locale

Il progetto non richiede una build. Serve però un server HTTP, perché service
worker e PWA non funzionano aprendo direttamente `index.html` dal filesystem.

```bash
python -m http.server 8000
```

Poi apri `http://127.0.0.1:8000/`.

## Test e controlli

Richiede Node.js 22 o successivo.

```bash
npm install
npx playwright install chromium
npm run check
npm test
npm run test:e2e
```

`npm run test:all` esegue controlli statici, test unitari e test browser.
Playwright prova i flussi principali su telefono compatto, smartphone moderno,
tablet e desktop. Comprende inoltre una prova PWA con service worker reale,
navigazione offline e generazione di un PDF A4 effettivo. Lo stesso comando può
essere usato in una pipeline CI.

## Struttura

```text
sapori/
├── index.html
├── manifest.json
├── sw.js
├── css/
│   ├── variables.css
│   ├── base.css
│   ├── components.css
│   ├── animations.css
│   └── pages/
│       └── account.css
├── js/
│   ├── bootstrap-theme.js
│   ├── db.js
│   ├── utils.js
│   ├── theme.js
│   ├── recipes.js
│   ├── icons.js
│   ├── account/
│   │   └── account-view.js
│   ├── sync/
│   │   └── sync-preparation.js
│   ├── views.js
│   └── app.js
├── icons/
├── scripts/
└── tests/
    ├── unit/
    └── e2e/
```

## Sicurezza e compatibilità

- I contenuti inseriti dall’utente vengono sottoposti a escaping prima del rendering.
- Le immagini accettate sono JPEG, PNG o WebP e vengono validate e compresse.
- La Content Security Policy consente script e connessioni solo dalla stessa origine.
- I font sono locali al sistema, quindi l’interfaccia non dipende da servizi esterni.
- Le aree sicure iOS, la tastiera, il focus nelle modali e le preferenze di movimento
  ridotto sono gestite dall’interfaccia.

## Licenza

Distribuito con licenza [MIT](./LICENSE).
