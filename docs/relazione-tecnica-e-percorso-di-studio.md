# Sapori: relazione tecnica completa e percorso di studio

## 1. Scopo e stato di questa relazione

Questo documento descrive l’architettura del progetto Sapori così come risulta dal repository corrente. Non è una presentazione generica: ogni sezione è ricavata dall’ispezione diretta dei file applicativi, dei fogli di stile, delle migrazioni SQL, degli script di distribuzione e dei test presenti.

La fotografia tecnica è la seguente:

- applicazione web progressiva in JavaScript vanilla, senza framework applicativo e senza bundler;
- interfaccia a pagina singola basata su rotte hash;
- persistenza locale principale in IndexedDB;
- archivio IndexedDB separato per le bozze;
- funzionamento locale e offline indipendente dal cloud;
- autenticazione Google gestita da Supabase Auth con flusso PKCE;
- sincronizzazione incrementale local-first verso PostgreSQL e Storage di Supabase;
- build statica a lista consentita per Cloudflare Pages;
- test unitari con Node e test end-to-end con Playwright.

Importante: in questa fase **non è stata eseguita la full suite di test**. La presenza dei test e la loro copertura sono state analizzate, ma questo documento non certifica che l’intera suite sia attualmente verde. Nel checkout corrente la cartella <code>.github/workflows</code> esiste, ma non contiene workflow tracciati: non si può quindi considerare attiva una CI GitHub Actions sulla sola base dei file oggi presenti.

### 1.1 Stato operativo verificato il 17 agosto 2026

La parte infrastrutturale preparata in questa fase non è rimasta soltanto nel repository:

- le migrazioni Supabase, incluse <code>20260809223000_rinforza_account_e_ripristino_ricette.sql</code> e <code>20260817190000_protegge_uso_multiutente.sql</code>, risultano applicate e registrate sul progetto remoto;
- le RPC pubbliche espongono le firme attese, mentre le funzioni v1 interne sono nello schema privato e non eseguibili dal ruolo <code>authenticated</code>;
- Cloudflare Pages è collegato a <code>TitanGra16/sapori</code>, branch di produzione <code>Main</code>, con build <code>npm run check &amp;&amp; npm run build:site</code> e output <code>dist</code>;
- il deployment di produzione è raggiungibile su <code>https://sapori-ricette.pages.dev/</code>;
- l’URL Pages esatto è presente fra i redirect consentiti di Supabase Auth, senza rimuovere l’origine GitHub Pages usata durante la transizione;
- lo smoke test del deployment ha verificato risposta HTTP 200, CSP, manifest, service worker, home, impostazioni, schermata account e preparazione locale della sincronizzazione senza errori JavaScript bloccanti.

Non sono invece stati eseguiti automaticamente il login Google reale, il primo collegamento del ricettario, il confronto fra due dispositivi e la full suite. Sono verifiche che coinvolgono l’account e i dati reali e restano nella checklist finale.

## 2. La scelta architetturale fondamentale: local-first

Sapori è progettata affinché il browser sia il primo luogo in cui i dati vengono creati e conservati. Il cloud è un livello aggiuntivo di replica e sincronizzazione, non una dipendenza per usare il ricettario.

Questo principio produce quattro proprietà importanti:

1. dopo almeno un caricamento online riuscito e il salvataggio della shell nel service worker, l’app si apre e consente di leggere o modificare ricette anche senza rete;
2. un salvataggio locale non deve attendere Supabase;
3. le modifiche da inviare vengono rappresentate in una coda persistente;
4. un problema di autenticazione o rete degrada la sincronizzazione, non il ricettario locale.

Il bootstrap in <code>js/app.js</code> rende concreta questa scelta: inizializza prima IndexedDB, categorie, tema, router ed eventi; avvia account e sincronizzazione in sottofondo solo dopo che il nucleo locale è operativo.

### 2.1 Flusso generale

~~~mermaid
flowchart LR
    UI["Interfaccia e router<br>app.js + views.js"] --> DOMAIN["Logica ricette<br>recipes.js"]
    UI --> DB["IndexedDB SaporiDB v4<br>db.js"]
    UI --> DRAFTS["IndexedDB SaporiDraftsDB<br>drafts/*"]
    DB --> QUEUE["Coda e stato sync<br>syncQueue, syncMeta"]
    QUEUE --> ENGINE["Motore sync<br>sync-engine.js"]
    ENGINE --> AUTH["Sessione PKCE<br>auth/*"]
    ENGINE --> RPC["RPC Supabase<br>PostgreSQL"]
    ENGINE --> STORAGE["Storage privato<br>recipe-images"]
    DB --> PRINT["Documento di stampa<br>print/*"]
    SW["Service worker<br>sw.js"] --> UI
~~~

### 2.2 Cosa significa “salvato”

Nel progetto esistono livelli diversi che non vanno confusi:

- **bozza salvata**: il form incompleto è stato scritto in <code>SaporiDraftsDB</code>;
- **ricetta salvata localmente**: il dato valido è stato scritto in <code>SaporiDB</code>;
- **modifica accodata**: la stessa transazione locale ha registrato un riferimento in <code>syncQueue</code>;
- **modifica sincronizzata**: Supabase ha applicato l’operazione, lo shadow locale è avanzato e la coda ha confermato l’operazione;
- **backup creato**: l’utente ha scaricato un file JSON autonomo.

La sincronizzazione non sostituisce il backup: protegge dall’uso su più dispositivi, mentre un backup esportato resta utile contro errori logici, cancellazioni volontarie o problemi dell’account cloud.

## 3. Mappa del repository

| Percorso | Responsabilità |
|---|---|
| <code>index.html</code> | Shell HTML, meta PWA e CSP, contenitori globali, ordine di caricamento CSS e script |
| <code>manifest.json</code> | Metadati di installazione PWA, scope, icone e colori |
| <code>sw.js</code> | Precache atomico della shell, navigazione offline e aggiornamento controllato |
| <code>js/app.js</code> | Bootstrap, stato UI, router, delega eventi, form, modalità cucina, import/export e integrazione dei moduli |
| <code>js/views.js</code> | Rendering HTML delle viste principali e dei dialoghi |
| <code>js/recipes.js</code> | Modello di dominio: limiti, validazione, ricerca, ordinamento, export e Svuotafrigo |
| <code>js/db.js</code> | Wrapper IndexedDB v4, CRUD ricette, immagini, categorie, backup e import |
| <code>js/drafts/</code> | Schema, archivio, autosalvataggio, identità e catalogo delle bozze |
| <code>js/auth/</code> | Configurazione del client, sessione, PKCE Google, refresh e logout |
| <code>js/account/</code> | Stato aggregato e UI di account/sincronizzazione |
| <code>js/sync/</code> | Preparazione, coda, serializzazione, trasporto, shadow, conflitti e motore cloud |
| <code>js/print/</code> | Template stampabile, ricettario, preparazione risorse e progresso |
| <code>js/data/storage-health.js</code> | Diagnostica quota locale e richiesta esplicita di persistenza |
| <code>js/utils.js</code> | ID, date, immagini, escape HTML, quantità, download e helper comuni |
| <code>js/theme.js</code> | Tema chiaro/scuro e palette persistenti |
| <code>js/bootstrap-theme.js</code> | Applicazione sincrona del tema prima dei CSS, contro il flash visivo |
| <code>css/variables.css</code> | Token del design system e palette |
| <code>css/base.css</code> | Reset, tipografia, focus e utility |
| <code>css/components.css</code> | Layout e componenti condivisi |
| <code>css/pages/</code> | Stili dedicati a cucina, account, bozze e protezione dati |
| <code>css/print/print.css</code> | Layout A4 e regole di stampa |
| <code>supabase/migrations/</code> | Schema, RLS, Storage e RPC versionate |
| <code>supabase/config.toml</code> | Configurazione dello stack Supabase locale |
| <code>deploy/cloudflare/</code> | Header di sicurezza/cache e istruzioni Pages |
| <code>scripts/check-project.cjs</code> | Controlli statici, asset PWA e revisione della shell |
| <code>scripts/build-site.cjs</code> | Build statica sicura e atomica in <code>dist</code> |
| <code>tests/unit/</code> | Test unitari Node |
| <code>tests/e2e/</code> | Test browser Playwright su più viewport e flussi |

## 4. Bootstrap, ordine degli script e router

### 4.1 Perché l’ordine in index.html è importante

Non essendoci moduli ES né bundler, i file espongono API su <code>window</code>. L’ordine degli script in <code>index.html</code> è quindi una dipendenza reale:

1. configurazione e libreria Supabase;
2. moduli auth;
3. moduli bozze e diagnostica;
4. preparazione sync;
5. moduli stampa;
6. database e utility;
7. dominio ricette e icone;
8. resto della sincronizzazione;
9. account;
10. viste;
11. controller principale.

Se un file viene spostato senza verificare le dipendenze globali, l’app può fallire a runtime anche se ogni singolo script supera il controllo sintattico.

