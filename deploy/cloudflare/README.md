# Pubblicazione su Cloudflare Pages

Questa configurazione pubblica soltanto i file dichiarati nella `APP_SHELL`, oltre ai file radice necessari. La cartella `dist` e un risultato generato: a ogni build viene sostituita completamente. File inattesi, dotfile e formati non autorizzati non vengono copiati.

## Verifica locale

Dalla radice del progetto:

```powershell
npm run check
npm run build:site
```

Il risultato deve contenere esclusivamente:

```text
dist/
|-- index.html
|-- manifest.json
|-- sw.js
|-- _headers
|-- css/
|-- js/
`-- icons/
```

## Impostazioni Cloudflare Pages

Collegare la repository Git e configurare:

```text
Framework preset: None
Production branch: Main
Build command: npm run check && npm run build:site
Build output directory: dist
Root directory: lasciare vuoto
```

Non sono necessarie chiavi Cloudflare nella repository quando si usa l'integrazione Git. La Content Security Policy consente le connessioni soltanto all'origine Supabase del progetto Sapori. Se l'origine cambia, aggiornare nello stesso commit:

- `connect-src` e `img-src` in `deploy/cloudflare/_headers`;
- `connect-src` e `img-src` nella meta CSP di `index.html`;
- URL e riferimento in `js/config/supabase-config.js`.

Il controllo statico include `_headers` nella revisione della shell, così una modifica agli header forza anche il rinnovo della cache PWA.

## Passaggio sicuro da GitHub Pages

IndexedDB e la sessione PWA appartengono all'origine del sito: il browser non trasferisce automaticamente i dati da `titangra16.github.io` al nuovo dominio Cloudflare. Prima di indicare il nuovo indirizzo agli utenti:

1. pubblicare e verificare la sincronizzazione sull'indirizzo GitHub Pages attuale;
2. creare un Backup JSON da ogni dispositivo che contiene ricette non presenti altrove;
3. collegare lo stesso account su ciascun dispositivo e attendere che la coda locale risulti vuota;
4. aggiungere l'URL di produzione Cloudflare esatto, senza wildcard di preview, agli URL di reindirizzamento consentiti in Supabase;
5. aprire l'app Cloudflare, accedere e verificare il recupero delle ricette prima di dismettere il vecchio indirizzo.

In Google OAuth deve restare autorizzato come redirect il callback Supabase `https://<project-ref>.supabase.co/auth/v1/callback`. Il dominio Pages non e un redirect Google per questo flusso; diventerebbe un'origine JavaScript Google solo se in futuro l'app integrasse direttamente Google Identity Services.

Non cancellare il deployment GitHub Pages o i relativi dati locali finche backup e confronto delle ricette non sono conclusi.

## Controlli dopo il deploy

1. Aprire l'app e verificare che non compaiano errori CSP nella console.
2. Controllare che `manifest.json` sia raggiungibile e che la PWA sia installabile.
3. Controllare che `sw.js` abbia `Cache-Control: no-cache, no-store, must-revalidate`.
4. Creare una ricetta offline, ricaricare l'app e verificare che sia ancora presente.
5. Verificare accesso, sincronizzazione e immagini Supabase prima di usare il nuovo indirizzo come principale.
