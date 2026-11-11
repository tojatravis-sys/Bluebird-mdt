# Bluebird MDT — KPP Lubin (RP)

Polskojęzyczny panel MDT przeznaczony do fikcyjnej rozgrywki role-play. Projekt nie jest systemem dla prawdziwych służb i nie powinien przechowywać rzeczywistych danych osobowych ani informacji operacyjnych.

## Wymagania

- Node.js 22.x
- PostgreSQL (np. Neon)
- `DATABASE_URL` — connection string PostgreSQL
- `SESSION_SECRET` — losowy sekret o długości co najmniej 32 znaków
- Opcjonalnie `PORT` (domyślnie 3000) i `NODE_ENV=production`

## Uruchomienie lokalne

1. Zainstaluj zależności: `npm install`.
2. Ustaw zmienne środowiskowe `DATABASE_URL` i `SESSION_SECRET`.
3. Uruchom kontrolę składni: `npm run check`.
4. Uruchom aplikację: `npm start`.
5. Otwórz `http://localhost:3000`.

Przy pierwszym uruchomieniu utwórz konto Komendantury z poziomu ekranu pierwszej konfiguracji. Projekt nie zawiera domyślnego loginu ani hasła.

## Moduły

- Pulpit służbowy.
- Rejestr i wyszukiwanie obywateli RP.
- Pojazdy, wykroczenia i mandaty.
- Raporty służbowe.
- Rejestr patroli i dostępność jednostek.
- Interwencje, przydzielanie patroli, aktualizacje statusów i archiwum.
- Zarządzanie kontami przez Komendanturę.
- Dziennik systemowy dostępny wyłącznie dla Komendantury.

## Wspólna Dyżurka

Komendantura tworzy jedno konto o roli `DYŻURNY`. Dyżurni korzystają z tego samego loginu i hasła, ale każde logowanie otwiera osobną sesję. System dopuszcza maksymalnie dwie aktywne sesje jednocześnie.

Po zalogowaniu każda osoba musi podać imię i nazwisko w czerwonym oknie identyfikacji. Do zapisania danych moduły i chronione endpointy pozostają zablokowane. Wylogowanie jednej sesji nie kończy drugiej.

Limit sesji zakłada używanie osobnych profili przeglądarki lub osobnych urządzeń. Dwie osoby korzystające z tego samego profilu przeglądarki współdzielą ciasteczko sesji, więc nie są odrębnymi sesjami.

Nieaktywne sesje Dyżurki są uznawane za wygasłe po 10 minutach bez aktywności. Aplikacja odświeża aktywność podczas korzystania z panelu.

## Dziennik systemowy

Dziennik zapisuje udane operacje modyfikujące dane, w tym rodzaj operacji, moduł, osobę wykonującą i czas. Logowania, wylogowania i uzupełnienie danych dyżurnego są rejestrowane osobno. Odczyt dziennika wymaga uprawnień Komendantury.

## Role i dostęp

- `Funkcjonariusz` — moduły służbowe i własne interwencje przypisane do patrolu.
- `DYŻURNY` — tablet Dyżurnego, zarządzanie interwencjami i podgląd patroli.
- `Komendantura` — moduły służbowe, zarządzanie kontami i dziennik systemowy.

Uprawnienia są weryfikowane po stronie serwera. Stopień służbowy jest informacją profilu i sam w sobie nie nadaje dodatkowych uprawnień.

## Render i Neon

W środowisku Render ustaw `DATABASE_URL` na connection string bazy PostgreSQL oraz `SESSION_SECRET` na bezpieczny, losowy sekret. Aplikacja tworzy i aktualizuje wymagane tabele przy starcie.

## Roblox

Panel WWW działa niezależnie od gry Roblox. Integracja z Robloxem nie jest obecnie skonfigurowana.

## Bezpieczeństwo

To projekt RP, nie certyfikowany system produkcyjny. Nie używaj go do prawdziwych danych obywateli, rzeczywistych zgłoszeń ani informacji policyjnych. Przed publicznym udostępnieniem zadbaj o HTTPS, kopie zapasowe bazy, ograniczanie prób logowania i właściwą ochronę sekretów.
