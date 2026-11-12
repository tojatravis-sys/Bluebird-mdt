# Bluebird MDT — KPP Lubin (RP)

Polskojęzyczny panel MDT do fikcyjnej rozgrywki role-play. Projekt nie jest systemem dla prawdziwych służb. Używaj wyłącznie fikcyjnych danych.

## Wymagania

- Node.js 22.x
- PostgreSQL (np. Neon)
- `DATABASE_URL` — connection string bazy
- `SESSION_SECRET` — losowy sekret o długości co najmniej 32 znaków
- Opcjonalnie `PORT` (domyślnie 3000) i `NODE_ENV=production`

## Uruchomienie lokalne

1. Zainstaluj zależności: `npm install`.
2. Ustaw `DATABASE_URL` i `SESSION_SECRET`.
3. Sprawdź składnię: `npm run check`.
4. Uruchom aplikację: `npm start`.
5. Otwórz `http://localhost:3000`.

Przy pierwszym uruchomieniu utwórz konto Komendantury z ekranu pierwszej konfiguracji. Repozytorium nie udostępnia domyślnego loginu ani hasła demonstracyjnego.

## Moduły

- Pulpit służbowy.
- Rejestr obywateli i wyszukiwanie.
- Pojazdy.
- Wykroczenia i mandaty.
- Raporty.
- Patrole i jednostki.
- Interwencje oraz historia i archiwum Dyżurki.
- Zarządzanie kontami przez Komendanturę.
- Powiadomienia o nowych przydziałach patrolu.

## Role

- `Funkcjonariusz` — moduły służbowe i podgląd interwencji przypisanych do jego patrolu.
- `DYŻURNY` — obsługa interwencji, przydziały, status patroli i archiwum.
- `Komendantura` — moduły służbowe, pełny rejestr interwencji i zarządzanie kontami.

Pierwsze konto otrzymuje rolę Komendantury. Z poziomu zarządzania kontami można tworzyć konta Funkcjonariusza i DYŻURNEGO. Stopień jest informacją profilu, a nie osobnym uprawnieniem. Kontrola dostępu jest wykonywana po stronie serwera.

## Baza danych

Aplikacja korzysta z PostgreSQL. Wymagane tabele i część indeksów są tworzone automatycznie przy starcie. Nie jest używana lokalna baza SQLite.

## Render / Neon

W Render ustaw `DATABASE_URL` na connection string PostgreSQL oraz `SESSION_SECRET` na losowy sekret (minimum 32 znaki). Ustaw `NODE_ENV=production`, aby ciasteczko sesji miało flagę Secure. Aplikacja oczekuje HTTPS za zaufanym reverse proxy.

Przed zmianami schematu wykonuj kopię bazy. Nie testuj migracji na jedynej kopii danych.

## Kontrola jakości

`npm run check` sprawdza składnię `server.js`, `public/app.js` i poprawność JSON w `package.json`. To kontrola statyczna, nie test integracyjny. Repozytorium nie zawiera obecnie pełnego zestawu testów automatycznych dla PostgreSQL ani testów przeglądarkowych.

## Roblox

Panel WWW działa niezależnie od gry Roblox. Automatyczna integracja z Robloxem nie jest skonfigurowana.

## Bezpieczeństwo i ograniczenia

To projekt RP, nie certyfikowany system produkcyjny. Nie zapisuj prawdziwych danych osobowych, rzeczywistych zgłoszeń ani informacji służbowych. Przed publicznym udostępnieniem należy uzupełnić ograniczanie prób logowania, ochronę CSRF/origin, politykę CSP i zweryfikować konfigurację TLS bazy. Szczegóły aktualnego przeglądu znajdują się w `AUDIT.md`.