### 4.2 Sequenza di avvio

La funzione <code>init()</code> in <code>js/app.js</code> esegue:

1. <code>DB.init()</code>;
2. caricamento delle categorie personalizzate;
3. <code>Theme.init()</code>;
4. installazione del router;
5. installazione della delega eventi;
6. gestione accessibile dei modali;
7. avviso sulla protezione dei dati;
8. rendering della rotta corrente;
9. inizializzazione asincrona di account e sync;
10. ripristino di un’eventuale sessione cucina;
11. pulizia delle bozze scadute;
12. registrazione del service worker.

Se l’inizializzazione locale fallisce, viene mostrata una vista di errore con possibilità di ricaricare. Un errore cloud, invece, non deve sostituire questa vista.

### 4.3 Router a hash

Il router interpreta <code>location.hash</code> e supporta:

- <code>#home</code>;
- <code>#create/&lt;draftId&gt;</code>;
- <code>#edit/&lt;recipeId&gt;/&lt;draftId&gt;</code>;
- <code>#detail/&lt;recipeId&gt;</code>;
- <code>#favorites</code>;
- <code>#drafts</code>;
- <code>#settings</code>;
- <code>#account</code>;
- <code>#pantry</code>.

L’uso di hash evita la necessità di rewrite server per una SPA statica. È adatto sia a GitHub Pages sia a Cloudflare Pages.

<code>routeToken</code> impedisce a un rendering asincrono lento di sovrascrivere una rotta più recente. Le viste che leggono IndexedDB vengono prima composte in un contenitore temporaneo e applicate al DOM solo se il token è ancora valido.

### 4.4 Responsabilità di app.js e views.js

<code>js/views.js</code> produce markup e mantiene funzioni di rendering per home, form, dettaglio, preferiti, impostazioni, Svuotafrigo, modalità cucina e modali.

<code>js/app.js</code> conserva lo stato mutabile e gestisce:

- navigazione;
- delega degli eventi tramite attributi <code>data-action</code>;
- raccolta e validazione del form;
- caricamento e compressione foto;
- salvataggio e cancellazione;
- importazione e backup;
- stampa;
- sessione cucina;
- autosalvataggio delle bozze;
- aggiornamenti provenienti dalla sync.

Questa separazione è buona ma non totale: <code>app.js</code> è ancora un controller molto ampio. Un refactor futuro dovrebbe dividerlo per casi d’uso, senza riscrivere il modello dati.

### 4.5 Accessibilità integrata

Il controller:

- annuncia il cambio di pagina con una live region;
- sposta il focus sul titolo della nuova vista;
- aggiorna il titolo del documento;
- applica <code>inert</code> al contenuto dietro un modale;
- intrappola il focus nel dialogo;
- ripristina il focus alla chiusura;
- gestisce Escape e Tab;
- usa <code>aria-busy</code> durante i caricamenti;
- mantiene i controlli dinamici identificabili tramite <code>data-action</code>.

Questi comportamenti sono parte della logica e non vanno persi in un eventuale refactor dell’interfaccia.

## 5. CSS, responsive design e modalità cucina

### 5.1 Design system

<code>css/variables.css</code> definisce:

- colori semantici;
- sfondi e testi;
- spaziature;
- raggi;
- ombre;
- transizioni;
- famiglie tipografiche locali di sistema;
- livelli di z-index;
- sette palette, ciascuna in modalità chiara e scura.

L’assenza di font web esterni è intenzionale: evita dipendenze di rete e preserva l’offline.

<code>css/base.css</code> stabilisce una base di 16 px, tipografia fluida tramite <code>clamp()</code>, focus visibile e correzione dell’ingrandimento automatico del testo mobile.

### 5.2 Strategia responsive

Il layout parte dal telefono e amplia progressivamente:

- contenuto a colonna singola sui viewport stretti;
- griglie auto-adattive per le card;
- breakpoint intermedi per tablet;
- layout più ricchi oltre 768, 960 e 1024 px;
- safe area tramite <code>env(safe-area-inset-*)</code>;
- target tattili generalmente di almeno 44–45 px;
- <code>minmax(0, 1fr)</code>, <code>overflow-wrap</code> e limiti di larghezza per evitare overflow.

La barra inferiore e l’header sono fissi; <code>#app-content</code> compensa la loro altezza, incluse le safe area.

### 5.3 Modalità cucina

La vista è generata da <code>Views.showCookingModal()</code> e governata da <code>state.cooking</code> in <code>js/app.js</code>. Include:

- passaggio corrente e note;
- avanzamento e selettore rapido dei passaggi;
- ingredienti spuntabili;
- timer con pausa/ripristino;
- vibrazione e segnale audio;
- Screen Wake Lock quando disponibile;
- swipe tra i passaggi;
- ripristino della sessione da <code>localStorage</code> per un massimo di otto giorni.

<code>css/pages/cooking.css</code> rende il dialogo a schermo intero sotto 600 px. Il corpo è l’unica area verticale scorrevole e usa <code>min-height: 0</code>, condizione fondamentale in un layout flex per evitare che il contenuto spinga fuori footer e controlli.

Le correzioni mobile specifiche sotto 600 px prevedono:

- testo del passaggio fluido fra circa 1,2 e 1,4 rem;
- note a 1 rem, contrasto sul testo principale e interlinea 1,55;
- spezzatura sicura di parole e contenuti lunghi;
- minimappa dei passaggi orizzontale e scorrevole;
- pannelli non compressi in modo distruttivo;
- controlli da almeno 45 px;
- footer compatto con safe area;
- testo del wake lock nascosto visivamente sotto 390 px, lasciando l’etichetta accessibile.

Il test dedicato è <code>tests/e2e/cooking-mobile.spec.cjs</code> e dichiara esplicitamente viewport fra 360 e 430 px. In questa fase non è stato rieseguito.

### 5.4 Rischi CSS residui

- <code>css/components.css</code> rimane molto grande e contiene numerose responsabilità. Non è un bug, ma aumenta il costo di modifica.
- Alcuni stili sono ancora generati inline nelle viste. La CSP deve quindi conservare <code>style-src 'unsafe-inline'</code>.
- I breakpoint sono numerosi; nuove componenti vanno provate almeno a 320, 360, 390, 430, 768, 820, 1024 e 1280 px.
- Hover e animazioni non devono essere l’unico feedback: sui touch device servono stati attivi e attributi ARIA.

## 6. Modello locale: SaporiDB v4

<code>js/db.js</code> apre <code>SaporiDB</code> versione 4.

| Object store | Chiave | Contenuto |
|---|---|---|
| <code>recipes</code> | <code>id</code> | Metadati e contenuto della ricetta, miniatura, versioni dei canali |
| <code>images</code> | <code>recipeId</code> | Foto completa come data URL |
| <code>settings</code> | <code>key</code> | Categorie, tema, palette e metadati locali |
| <code>syncQueue</code> | <code>entityKey</code> | Operazioni compatte da inviare |
| <code>syncMeta</code> | <code>key</code> | Stato preparazione, account, lease, cursore e cleanup |
| <code>syncShadow</code> | <code>entityKey</code> | Ultima versione server nota per canale |
| <code>syncConflicts</code> | <code>id</code> | Conflitti conservati e loro stato |

Gli indici di <code>recipes</code> coprono nome, categoria, data di creazione e preferito. La coda dispone di indici per stato, tentativo, proprietario, scadenza lease e ID operazione.

### 6.1 Foto separate dai metadati

La foto completa non viene mantenuta nel record principale. <code>db.js</code>:

1. valida il data URL;
2. crea una miniatura JPEG, normalmente a 360 px;
3. salva la miniatura in <code>recipes</code>;
4. salva la foto completa in <code>images</code>.

La lista ricette può così leggere record leggeri. Il dettaglio, il backup e la stampa recuperano la foto completa solo quando serve. All’avvio è prevista anche la migrazione delle vecchie immagini incorporate nei record.

Limiti locali rilevanti:

- import massimo 50 MB;
- massimo 5.000 ricette per file;
- massimo 100 categorie personalizzate;
- data URL immagine massimo 7 MB circa;
- timestamp importati non oltre 24 ore nel futuro.

### 6.2 Transazioni atomiche e coda

Le operazioni di creazione, modifica, preferito, cancellazione, categorie e import aprono transazioni che includono sia i dati sia gli store della sincronizzazione. Questo evita lo stato pericoloso “ricetta salvata ma modifica non accodata”.

Esempio concettuale:

~~~text
transazione IndexedDB
  aggiorna recipes
  aggiorna images se necessario
  inserisce/compatta syncQueue
  commit unico
~~~

Se la sync non è stata preparata, le funzioni di accodamento leggono <code>syncMeta</code> nella stessa transazione e non creano operazioni. Dopo l’attivazione, la decisione non dipende da una variabile in memoria potenzialmente obsoleta.

### 6.3 CRUD e versioni locali

Ogni ricetta ha canali versionati separatamente:

