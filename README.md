# Bluebird MDT — KWP BYDGOSZCZ (Roblox RP)

Polskojęzyczny panel MDT dla fikcyjnego serwera Roblox RP, oznaczony jako KWP BYDGOSZCZ. To projekt roleplay — nie jest oficjalnym systemem Policji ani narzędziem do obsługi rzeczywistych danych policyjnych.

## Jednostka i oznaczenia
- Jednostka w interfejsie: Komenda Wojewódzka Policji — BYDGOSZCZ.
- Oznaczenie jest przeznaczone wyłącznie do fikcyjnej rozgrywki Roblox RP.
- Bluebird pozostaje nazwą techniczną aplikacji.

## Uruchomienie
1. Zainstaluj Node.js 18 lub nowszy.
2. W folderze projektu uruchom `npm install`.
3. Ustaw własną zmienną środowiskową `SESSION_SECRET`.
4. Uruchom `npm start`.
5. Otwórz `http://localhost:3000`.

## Konto demonstracyjne
- Login: `admin`
- Hasło: `Policja2026!`

Zmień hasło i sekret sesji przed udostępnieniem panelu. Dane demonstracyjne są fikcyjne.

## Moduły
- Pulpit główny
- Kartoteka osób i oznaczenia osób poszukiwanych
- Ewidencja pojazdów
- Mandaty w PLN
- Raporty służbowe
- Patrole i jednostki
- Wyszukiwanie, dodawanie i usuwanie wpisów
- SQLite — lokalna baza danych

## Roblox
To panel WWW działający niezależnie od gry. Nie jest jeszcze automatycznie połączony z Robloxem. Do integracji potrzebny będzie skrypt serwerowy Roblox (HttpService), bezpieczny endpoint/API i konfiguracja domeny oraz klucza API. Włącz HTTP Requests w ustawieniach gry dopiero po przygotowaniu integracji.

## Bezpieczeństwo
To wersja startowa do prywatnego testowania RP, nie certyfikowany system produkcyjny. Przed publikacją dodaj HTTPS, ograniczenie prób logowania, role i uprawnienia, kopie zapasowe, ochronę API oraz zmień dane demonstracyjne. Nie przechowuj prawdziwych danych osobowych ani rzeczywistych danych policyjnych.

## Uprawnienia Komendantury
- Konto demonstracyjne należy do grupy `Komendantura`.
- Tylko grupa `Komendantura` widzi panel zarządzania kontami i może tworzyć/usuwać konta.
- Pozostali użytkownicy mają grupę `Funkcjonariusz` i nie mogą zarządzać kontami ani administracją.
- Ograniczenie jest sprawdzane po stronie serwera API, nie tylko przez ukrycie przycisku w interfejsie.
- Komendantura może przydzielić grupę `Komendantura` nowemu kontu. Przydzielaj ją wyłącznie zaufanym osobom.

## Ostateczny model uprawnień
Stopień policyjny (posterunkowy, sierżant, aspirant, komisarz itd.) jest wyłącznie informacją w profilu i nie zmienia dostępu do modułów. Każdy użytkownik z grupą `Funkcjonariusz` ma ten sam dostęp do modułów służbowych. Osobna grupa `Komendantura` ma te same funkcje służbowe oraz dodatkowo administrację: tworzenie i usuwanie kont oraz przydzielanie grup dostępu. Uprawnienia administracyjne są weryfikowane po stronie serwera API.
