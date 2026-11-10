# Bluebird MDT — KPP Lubin (RP)

Bluebird to polskojęzyczny panel MDT przeznaczony do fikcyjnej rozgrywki role-play. Nie jest oficjalnym systemem Policji ani narzędziem do obsługi rzeczywistych danych służbowych.

## Wymagania

- Node.js 22.x (zgodnie z `package.json`)
- Baza PostgreSQL, np. Neon
- Zmienne środowiskowe:
  - `DATABASE_URL` — connection string PostgreSQL
  - `SESSION_SECRET` — losowy sekret sesji o długości co najmniej 32 znaków
  - `PORT` — opcjonalny port HTTP (domyślnie 3000)
  - `NODE_ENV=production` — w środowisku produkcyjnym, aby włączyć bezpieczne ciasteczko sesji

## Uruchomienie lokalne

1. Zainstaluj Node.js 22.
2. W katalogu projektu uruchom `npm install`.
3. Ustaw `DATABASE_URL` i `SESSION_SECRET`.
4. Uruchom `npm start`.
5. Otwórz `http://localhost:3000`.

Serwer tworzy wymagane tabele i indeksy podczas inicjalizacji. Pierwsze konto Komendantury tworzy się przez ekran pierwszej konfiguracji, gdy tabela użytkowników jest pusta. Hasło początkowe musi mieć co najmniej 12 znaków.

## Moduły

- Pulpit z podsumowaniem danych
- Rejestr i wyszukiwanie obywateli
- Ewidencja pojazdów
- Wykroczenia i mandaty
- Raporty
- Patrole i ich dostępność
- Interwencje, przydziały i historia
- Archiwum zakończonych interwencji
- Zarządzanie kontami przez Komendanturę
- Osobny widok Dyżurnego

## Role i dostęp

- `Funkcjonariusz` — dostęp do modułów służbowych.
- `DYŻURNY` — dostęp do widoku dyżurnego i odczytu listy patroli; operacje dyspozytorskie są ograniczone do odpowiednich endpointów.
- `Komendantura` — dostęp administracyjny, w tym zarządzanie kontami.

Uprawnienia są sprawdzane po stronie serwera. Stopień służbowy jest osobnym polem profilu i sam w sobie nie nadaje uprawnień.

## Baza danych i wdrożenie

Aplikacja korzysta z PostgreSQL przez pakiet `pg`; nie używa SQLite. Sesje są przechowywane w PostgreSQL w tabeli `user_sessions`. Wdrożenie hostowane może wymagać ustawienia zmiennych środowiskowych w panelu dostawcy hostingu.

## Bezpieczeństwo i ograniczenia

- Projekt jest przeznaczony do fikcyjnego RP i testów, a nie do przechowywania prawdziwych danych osobowych ani informacji policyjnych.
- Ustaw unikalny, losowy `SESSION_SECRET` i silne hasła kont.
- Nie umieszczaj sekretów ani haseł w repozytorium.
- Przed publicznym udostępnieniem należy przeprowadzić dodatkowy przegląd bezpieczeństwa, w tym ograniczanie prób logowania, monitoring, kopie zapasowe i konfigurację infrastruktury.
- Nie zakładaj, że samo ukrycie elementu interfejsu zabezpiecza endpoint — autoryzacja musi być egzekwowana przez API.