- <code>contentVersion</code>;
- <code>favoriteVersion</code>;
- <code>imageVersion</code>.

Separare il preferito dal contenuto impedisce che un click sul cuore riscriva testo o foto. Separare la foto evita upload quando cambia solo una nota.

### 6.4 Backup JSON e import

Il backup prodotto da <code>DB.exportData()</code> usa formato versione 2 e include:

- ricette normalizzate;
- foto complete;
- categorie personalizzate;
- tema e palette;
- data e conteggio.

L’import accetta:

- backup completi;
- array di ricette;
- singola ricetta.

Prima del commit:

- limita dimensione e quantità;
- normalizza tipi e timestamp;
- valida le ricette;
- filtra categorie riservate;
- calcola aggiunte, aggiornamenti, duplicati, conflitti e rifiuti.

Modalità <code>merge</code>:

- conserva definizioni locali delle categorie in caso di stesso ID;
- aggiorna ricette con ID coincidente solo quando appropriato;
- non sovrascrive con contenuto più vecchio;
- applica separatamente un cambiamento del preferito;
- deduplica per impronta di contenuto.

Modalità <code>replace</code>:

- sostituisce ricette e foto nella stessa transazione;
- accoda tombstone per gli ID rimossi;
- sostituisce le categorie soltanto quando il payload contiene esplicitamente <code>settings.customCategories</code> o <code>customCategories</code>; un array o una singola ricetta senza quel campo lascia invariate le categorie locali.

### 6.5 Salute dello storage

<code>js/data/storage-health.js</code> legge <code>navigator.storage.estimate()</code> e <code>persisted()</code> con timeout brevi. La richiesta <code>persist()</code> avviene solo dopo un gesto esplicito dell’utente.

Le soglie sono:

- sano sotto il 75%;
- avviso dal 75%;
- critico dal 90%.

Questa API è diagnostica e non garantisce che il browser conceda storage persistente.

## 7. Dominio ricette, categorie e Svuotafrigo

<code>js/recipes.js</code> è il modulo di dominio indipendente dal DOM.

### 7.1 Campi e limiti

Una ricetta comprende:

- nome;
- categoria;
- descrizione;
- note;
- conservazione;
- ingredienti con quantità, unità e note;
- passaggi con testo e note;
- preparazione e cottura;
- difficoltà;
- porzioni;
- foto;
- preferito;
- timestamp e versioni.

I limiti sono applicati sia dal form sia dalla validazione. Tra i principali: nome 120 caratteri, descrizione 2.000, note 4.000, conservazione 1.000, fino a 100 ingredienti e 100 passaggi.

### 7.2 Categorie

Le categorie integrate sono antipasti, primi, secondi, contorni, dolci, bevande e altro. Le categorie personalizzate hanno:

- ID normalizzato;
- etichetta;
- icona;
- colore;
- flag <code>isCustom</code>.

Gli ID integrati sono riservati. Eliminare una categoria personalizzata riassegna in modo atomico le ricette a <code>altro</code> e accoda sia le ricette modificate sia le categorie.

### 7.3 Ricerca e ordinamento

La ricerca:

- rimuove gli accenti;
- usa il locale italiano;
- cerca in nome, descrizione, note, conservazione, categoria, ingredienti e passaggi;
- richiede che tutti i token digitati siano presenti.

Gli ordinamenti coprono data, nome e tempo totale. Le durate mancanti finiscono in fondo negli ordinamenti temporali.

### 7.4 Svuotafrigo

<code>Recipes.matchPantry()</code> confronta token interi normalizzati, ordina per percentuale di ingredienti disponibili e distingue ricette complete da ricette con mancanti. Non è un motore semantico: sinonimi e plurali non sempre convergono. Un’estensione futura dovrebbe aggiungere un dizionario locale, non necessariamente un servizio AI.

## 8. Sistema bozze

Le bozze sono volutamente separate dal database delle ricette valide.

### 8.1 SaporiDraftsDB

<code>js/drafts/draft-store.js</code> apre <code>SaporiDraftsDB</code> versione 1, store <code>drafts</code>, con indici su scadenza, aggiornamento e modalità.

Chiavi:

- <code>create:&lt;draftId&gt;</code>;
- <code>edit:&lt;recipeId&gt;:&lt;draftId&gt;</code>.

Ogni bozza scade dopo 30 giorni. <code>get()</code>, <code>list()</code> e <code>cleanup()</code> eliminano record scaduti in transazioni controllate.

### 8.2 Concorrenza fra schede

Ogni record ha:

- <code>writerId</code>;
- <code>revision</code>;
- <code>createdAt</code>;
- <code>updatedAt</code>;
- <code>expiresAt</code>.

<code>DraftStore.save()</code> implementa compare-and-swap tramite <code>expectedRevision</code>. Una scheda non può sovrascrivere silenziosamente una revisione più recente prodotta da un’altra scheda. Anche la rimozione è condizionale, così una chiusura tardiva non cancella dati nuovi.

### 8.3 Moduli e responsabilità

- <code>draft-schema.js</code>: normalizza payload incompleti o parzialmente corrotti senza pretendere la validità di una ricetta finale.
- <code>draft-store.js</code>: persistenza, revisioni, TTL e filtri.
- <code>draft-manager.js</code>: autosalvataggio debounced, flush, restore, discard e close.
- <code>draft-identity.js</code>: ID ricetta stabile derivato dalla bozza e confronto rigoroso.
- <code>draft-catalog.js</code>: classifica e rende l’archivio delle bozze.

L’autosalvataggio predefinito parte 600 ms dopo una modifica. Le operazioni sono serializzate per impedire inversioni fra scritture.

### 8.4 Identità stabile

Una nuova ricetta deriva un ID stabile dal <code>draftId</code>. Questo consente di:

- ricaricare il form senza cambiare identità;
- riconoscere una ricetta già salvata;
- evitare duplicati dopo errori di cleanup;
- trasformare una collisione reale in una copia separata.

Il confronto per eliminare una bozza residua è intenzionalmente severo: considera maiuscole e foto completa, non solo un’impronta permissiva da import.

### 8.5 Stati del catalogo

Il catalogo distingue:

- attiva;
- già salvata;
- conflitto di identità;
- foto da verificare;
- orfana perché la ricetta originale manca;
- non leggibile.

Un record non leggibile viene preservato e segnalato, invece di bloccare l’intero archivio o essere cancellato automaticamente.

### 8.6 Limite importante

Le bozze non sono incluse nel backup JSON e non vengono sincronizzate. È una scelta coerente con il loro ruolo temporaneo, ma va spiegata all’utente prima di cambiare dispositivo o cancellare i dati del sito.

## 9. Stampa e salvataggio PDF

La funzione “PDF” usa il dialogo di stampa del browser. Non genera un PDF binario con una libreria: prepara un DOM ottimizzato per A4 e chiama <code>window.print()</code>.

### 9.1 Moduli

- <code>print-recipe-view.js</code>: template canonico della singola ricetta;
- <code>cookbook-builder.js</code>: copertina, indice e tutte le ricette;
- <code>print-service.js</code>: immagini, font, layout, annullamento, dialogo e cleanup;
- <code>print-progress-view.js</code>: avanzamento accessibile;
- <code>css/print/print.css</code>: pagine A4.

La singola ricetta e il ricettario usano lo stesso template, evitando differenze fra i due formati.

### 9.2 Composizione del documento

Ogni scheda include:

- marchio e, quando appartiene al ricettario, numero ricetta;
- categoria, titolo, descrizione e foto;
- tempi, porzioni e difficoltà;
- ingredienti;
- passaggi;
- note;
- conservazione solo se valorizzata.

Se la conservazione è vuota, il blocco non viene renderizzato e la sezione note occupa una sola colonna. Se le note sono vuote, vengono offerte righe scrivibili.

Il ricettario:

1. ordina per nome;
2. costruisce una copertina;
3. crea un indice numerato;
4. aggiunge le schede in lotti;
5. attende immagini e font;
6. apre il dialogo di stampa;
7. ripulisce il DOM dopo un segnale di chiusura oppure, come fallback, dopo il timeout di sicurezza.

### 9.3 Prestazioni e affidabilità

<code>PrintService.buildInBatches()</code> rilascia periodicamente il main thread. Le immagini vengono decodificate con concorrenza limitata e timeout, senza far fallire tutto per una singola foto.

La conclusione della stampa viene dedotta tramite:

- <code>afterprint</code>;
- <code>matchMedia('print')</code>;
- ritorno del focus;
- <code>visibilitychange</code>;
- timeout di sicurezza lungo, che consente il cleanup anche quando il browser non espone un evento di chiusura affidabile.

Il foglio stampa usa:

- A4 verticale;
- margini in millimetri;
- pagine nominate per copertina, indice e ricette;
- regole anti-spezzatura sugli elementi brevi;
- ricette lunghe frammentabili fra più pagine;
- colori di stampa esatti quando supportati.

### 9.4 Data, URL locale e intestazioni del browser

