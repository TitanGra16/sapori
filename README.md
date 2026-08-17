# 🍴 Sapori — Il tuo ricettario personale

Sapori è una Progressive Web App in italiano per creare, organizzare e consultare ricette.
Funziona anche offline e conserva ricette e preferenze localmente nel browser tramite IndexedDB.

**Demo attuale:** https://titangra16.github.io/sapori/

**Nuova distribuzione Cloudflare Pages:** https://sapori-ricette.pages.dev/

Il passaggio al nuovo dominio è intenzionalmente graduale: IndexedDB e le sessioni sono separate per origine.
Prima di usare Cloudflare Pages come indirizzo principale, crea un backup JSON e verifica il ricettario
sincronizzato su tutti i dispositivi.

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
- Sincronizzazione facoltativa fra dispositivi tramite account Google e Supabase
- Installazione PWA e utilizzo offline

## Dati e backup

Le ricette restano prima di tutto nel database locale del browser. La cancellazione dei dati del sito
può quindi rimuoverle se non esiste un backup o una copia sincronizzata.

È possibile creare un **backup JSON** dalla pagina Impostazioni e successivamente:

- unire i dati con quelli esistenti;
- sostituire il ricettario;
- ripristinare categorie e preferenze del tema.

La sincronizzazione è facoltativa e separata in passaggi espliciti: preparazione della coda locale,
accesso Google e primo avvio manuale. L'app continua a funzionare offline e non invia ricette
prima che l'utente completi questi passaggi.

## Uso multiutente

Sapori accetta nuovi utenti tramite Google. Ogni account possiede un ricettario cloud privato:
le policy RLS, le RPC con controllo dell'account atteso e i percorsi Storage separati impediscono
a un utente di leggere o modificare ricette e fotografie appartenenti a un altro account.

Per proteggere il piano gratuito senza impedire l'uso normale, il backend applica limiti di uso equo
per singolo account: fino a 1.500 ricette cloud attive, 20 MiB di contenuto testuale, 50 MiB e
120 fotografie. Le ricette continuano sempre a essere salvate localmente; se un limite cloud viene
raggiunto, l'app conserva la modifica nella coda o la segnala come riprovabile dopo aver liberato spazio.

Il supporto multiutente indica account privati indipendenti. Non è ancora presente la condivisione
collaborativa dello stesso ricettario fra persone diverse.

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
- Content Security Policy limitata all'app e all'origine Supabase configurata
- Gestione del focus, preferenze reduced-motion e safe area iOS

## Licenza

Distribuito con licenza [MIT](./LICENSE).
