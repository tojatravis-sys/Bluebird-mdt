# Audyt techniczny Bluebird MDT

**Zakres:** statyczny przegląd gałęzi `main` w punkcie odniesienia `c5acc251e39b4b704bdc84698900af06d57124ec`, 12 listopada 2026 r. Przejrzano `server.js`, `public/app.js`, `public/index.html`, `public/style.css`, `package.json` i README. Nie łączono się z bazą produkcyjną.

## Zmiany wprowadzone w tej aktualizacji

1. **Dostęp do interwencji:** pełna lista i archiwum `GET /api/interventions` wymagały wcześniej tylko zalogowania. Każdy funkcjonariusz mógł odczytać opisy i historię wszystkich interwencji. Endpoint wymaga teraz roli Dyżurnego lub Komendantury. Widok funkcjonariusza korzysta z `/api/interventions/mine`, a Komendantura zachowuje pełny rejestr.
2. **Nieaktualne sesje i role:** `/api/status` wcześniej uznawał każdą istniejącą sesję za zalogowaną, nawet po dezaktywacji lub usunięciu konta. Status sprawdza teraz konto w bazie. Middleware logowania odświeża też grupę uprawnień z bazy przy każdym chronionym żądaniu.
3. **Wyścig przy usuwaniu patrolu:** sprawdzenie aktywnej interwencji i usunięcie jednostki odbywały się w osobnych operacjach. Usuwanie patrolu jest teraz transakcyjne i blokuje wiersz jednostki, tak jak ścieżki przydzielania interwencji.
4. **Cache:** odpowiedzi API otrzymują `Cache-Control: no-store`; pliki HTML są ponownie walidowane. Wersje CSS/JS w HTML zostały podbite, żeby klient pobrał aktualne zasoby.
5. **Powiadomienia:** zabezpieczono polling przed nakładaniem się żądań i przed pokazaniem odpowiedzi starej sesji po wylogowaniu.
6. **Interfejs:** komunikaty sukcesu używają zielonego stylu, a obsługa kliknięć nawigacji przechwytuje błędy asynchroniczne. Pola wymagane są oznaczane w formularzach; kwota mandatu ma typ liczbowy i zakres od zera. Dodano powiązania etykiet z polami w formularzach modułów i wyszukiwaniu obywateli.
7. **Responsywność:** na tabletach 421–899 px panel używa szerszego układu; karty interwencji na desktopie mają jasne tło i czytelny kontrast zamiast ciemnego tła z ciemnym tekstem.
8. **Dokumentacja i CI:** README został dopasowany do rzeczywistego Node.js 22 i PostgreSQL oraz usunięto nieprawdziwe domyślne dane logowania. Dodano `npm run check` i workflow GitHub Actions.

## Ryzyka pozostające do osobnego etapu

- **Brak limitowania prób logowania.** Endpoint logowania nie ma limitu prób ani opóźnienia dla kolejnych błędnych haseł. Przy publicznym dostępie potrzebny jest limit współdzielony między instancjami (np. PostgreSQL lub reverse proxy), a nie wyłącznie pamięć procesu.
- **Brak jawnej ochrony CSRF/origin.** Ciasteczko ma `SameSite=Lax`, a API przyjmuje JSON, ale aplikacja nie weryfikuje jawnie nagłówka Origin ani tokena CSRF.
- **CSP wyłączone.** Helmet działa, ale `contentSecurityPolicy: false`; włączenie CSP wymaga najpierw uporządkowania inline scriptów i dynamicznego stylu.
- **Walidacja TLS PostgreSQL wyłączona.** Konfiguracja puli ma `rejectUnauthorized: false`. Zmiana na weryfikację certyfikatu powinna być poprzedzona testem połączenia z docelowym dostawcą bazy.
- **Wyszukiwanie przy dużej bazie:** zapytania `ILIKE '%tekst%'` w obywatelach i dopasowaniu patrolu nie korzystają efektywnie ze zwykłych indeksów B-tree. Ewentualne indeksy trigramowe wymagają sprawdzenia dostępności rozszerzenia i pomiaru na reprezentatywnych danych.
- **Koszt uwierzytelniania:** `requireLogin` wykonuje zapytanie do PostgreSQL przy każdym chronionym żądaniu. To świadomy kompromis bezpieczeństwa; wpływ należy zmierzyć przed rozważeniem cache'owania.
- **Dopasowanie patroli:** `/api/interventions/mine` dopasowuje dane funkcjonariusza do tekstowego pola `units.officers` przez wyszukiwanie podciągu. Może to dawać fałszywe trafienia (np. krótkie identyfikatory). Docelowo przydałaby się relacyjna tabela członkostwa patroli, ale wymaga migracji i planu zachowania obecnych danych.
- **Relacje obywateli:** część tabel przechowuje `person_id` bez klucza obcego. Usunięcie obywatela może pozostawić osierocone odwołania; naprawa wymaga migracji i decyzji o zachowaniu danych historycznych.
- **Polling:** funkcjonariusze odpytują przydziały co 12 s, a Dyżurka odświeża widok co 15 s. Przy większej liczbie otwartych kart może to zwiększać obciążenie. Nie wykonywano benchmarku ani testu obciążeniowego.

## Weryfikacja

- Sprawdzono składnię JavaScript parserem V8 i poprawność JSON w `package.json` w ramach przeglądu zmian.
- Dodany workflow uruchomi `npm run check` na GitHub Actions po pushu/PR.
- W repozytorium nie ma obecnie zestawu testów jednostkowych ani integracyjnych.
- Nie wykonano testów z Neon/PostgreSQL, testów dwóch przeglądarek, testów dostępności automatycznym narzędziem, testu obciążeniowego ani wdrożenia Render.
- Nie podano żadnego procentowego przyspieszenia — nie było pomiaru porównawczego.