I template Sapori non inseriscono data di stampa, percorso <code>file:///</code> o footer tecnico. I test dedicati verificano questa pulizia.

Tuttavia Chrome, Edge e altri browser possono aggiungere autonomamente data, titolo, numero pagina e URL se nel dialogo è attiva l’opzione “Intestazioni e piè di pagina”. Una pagina web non può disabilitare in modo affidabile questa impostazione per ragioni di sicurezza. Per un PDF pulito, l’utente deve:

1. aprire “Altre impostazioni” nel dialogo di stampa;
2. disattivare “Intestazioni e piè di pagina”;
3. verificare formato A4 e scala 100%;
4. controllare i margini prima di salvare o stampare.

## 10. PWA, manifest e service worker

### 10.1 Manifest

<code>manifest.json</code> dichiara:

- nome e nome breve;
- lingua italiana;
- <code>display: standalone</code>;
- scope e start URL relativi;
- colori;
- icone normali e maskable da 192 e 512 px.

I percorsi relativi rendono la PWA compatibile sia con una sottocartella GitHub Pages sia con la root di un dominio Pages.

### 10.2 Cache della shell

<code>sw.js</code> contiene una lista <code>APP_SHELL</code> esplicita. Durante <code>install</code>:

- crea richieste con <code>cache: reload</code>;
- apre una cache legata allo scope, alla versione e a una revisione SHA-256;
- usa <code>addAll()</code>, ottenendo un’installazione atomica.

La cache installata non viene mutata con <code>cache.put()</code>. Questo impedisce di mescolare HTML nuovo e JavaScript vecchio nella stessa revisione.

Per le navigazioni, il worker preferisce la shell cache; usa la rete solo se la cache è assente. Per gli asset intercetta esclusivamente URL dichiarati e same-origin nello scope. API Supabase e URL non dichiarati restano fuori dal service worker.

### 10.3 Aggiornamento controllato

Il worker non chiama <code>skipWaiting()</code> automaticamente. <code>app.js</code> mostra un dialogo; solo la conferma dell’utente invia il messaggio <code>SKIP_WAITING</code>. Dopo <code>controllerchange</code> l’app ricarica.

In <code>activate</code> vengono eliminate solo:

- vecchie cache dello stesso scope;
- cache legacy Sapori riconosciute.

Le cache di altre applicazioni o altri scope non vengono toccate.

### 10.4 Revisione verificabile

<code>scripts/check-project.cjs</code>:

- controlla la sintassi di tutti gli script;
- valida JSON e icone;
- verifica che non esistano script inline;
- confronta gli asset HTML/manifest con <code>APP_SHELL</code>;
- rifiuta percorsi fuori progetto;
- calcola la revisione SHA-256;
- include <code>deploy/cloudflare/_headers</code> nel calcolo.

In questo modo anche una modifica agli header di sicurezza forza una nuova revisione PWA.

## 11. Autenticazione Google e sessione Supabase

### 11.1 Separazione dei moduli

- <code>supabase-config.js</code>: configurazione pubblica e validazione;
- <code>supabase-client.js</code>: istanza singleton del client;
- <code>auth-session.js</code>: stato osservabile della sessione;
- <code>auth-service.js</code>: azioni di login, logout e refresh;
- <code>account-controller.js</code>: aggregazione con preparazione e sync;
- <code>account-view.js</code>: interfaccia e messaggi.

### 11.2 PKCE

Il client viene creato con:

- <code>flowType: pkce</code>;
- refresh automatico;
- sessione persistente;
- rilevamento della sessione nell’URL;
- chiave storage dedicata.

Il login invoca Google tramite Supabase Auth con scope <code>openid email profile</code>. L’app non riceve né conserva la password Google.

Il redirect post-login viene costruito dall’origine e dalla cartella correnti, con hash di ritorno validato. Per questo ogni origine di produzione effettiva deve essere autorizzata nella configurazione Supabase Auth.

### 11.3 Chiave pubblica e segreti

La chiave publishable/anon usata nel browser **non è un segreto**. È progettata per essere distribuita nel frontend. La protezione dei dati non dipende dal nasconderla, ma da:

- JWT della sessione;
- RLS;
- policy Storage;
- permessi delle RPC;
- controllo esplicito dell’account atteso.

Non devono mai entrare nel frontend o in Git:

- Google client secret;
- service role key Supabase;
- password database;
- chiavi di firma JWT;
- token personali;
- credenziali Cloudflare.

<code>supabase/.env.example</code> contiene solo nomi e placeholder. I valori reali devono stare nel pannello Supabase o in variabili locali ignorate da Git.

### 11.4 Stati e comportamento offline

<code>AuthSession</code> espone gli stati <code>idle</code>, <code>initializing</code>, <code>authenticated</code>, <code>anonymous</code>, <code>disabled</code> e <code>unavailable</code>. La disponibilità della rete è un booleano separato; una sessione scaduta viene classificata come errore da <code>AuthService</code>. Alla UI arriva soltanto un profilo pubblico ridotto.

L’inizializzazione auth legge prima la sessione esistente. Il callback di <code>onAuthStateChange</code> rimanda gli aggiornamenti con <code>setTimeout</code> per non annidare altre chiamate nel lock interno del client Supabase.

Il logout predefinito è locale al dispositivo. Il vincolo fra archivio locale e account resta memorizzato: fare logout non deve permettere di fondere accidentalmente le stesse ricette con un altro account.

## 12. Architettura completa della sincronizzazione

La sync è divisa in sette moduli, ognuno con un confine preciso.

### 12.1 sync-preparation.js

Prepara il dispositivo senza rete:

- crea un <code>localProfileId</code>;
- crea uno <code>ownerScope</code> locale;
- marca l’intenzione di sincronizzare;
- accoda lo stato iniziale di ricette, preferiti, foto e categorie;
- installa gli store sync durante l’upgrade IndexedDB;
- coordina le schede con <code>BroadcastChannel</code>.

La preparazione è esplicita. Il primo binding all’account non deve avvenire per un timer o semplicemente al ritorno OAuth.

### 12.2 sync-queue.js

Gestisce esclusivamente la coda persistente:

- lease globale per il profilo locale;
- rinnovo e rilascio;
- claim atomico dei batch;
- conferma condizionale;
- retry con backoff esponenziale e jitter;
- rebase dopo conflitto server;
- blocco degli errori permanenti;
- recupero delle operazioni dopo crash o lease scaduto.

Una <code>entityKey</code> identifica proprietario, tipo, ID e canale. Scritture ripetute sullo stesso canale vengono compattate sull’ultima operazione.

Al primo claim, l’operazione riceve:

- il device ID stabile;
- un lease ID;
- la versione server di base ricavata dallo shadow, oppure <code>0</code> in sua assenza;
- stato <code>sending</code>.

Nei retry normali la versione di base e l’operation ID restano immutabili fino all’ack. È essenziale perché fanno parte dell’hash idempotente lato server. L’eccezione intenzionale è <code>SyncQueue.rebase()</code>: dopo un conflitto server assegna un nuovo operation ID e azzera la base, così il claim successivo può catturare la nuova versione dello shadow senza riusare una ricevuta precedente.

### 12.3 sync-serializer.js

Converte i dati locali in payload cloud limitati:

- rimuove campi interni e thumbnail;
- separa contenuto, preferito, immagine e categorie;
- normalizza stringhe e numeri;
- valida MIME e dimensione;
- costruisce path Storage nel formato proprietario/ricetta/operazione;
- converte data URL e Blob.

La foto non entra in PostgreSQL come base64. Nel database resta solo il path privato.

### 12.4 sync-transport.js

È l’adattatore di rete:

- invoca <code>apply_sync_operation</code>;
- invoca <code>pull_sync_changes</code>;
- carica, scarica ed elimina oggetti Storage;
- applica timeout;
- valida rigorosamente le risposte;
- classifica errori di rete, auth, rate limit, concorrenza, servizio e permessi.

Ogni push e pull invia anche <code>expectedOwnerId</code>. Se la sessione cambia account durante una richiesta, il server rifiuta l’operazione.

### 12.5 sync-local-store.js

Collega risposte remote e IndexedDB:

- legge il payload attuale solo dopo il claim;
- aggiorna shadow e cursore;
- applica pagine pull e cursore nella stessa transazione;
- pianifica download foto solo quando necessario;
- conserva cleanup di immagini orfane;
- registra conflitti;
- emette un evento di dati cambiati per aggiornare la UI.

Leggere il payload al momento dell’invio, anziché copiarlo nella coda, mantiene la coda leggera e invia la versione locale più recente associata a quella chiave.

### 12.6 sync-conflicts.js

Fornisce confronti deterministici e identità per i conflitti. Quando una ricetta locale sporca collide con una modifica remota che coinvolge contenuto, immagine o cancellazione:

1. la versione locale viene preservata come copia separata;
2. la modifica remota può essere applicata all’identità originale;
3. la copia viene accodata come nuova ricetta;
4. un record di conflitto resta visibile nello stato account.

Questo privilegia la non perdita dei dati rispetto a una fusione automatica potenzialmente errata. Un conflitto limitato al solo preferito viene invece normalmente ribasato, senza creare una copia completa della ricetta.

Per le categorie è disponibile un merge deterministico con limite di 100 elementi. Una UI dedicata alla risoluzione fine delle categorie non è ancora presente.

### 12.7 sync-engine.js

Il motore orchestra un ciclo:

~~~text
verifica sessione e rete
  -> verifica/prepara binding
  -> recupera lease scaduti
  -> acquisisce lease
  -> cleanup immagini pendenti
  -> pull completo
  -> push a batch
  -> pull finale
  -> cleanup finale
  -> salva esito e rilascia lease
~~~

Parametri attuali:

- lease motore: 60 secondi;
- batch push: 20 operazioni;
- massimo 5 batch per ciclo;
- pagine pull: 5 modifiche, per contenere il picco di memoria mobile;
- retry massimo: 5 minuti;
- massimo 100 pagine pull per ciclo.

Il primo pull riduce i conflitti prima di inviare. Il pull finale raccoglie l’eco delle operazioni appena applicate e le eventuali modifiche concorrenti.

Gli eventi che possono programmare un ciclo includono:

- modifica della coda;
- ritorno online;
- pagina di nuovo visibile;
- login;
- retry;
- richiesta manuale.

Se una sync manuale viene richiesta mentre un ciclo è attivo, viene accodata come ciclo manuale successivo; non viene persa.

### 12.8 UI account

<code>account-controller.js</code> aggrega:

- preparazione locale;
- configurazione Supabase;
- sessione;
- rete;
- binding;
- coda;
- conflitti;
- ultimo errore e ultima sync.

<code>account-view.js</code> traduce questo stato in messaggi comprensibili:

- solo locale;
- cloud non configurato;
- accesso richiesto;
- binding richiesto;
- account diverso;
- offline;
- in sincronizzazione;
- modifiche pendenti;
- errore;
- conflitto;
- sincronizzato.

Il primo collegamento è presentato come azione esplicita. L’interfaccia spiega che la coda locale non invia dati prima di login e avvio della sincronizzazione.

## 13. Backend Supabase

### 13.1 Tabelle

La migrazione iniziale crea:

#### public.recipes

Chiave primaria composta da <code>owner_id</code> e <code>recipe_id</code>. Contiene:

- contenuto JSON;
- preferito;
- path immagine;
- tre versioni;
- revisione globale;
- <code>deleted_at</code>;
- timestamp.

Vincoli controllano:

- formato ID;
- JSON oggetto;
- dimensione massima del contenuto;
- versioni non negative;
- revisione positiva;
- path immagine coerente con proprietario e ricetta.

#### public.user_settings

Una riga per proprietario, con categorie JSON, versione e revisione.

#### public.sync_receipts

Una ricevuta per coppia proprietario/operation ID. Memorizza:

- device;
- hash della richiesta;
- tipo, entità, canale e azione;
- risultato;
- revisione applicata;
- timestamp.

### 13.2 Revisione server

Una sequence assegna revisioni alle righe modificate. I trigger aggiornano anche <code>updated_at</code>. Il pull legge ricette e impostazioni successive al cursore, le unisce e le ordina per revisione.

Le revisioni possono avere buchi: una sequence PostgreSQL non garantisce continuità. Il cursore richiede monotonicità e ordine, non numeri consecutivi.

### 13.3 Advisory lock per account

La RPC pubblica acquisisce <code>pg_advisory_xact_lock</code> su una chiave derivata dall’account.

Perché serve: una sequence assegna il numero prima del commit. Senza serializzazione, la revisione 11 potrebbe diventare visibile prima della 10; un client che avanzasse a 11 rischierebbe di non leggere la 10. Il lock serializza le scritture dello stesso account e rende l’ordine osservabile coerente.

Account diversi non condividono lo stesso lock e possono procedere in parallelo.

### 13.4 Idempotenza

<code>apply_sync_operation</code> calcola un hash su:

- device;
- entità;
- canale;
- azione;
- versione di base;
- payload.

Se lo stesso operation ID ritorna:

- con lo stesso hash e un risultato già presente, restituisce lo stesso risultato;
- con lo stesso hash ma operazione ancora in corso, segnala concorrenza transitoria;
- con hash diverso, rifiuta il riuso.

Questa proprietà rende sicuro riprovare dopo un timeout in cui il client non sa se il server abbia già effettuato il commit.

### 13.5 Versionamento ottimistico

Ogni canale confronta <code>baseServerVersion</code> con la versione corrente. Se differiscono, la RPC restituisce <code>conflict</code> e lo stato remoto necessario al client.

Il contenuto, il preferito e la foto possono così avanzare indipendentemente.

### 13.6 Tombstone

La cancellazione non elimina subito la riga: imposta <code>deleted_at</code>, incrementa la versione del contenuto e rimuove il riferimento alla foto. Questo permette agli altri dispositivi di apprendere la cancellazione.

Il trigger più recente riduce a un oggetto JSON vuoto il contenuto di una ricetta tombstonata. ID, versioni, revisione e data di cancellazione restano disponibili per il pull, ma il testo eliminato non continua a occupare inutilmente la quota database.

La migrazione più recente consente il ripristino di un ID stabile dopo un tombstone solo se:

- l’operazione è un upsert del contenuto;
- non esiste già una ricevuta per quell’operazione;
- la versione di base coincide.

La riapertura e l’upsert avvengono nella stessa transazione; un errore annulla entrambi.

### 13.7 RLS e permessi

RLS è attiva sulle tre tabelle. I ruoli anonimo e autenticato non hanno scrittura diretta. L’utente autenticato può leggere soltanto righe con <code>owner_id = auth.uid()</code>.

Le scritture passano dalla RPC <code>security definer</code>. La vecchia implementazione è stata spostata nello schema <code>private</code> e non è eseguibile dai ruoli client.

Le RPC pubbliche:

- richiedono autenticazione;
- confrontano <code>auth.uid()</code> con <code>p_expected_owner_id</code>;
- hanno <code>search_path</code> vuoto;
- sono concesse solo al ruolo autenticato.

### 13.8 Storage privato

Il bucket <code>recipe-images</code> è privato, con limite 8 MB per file e MIME consentiti JPEG, PNG, WebP e GIF.

Le policy permettono select, insert e delete solo se la prima cartella del path coincide con <code>auth.uid()</code>. Il path include inoltre l’ID ricetta e l’operation ID, rendendo gli upload immutabili e idempotenti. Prima dell’upload il client interroga <code>check_recipe_image_upload</code>; la policy RLS ripete comunque il controllo autorevole usando la dimensione realmente registrata in <code>storage.objects.metadata</code>.

Ogni account può conservare al massimo 50 MiB e 120 oggetti fotografici. Un margine globale impedisce nuovi upload oltre 900 MiB nel bucket, lasciando spazio operativo rispetto al limite del piano gratuito. Il controllo usa un advisory lock globale, quindi due upload concorrenti non possono superare insieme il budget dopo aver letto lo stesso conteggio.

Quando un’immagine viene sostituita, il vecchio path viene inserito in una coda locale persistente di cleanup. Un errore di rimozione non invalida la ricetta e viene ritentato.

### 13.9 Migrazioni

Ordine logico:

1. <code>20260809190331_crea_schema_sincronizzazione.sql</code>: tabelle, sequence, trigger e vincoli;
2. <code>20260809190336_protegge_dati_e_fotografie.sql</code>: RLS, grants, bucket e policy;
3. <code>20260809190341_aggiunge_funzioni_sincronizzazione.sql</code>: RPC idempotenti v1;
4. <code>20260809223000_rinforza_account_e_ripristino_ricette.sql</code>: account atteso, schema privato, advisory lock e ripristino tombstone;
5. <code>20260817190000_protegge_uso_multiutente.sql</code>: quote per account, rate limit, retention delle ricevute, compattazione tombstone e controllo Storage.

### 13.10 Limiti di uso equo

L’app è aperta a più utenti, ma il progetto Supabase usa risorse condivise. La protezione non può quindi essere soltanto un messaggio nel frontend. Trigger e policy server applicano questi limiti per account:

| Risorsa | Limite | Comportamento |
|---|---:|---|
| Ricette attive cloud | 1.500 | La modifica resta locale e viene mostrato un errore correggibile |
| Righe ricetta, inclusi tombstone | 3.000 | Impedisce crescita illimitata tramite creazioni e cancellazioni ripetute |
| Contenuto JSON delle ricette | 20 MiB | Conteggio server su tutte le ricette dell’account |
| Nuove operazioni sync | 1.000/ora, 5.000/giorno | La coda effettua un retry differito |
| Ricevute conservate | 20.000 | Le ricevute applicate più vecchie di 180 giorni vengono rimosse |
| Fotografie | 50 MiB e 120 oggetti | Preflight leggibile nel client più enforcement RLS |

Questi limiti riguardano la replica cloud. IndexedDB continua a salvare la ricetta sul dispositivo prima di qualsiasi richiesta di rete. Per gli errori correggibili l’utente può rimuovere contenuti già sincronizzati e usare **Riprova sincronizzazione**, che rimette in coda le operazioni bloccate senza ricrearle.

Le migrazioni vanno considerate append-only dopo l’applicazione in produzione. Una correzione futura deve essere una nuova migrazione, non una modifica silenziosa di una già registrata.

## 14. Build e distribuzione Cloudflare Pages

### 14.1 La build non trasforma il codice

<code>npm run build:site</code> non compila o minimizza. Costruisce una cartella <code>dist</code> contenente solo:

- <code>index.html</code>;
- <code>manifest.json</code>;
- <code>sw.js</code>;
- <code>_headers</code>;
- CSS, JavaScript e icone autorizzati dalla <code>APP_SHELL</code>.

### 14.2 Lista consentita e build atomica

<code>scripts/build-site.cjs</code>:

- risolve ogni asset dentro la root del progetto;
- ammette solo CSS, JS e PNG nelle cartelle previste;
- rifiuta dotfile e symlink;
- copia in una directory temporanea;
- sostituisce <code>dist</code> solo a build completata;
- ripristina il precedente output se la sostituzione fallisce.

Questo riduce il rischio di pubblicare per errore file di test, configurazioni locali, segreti o backup.

### 14.3 Configurazione Pages

Le impostazioni documentate in <code>deploy/cloudflare/README.md</code> sono:

~~~text
Framework preset: None
Production branch: Main
Build command: npm run check && npm run build:site
Build output directory: dist
Root directory: vuota
~~~

Il repository non deve contenere token Cloudflare quando il progetto Pages usa l’integrazione Git.

### 14.4 Header

<code>deploy/cloudflare/_headers</code> applica:

- Content Security Policy;
- <code>X-Content-Type-Options: nosniff</code>;
- protezione dal framing;
- referrer policy;
- permissions policy;
- no-cache su HTML e manifest;
- no-store sul service worker;
- revalidazione di CSS e JS;
- cache moderata delle icone.

La CSP limita script e connessioni all’app e all’origine Supabase configurata. L’header può usare <code>frame-ancestors</code>, che non è efficace nella meta CSP HTML.

### 14.5 Migrazione di origine

IndexedDB, Cache Storage, service worker, localStorage e sessione auth sono isolati per origine. Passare da GitHub Pages a un dominio Cloudflare crea per il browser un’app distinta.

Procedura sicura:

1. lasciare attivo il vecchio sito;
2. creare un backup JSON su ogni dispositivo con dati unici;
3. sincronizzare ogni dispositivo sul vecchio dominio;
4. verificare che la coda sia vuota;
5. autorizzare l’URL Pages esatto in Supabase Auth;
6. accedere sul nuovo dominio;
7. verificare conteggio, foto, categorie e preferiti;
8. conservare vecchio sito e backup finché il confronto è concluso.

Il callback autorizzato in Google resta quello di Supabase Auth. Il dominio Pages è il redirect finale consentito da Supabase, non il callback OAuth diretto di Google in questa architettura.

Nel controllo operativo del 17 agosto 2026 il progetto è risultato pubblicato su <code>https://sapori-ricette.pages.dev/</code>. La build iniziale da <code>Main</code> è riuscita e lo smoke test ha confermato header, PWA e interfaccia account. Questo stato esterno non è comunque deducibile dal solo repository e va ricontrollato dal pannello Cloudflare o con uno smoke test dopo modifiche future.

## 15. Test e qualità

### 15.1 Comandi

<code>package.json</code> espone:

~~~text
npm run check
npm test
npm run test:e2e
npm run test:all
npm run build:site
~~~

- <code>check</code>: sintassi, manifest, icone, CSP, asset e hash PWA;
- <code>test</code>: test unitari Node;
- <code>test:e2e</code>: Playwright;
- <code>test:all</code>: check, unitari ed E2E;
- <code>build:site</code>: output Cloudflare.

### 15.2 Playwright

<code>playwright.config.cjs</code> usa:

- desktop Chromium;
- tablet 820 × 1180;
- telefono stretto 320 × 700;
- Pixel 7;
- progetto PWA separato con service worker attivo.

I file sono seriali al loro interno e la configurazione riduce i worker in CI per evitare saturazione dei test pesanti di foto e stampa.

Le aree coperte includono:

- routing, focus e accessibilità;
- form e validazione;
- mobile e overflow;
- modalità cucina;
- backup e import;
- foto separate;
- categorie;
- bozze e concorrenza;
- identità stabile;
- stampa e pagine lunghe;
- PWA offline;
- account e preparazione sync.

### 15.3 Test unitari

Sono presenti test per:

- database e import;
- dominio ricette;
- utility;
- storage health;
- schema/store/manager/catalogo/identità bozze;
- preparazione sync;
- stampa;
- service worker;
- struttura CSS;
- controlli di progetto.

### 15.4 Lacune di verifica

La full suite non è stata eseguita in questa fase. Inoltre, dall’inventario corrente emergono aree che meritano test aggiuntivi:

- <code>sync-engine.js</code>;
- <code>sync-queue.js</code>;
- <code>sync-transport.js</code>;
- <code>sync-local-store.js</code>;
- <code>sync-conflicts.js</code>;
- integrazione reale delle RPC con Supabase locale;
- percorso completo Google OAuth su origine di produzione;
- migrazione reale GitHub Pages → Cloudflare su due dispositivi.

La suite esistente è ampia, ma non equivale ancora a una certificazione end-to-end del nuovo cloud.

### 15.5 CI/CD corrente

Nel checkout esaminato <code>.github/workflows</code> non contiene file di workflow tracciati. Perciò:

- i comandi di qualità esistono;
- Cloudflare può effettuare build e deploy al push tramite integrazione Git;
- non risulta una CI GitHub Actions che esegua test su ogni commit.

È consigliabile aggiungere un workflow che esegua almeno <code>npm ci</code>, <code>npm run check</code> e <code>npm test</code>; gli E2E possono essere un job separato con cache Playwright e concorrenza controllata.

## 16. Sicurezza: modello delle minacce

| Minaccia | Difesa corrente | Limite residuo |
|---|---|---|
| Lettura dati di un altro account | RLS, policy Storage, account atteso nelle RPC | Va verificata con test SQL automatici |
| Riutilizzo di una richiesta dopo timeout | Ricevute, hash idempotente e retention di 180 giorni | Un dispositivo offline oltre la finestra può dover gestire un conflitto |
| Cambio account durante una sync | Controlli client e server | La UI deve guidare bene il recupero |
| XSS | Escape HTML, CSP, niente script inline | Molto markup usa <code>innerHTML</code>; ogni nuovo campo va escapato |
| Clickjacking | <code>frame-ancestors 'none'</code> e <code>X-Frame-Options</code> | Protezione dipende dagli header del deploy |
| Pubblicazione accidentale di segreti | Build a whitelist, env ignorati | Serve disciplina nelle configurazioni esterne |
| Accesso alle foto altrui | Bucket privato e path per utente | Il DB valida il formato del path, non l’esistenza dell’oggetto |
| Perdita dati browser | Backup, storage health, sync | Bozze non sincronizzate; origine e dispositivo restano punti critici |
| Due schede concorrenti | CAS bozze, lease sync, BroadcastChannel | API con <code>getAll()</code> scalano meno bene a volumi estremi |
| Abuso del free tier | Auth Google, quote per account, rate limit, limite Storage globale | Account multipli coordinati richiederebbero protezioni infrastrutturali ulteriori |

### 16.1 CSP e innerHTML

La CSP consente gli script serviti dalla stessa origine e vieta quelli inline o provenienti da origini diverse. Tuttavia le viste costruiscono molte stringhe HTML, quindi la sicurezza deve rispettare il contesto in cui entra ogni valore:

- per testo nel DOM, preferire <code>textContent</code> oppure usare <code>Utils.escapeHtml()</code> quando si costruisce markup;
- per attributi HTML, usare API DOM dedicate o escaping specifico dell’attributo;
- per URL, analizzare il valore con <code>URL</code> e accettare soltanto schemi e origini previsti;
- per stili, usare esclusivamente proprietà e token già validati, non CSS arbitrario inserito dall’utente.

<code>Utils.escapeHtml()</code> è una barriera utile nel contesto HTML, ma non rende automaticamente sicuri URL, CSS o altri contesti. Evitare di interpolare direttamente dati importati.

### 16.2 Policy signup

Sapori è configurata come applicazione multiutente: **le nuove registrazioni devono restare abilitate** e il provider Google deve restare attivo. Ogni persona ottiene un account e un ricettario privato indipendente. Non esiste ancora un ricettario collaborativo condiviso fra account diversi.

L’isolamento è garantito da <code>owner_id</code>, RLS, controllo dell’account atteso nelle RPC e cartelle Storage intestate a <code>auth.uid()</code>. Le quote della sezione 13.10 riducono l’impatto di un singolo account sul piano gratuito; non sostituiscono monitoraggio, test con due identità reali e un eventuale livello anti-abuso se il pubblico dovesse crescere molto.

## 17. Debugging operativo

### 17.1 L’app non si avvia

Controllare:

1. console per l’errore iniziale;
2. IndexedDB disponibile e non bloccato da un’altra scheda vecchia;
3. ordine degli script in <code>index.html</code>;
4. <code>npm run check</code>;
5. apertura tramite HTTP/HTTPS, non direttamente con <code>file:///</code>.

### 17.2 Una modifica locale non entra in coda

Controllare in IndexedDB:

- <code>syncMeta/state.intentEnabled</code>;
- <code>ownerScope</code>;
- store <code>syncQueue</code>;
- transazione che include gli store sync;
- evento <code>sapori:queue-changed</code>.

Prima della preparazione è corretto che la coda non venga popolata.

### 17.3 La sync resta “in corso”

Controllare:

- <code>syncMeta/queueLease</code>;
- scadenza del lease;
- operazioni <code>sending</code>;
- rete e sessione;
- errori classificati;
- eventuale altra scheda.

<code>recoverExpired()</code> deve riportare in pending le operazioni rimaste senza lease valido.

### 17.4 Errore permanente o operazione bloccata

Gli errori non retryable diventano <code>blocked</code>. Conservare:

- entity key;
- operation ID;
- codice pubblico;
- canale;
- tentativi.

Non cancellare manualmente la coda prima di aver verificato se il dato locale esiste e se il server abbia già una ricevuta.

### 17.5 Ricetta duplicata dopo conflitto

Una copia con indicazione di conflitto può essere un comportamento di sicurezza, non un bug. Confrontare:

- nome e ID;
- contenuto;
- foto;
- record in <code>syncConflicts</code>;
- versioni nello shadow.

Eliminare una delle copie solo dopo una verifica umana.

### 17.6 Foto mancante

Controllare in ordine:

1. <code>recipes.hasImage</code>;
2. record in <code>images</code>;
3. operazione image in coda;
4. <code>imageVersion</code> locale e shadow;
5. path PostgreSQL;
6. oggetto nel bucket privato;
7. CSP <code>img-src</code>;
8. sessione autorizzata al download.

### 17.7 PWA mostra una versione vecchia

Controllare:

- revisione in <code>sw.js</code>;
- risultato di <code>npm run check</code>;
- header no-store di <code>sw.js</code>;
- worker waiting nel pannello Application;
- dialogo di aggiornamento;
- cache legata allo scope corretto.

Non cancellare indiscriminatamente tutti i dati del sito su un dispositivo con ricette non sincronizzate.

### 17.8 OAuth torna con errore

Verificare:

- URL finale esatto fra i redirect Supabase;
- provider Google attivo;
- callback Google rivolto a Supabase Auth;
- HTTPS;
- orologio del dispositivo;
- cookie/storage non bloccati;
- CSP e richieste di rete.

Il client secret Google non deve essere cercato nel browser: deve restare nella configurazione sicura del provider.

### 17.9 PDF contiene URL o data

Il template non li inserisce. Disattivare “Intestazioni e piè di pagina” nel dialogo del browser. Se il problema resta, verificare che non si stia stampando la pagina interattiva con un foglio CSS obsoleto.

## 18. Debito tecnico residuo e priorità

### Priorità P1: prima dell’uso pubblico

1. **Eseguire e stabilizzare la full suite.** In questa fase non è stata eseguita.
2. **Aggiungere test diretti del motore sync e delle RPC.** È la parte più delicata e meno coperta dai test presenti.
3. **Collaudare due account distinti.** Dimostrare che ricette, categorie, preferiti e foto di A non sono leggibili da B.
4. **Aggiungere CI tracciata.** La cartella workflow è vuota nel checkout corrente.
5. **Completare un collaudo reale su almeno due dispositivi.** Include offline, modifica concorrente, foto, logout/login e recupero.
6. **Eseguire la migrazione di origine con backup.** Non dismettere GitHub Pages prima del confronto.

### Priorità P2: robustezza e gestione

1. **Monitoraggio quote.** Aggiungere una pagina amministrativa o alert che mostri crescita aggregata senza esporre contenuti delle ricette.
2. **UI operazioni bloccate.** Mostrare entità e canale oltre all’azione generale “Riprova”, senza dettagli sensibili.
3. **UI conflitti categorie.** Oggi il merge è automatico; manca un confronto dedicato.
4. **Verifica oggetto Storage lato server.** La RPC valida path e metadati, ma non dimostra che l’oggetto esista.
5. **Telemetria minima e rispettosa della privacy.** Contatori di errori o log locali esportabili aiuterebbero il supporto.
6. **Test di disaster recovery.** Backup vecchio, account nuovo, coda corrotta, quota piena e interruzione durante upload.

### Priorità P3: manutenzione e scala

1. Dividere gradualmente <code>js/app.js</code> in controller per form, cucina, import e PWA.
2. Spezzare ulteriormente <code>css/components.css</code> per dominio.
3. Sostituire scansioni <code>getAll()</code> di coda e shadow con cursori/indici se si prevedono migliaia di operazioni.
4. Aggiungere versionamento esplicito del payload cloud oltre <code>schemaVersion: 1</code>.
5. Documentare una procedura di rollback Cloudflare e Supabase.
6. Valutare una UI di diagnostica esportabile, priva di dati delle ricette.

## 19. Valutazione della tecnologia

Il progetto non necessita oggi di una riscrittura React o Vue per risolvere i problemi principali. Le parti più complesse — bozze concorrenti, IndexedDB, stampa, service worker e sync — sono logica indipendente dal framework e già organizzata in moduli.

Restare in JavaScript vanilla ha vantaggi concreti:

- nessuna toolchain runtime;
- build statica semplice;
- ottimo controllo PWA;
- meno dipendenze;
- continuità con i test.

Il costo è soprattutto nella gestione manuale del DOM e nella dimensione di <code>app.js</code>.

Un’evoluzione prudente sarebbe estrarre componenti Web Components o controller più piccoli, mantenendo DB, drafts, auth, sync e print invariati. Un framework completo avrebbe senso solo se il numero di schermate e collaboratori crescesse abbastanza da giustificare migrazione, bundler e riscrittura dei test UI.

## 20. Percorso di studio consigliato

L’ordine seguente evita di studiare Supabase prima di capire ciò che viene sincronizzato.

### Fase 1: HTML, CSS e accessibilità

Studiare:

- struttura di <code>index.html</code>;
- CSS custom properties;
- Flexbox e Grid;
- <code>clamp()</code>;
- viewport dinamico e safe area;
- focus, ARIA, <code>inert</code>;
- media query print.

Esercizi:

1. seguire il percorso di un click sulla card fino al dettaglio;
2. individuare come cambia il layout a 390, 820 e 1280 px;
3. spiegare perché <code>min-height: 0</code> è necessario nella modalità cucina;
4. verificare manualmente il focus dentro un modale.

Domande di verifica:

- Qual è la differenza fra una regola mobile-first e una correzione <code>max-width</code>?
- Perché un target touch da 44 px è preferibile?
- Quali direttive CSP non funzionano in una meta tag?

### Fase 2: JavaScript e router

Studiare:

- IIFE asincrona;
- globali controllate su <code>window</code>;
- Promise e <code>async/await</code>;
- event delegation;
- <code>CustomEvent</code>;
- hash routing;
- race condition e token di rendering.

Esercizi:

1. disegnare lo stato <code>state</code> di <code>app.js</code>;
2. seguire <code>#create</code> fino al rendering del form;
3. simulare mentalmente due navigazioni asincrone ravvicinate;
4. aggiungere su carta una nuova rotta senza modificare il codice.

Domande:

- Perché <code>routeToken</code> evita un DOM obsoleto?
- Qual è il rischio dell’ordine degli script senza moduli ES?
- Perché la sessione account parte in sottofondo?

### Fase 3: dominio ricette e validazione

Studiare:

- <code>Recipes.LIMITS</code>;
- validazione;
- normalizzazione;
- ricerca;
- impronte e deduplicazione;
- ID stabili.

Esercizi:

1. costruire una ricetta minima valida;
2. elencare tutti i punti in cui una stringa utente viene limitata;
3. confrontare impronta import e confronto rigoroso delle bozze;
4. aggiungere un caso di test per una nuova unità.

Domande:

- Perché importazione e form devono validare entrambi?
- Perché il preferito ha una versione separata?
- Quando due ricette con testo simile devono restare distinte?

### Fase 4: IndexedDB e transazioni

Studiare:

- database, object store, indici;
- upgrade;
- request e transaction;
- atomicità;
- versionchange e blocked;
- separazione foto/metadati.

Esercizi:

1. mappare ogni metodo DB agli store che apre;
2. spiegare cosa succede se una transazione abortisce;
3. seguire un import merge completo;
4. ispezionare SaporiDB con DevTools senza modificare record.

Domande:

- Perché la coda deve stare nella stessa transazione della ricetta?
- Qual è la differenza fra <code>getAll()</code> e un cursore?
- Perché le foto complete sono in uno store separato?

### Fase 5: bozze e concorrenza

Studiare:

- compare-and-swap;
- revisioni;
- writer ID;
- debounce e flush;
- TTL;
- recupero di payload corrotti;
- identità stabile.

Esercizi:

1. simulare due schede sulla stessa bozza;
2. descrivere una rimozione tardiva;
3. spiegare gli stati del catalogo;
4. scrivere un test concettuale per una bozza orfana.

Domande:

- Perché una bozza non deve superare la validazione finale?
- Perché il cleanup è condizionale?
- Quando una collisione diventa una copia?

### Fase 6: stampa e PWA

Studiare:

- DOM temporaneo;
- immagini e font;
- <code>window.print()</code>;
- pagine CSS nominate;
- ciclo service worker;
- cache immutabile;
- aggiornamento waiting/active.

Esercizi:

1. seguire la stampa di una ricetta;
2. spiegare perché il cleanup attende <code>afterprint</code>;
3. calcolare quali file entrano nella shell;
4. simulare un aggiornamento offline.

Domande:

- Perché l’app non può disabilitare i footer del browser?
- Perché la cache non viene aggiornata con <code>put()</code>?
- Cosa succede se un asset manca durante <code>addAll()</code>?

### Fase 7: OAuth e sicurezza browser

Studiare:

- OAuth 2.0;
- PKCE;
- access token e refresh token;
- origine e redirect URL;
- CSP;
- chiavi pubbliche e segreti.

Esercizi:

1. disegnare il giro browser → Supabase → Google → Supabase → browser;
2. classificare ogni chiave del progetto come pubblica o segreta;
3. spiegare perché RLS resta necessaria con un JWT valido;
4. verificare quali origini devono essere autorizzate.

Domande:

- Perché la publishable key può stare nel frontend?
- Cosa protegge realmente le righe PostgreSQL?
- Perché il callback Google non è il dominio Cloudflare?

### Fase 8: sincronizzazione distribuita

Studiare nell’ordine:

1. <code>sync-preparation.js</code>;
2. <code>sync-queue.js</code>;
3. <code>sync-serializer.js</code>;
4. <code>sync-transport.js</code>;
5. <code>sync-conflicts.js</code>;
6. <code>sync-local-store.js</code>;
7. <code>sync-engine.js</code>.

Esercizi:

1. seguire la modifica di una nota fino alla ricevuta server;
2. seguire un timeout dopo commit;
3. simulare un conflitto fra due dispositivi;
4. simulare una cancellazione offline e successiva risurrezione;
5. spiegare un lease scaduto.

Domande:

- Qual è la differenza fra operation ID, entity key e device ID?
- Perché il payload viene letto dopo il claim?
- Perché il ciclo fa pull prima e dopo il push?
- Perché un conflitto crea una copia?
- Perché la versione di base non può cambiare durante un retry idempotente?

### Fase 9: PostgreSQL, RLS e RPC

Studiare:

- chiavi primarie composte;
- JSONB e CHECK;
- trigger;
- sequence;
- RLS;
- <code>security definer</code>;
- search path;
- advisory lock;
- isolamento transazionale.

Esercizi:

1. spiegare ogni tabella a parole;
2. seguire una RPC content upsert;
3. seguire una chiamata duplicata;
4. spiegare il caso revisione 11 visibile prima della 10;
5. progettare una retention sicura delle ricevute.

Domande:

- Perché la scrittura diretta alle tabelle è revocata?
- Qual è il rischio di una funzione <code>security definer</code> senza search path sicuro?
- Perché il lock è per account e non globale?
- Perché un tombstone è preferibile a una cancellazione fisica immediata?

### Fase 10: deployment e operazioni

Studiare:

- build a whitelist;
- cache HTTP;
- header di sicurezza;
- ambienti;
- migrazioni append-only;
- backup e rollback;
- isolamento per origine.

Esercizi:

1. ispezionare il contenuto di <code>dist</code>;
2. spiegare perché un dotfile viene rifiutato;
3. scrivere una checklist di deploy;
4. progettare uno smoke test post-deploy;
5. simulare il ritorno temporaneo al vecchio dominio.

## 21. Glossario

| Termine | Significato nel progetto |
|---|---|
| Local-first | I dati locali sono la base operativa; il cloud replica |
| PWA | Web app installabile con manifest e service worker |
| Origin | Combinazione protocollo, host e porta che isola storage e sessioni |
| IndexedDB | Database transazionale del browser |
| Object store | Collezione di record dentro IndexedDB |
| Transazione | Gruppo atomico di letture e scritture |
| Draft | Salvataggio temporaneo di un form incompleto |
| CAS | Compare-and-swap tramite revisione attesa |
| Debounce | Ritardo che raggruppa modifiche ravvicinate |
| Queue | Elenco persistente delle modifiche da inviare |
| Lease | Diritto temporaneo esclusivo di elaborare la coda |
| Claim | Passaggio atomico di un’operazione da pending a sending |
| Ack | Conferma che rimuove l’operazione elaborata |
| Backoff | Ritardo crescente fra tentativi |
| Jitter | Piccola casualità nel retry per evitare richieste simultanee |
| Shadow | Ultima versione server nota al dispositivo |
| Cursor | Ultima revisione pull applicata |
| Revision | Ordine globale delle modifiche cloud |
| Version | Contatore di un singolo canale di un’entità |
| Idempotenza | Ripetere la stessa operazione produce lo stesso risultato |
| Operation ID | Identità immutabile di una richiesta sync |
| Entity key | Chiave locale per proprietario, entità e canale |
| Tombstone | Riga marcata cancellata ma ancora sincronizzabile |
| Conflict | Divergenza che non può essere applicata automaticamente |
| RPC | Funzione PostgreSQL invocabile dal client |
| RLS | Regole PostgreSQL che filtrano righe per utente |
| PKCE | Protezione OAuth per client pubblici senza segreto nel browser |
| JWT | Token firmato che identifica la sessione |
| Publishable key | Chiave pubblica che identifica il progetto Supabase |
| Service role | Credenziale segreta con privilegi elevati, vietata nel frontend |
| CSP | Policy del browser che limita origini e tipi di contenuto |
| APP_SHELL | Insieme minimo di asset precacheati |
| Precache atomico | Installazione della cache valida solo se tutti gli asset arrivano |
| Riapertura tombstone | Creazione controllata di una nuova versione con lo stesso ID |
| Advisory lock | Lock PostgreSQL applicativo, qui per serializzare un account |

## 22. Checklist tecnica prima di dichiarare il progetto pronto

- [ ] Eseguire <code>npm ci</code>.
- [ ] Eseguire <code>npm run check</code>.
- [ ] Eseguire <code>npm test</code>.
- [ ] Eseguire <code>npm run test:e2e</code> e riesaminare gli eventuali timeout con un solo worker.
- [ ] Eseguire <code>npm run build:site</code>.
- [ ] Verificare che <code>dist</code> contenga solo file autorizzati.
- [ ] Verificare migrazioni applicate e permessi RPC.
- [ ] Testare RLS con due utenti distinti.
- [ ] Testare login Google dall’URL di produzione.
- [ ] Testare creazione offline e sync al ritorno online.
- [ ] Testare modifica concorrente su due dispositivi.
- [ ] Testare foto, sostituzione foto e cleanup.
- [ ] Testare cancellazione e propagazione tombstone.
- [ ] Testare backup e ripristino.
- [ ] Testare PDF singolo e ricettario lungo su A4.
- [ ] Disabilitare intestazioni/piè di pagina nel dialogo per il PDF pulito.
- [ ] Verificare PWA installabile e riapertura offline.
- [x] Definire policy signup multiutente e limiti di uso equo.
- [ ] Aggiungere CI tracciata.
- [ ] Conservare GitHub Pages e backup durante la migrazione di origine.

## 23. Conclusione

Sapori non è più una semplice pagina che salva ricette: è un sistema local-first con persistenza transazionale, recupero bozze, stampa strutturata, PWA offline, autenticazione e replica cloud versionata.

I punti architetturali più solidi sono:

- separazione fra uso locale e cloud;
- transazioni dati+coda;
- foto fuori dai record principali;
- bozze concorrenti con revisioni;
- cache PWA immutabile per revisione;
- RPC idempotenti;
- RLS e Storage privato;
- conservazione delle versioni in conflitto;
- build pubblica a lista consentita.

Il lavoro più importante ancora da fare non è una riscrittura del frontend. È chiudere il ciclo operativo: test automatici specifici della sync, CI, collaudo reale con due account e due dispositivi e migrazione di origine verificata con backup. Solo dopo questi passaggi sarà corretto considerare la sincronizzazione pronta per un uso quotidiano senza supervisione.
