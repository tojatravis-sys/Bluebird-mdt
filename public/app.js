"use strict";

const $ = (selector) => document.querySelector(selector);

const state = {
  user: null,
  users: [],
  currentPage: "summary",
  records: {}
};

const contentArea = $("#contentArea");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Serwer zwrócił nieprawidłową odpowiedź.");
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || `Błąd serwera: ${response.status}`);
  }

  return data;
}

function showMessage(message, isError = false) {
  const element = $("#message");
  if (!element) return;

  element.textContent = message;
  element.classList.remove("hidden");
  element.classList.toggle("error", isError);

  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => {
    element.classList.add("hidden");
  }, 5000);
}

function hideScreens() {
  ["loginScreen", "setupScreen", "dashboardScreen"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.classList.add("hidden");
  });
}

function showScreen(id) {
  hideScreens();
  const element = document.getElementById(id);
  if (element) element.classList.remove("hidden");
}

function isAdmin() {
  return state.user?.roleGroup === "Komendantura" ||
    state.user?.role_group === "Komendantura";
}

function isDispatcher() {
  return state.user?.roleGroup === "DYŻURNY" ||
    state.user?.role_group === "DYŻURNY";
}

function updateUserPanel() {
  const name = $("#welcomeName");
  const details = $("#userDetails");
  const adminButton = $("#usersMenuButton");

  if (name) {
    name.textContent = state.user?.displayName ||
      state.user?.display_name ||
      state.user?.username ||
      "FUNKCJONARIUSZ";
  }

  if (details) {
    details.textContent = [
      state.user?.rank,
      state.user?.badge ? `Odznaka: ${state.user.badge}` : ""
    ].filter(Boolean).join(" • ");
  }

  if (adminButton) {
    adminButton.classList.toggle("hidden", !isAdmin());
  }
}

async function startApp() {
  hideScreens();

  try {
    const status = await api("/api/status");

    if (status.needsSetup) {
      showScreen("setupScreen");
      return;
    }

    const result = await api("/api/me");

    if (result && result.id) {
      state.user = result;
      updateUserPanel();
      showScreen("dashboardScreen");

      if (isDispatcher()) {
        showMessage("Zalogowano na konto Dyżurnego.");
        await openPage("summary");
      } else {
        await openPage("summary");
      }

      return;
    }

    showScreen("loginScreen");
  } catch {
    showScreen("loginScreen");
  }
}

$("#setupForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        username: form.elements.username.value.trim(),
        password: form.elements.password.value
      })
    });

    form.reset();
    showMessage("Konto Komendantury zostało utworzone.");
    await startApp();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#loginForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: form.elements.username.value.trim(),
        password: form.elements.password.value
      })
    });

    state.user = result.user || result;
    form.reset();

    updateUserPanel();
    showScreen("dashboardScreen");

    if (isDispatcher()) {
      showMessage("Zalogowano na konto Dyżurnego.");
    }

    await openPage("summary");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#logoutButton")?.addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    // Powrót do ekranu logowania niezależnie od odpowiedzi serwera.
  }

  state.user = null;
  showScreen("loginScreen");
});

const modules = {
  people: {
    title: "REJESTR OBYWATELI",
    endpoint: "/api/people",
    fields: [
      ["first_name", "Imię"],
      ["last_name", "Nazwisko"],
      ["pesel", "Identyfikator RP (fikcyjny)"],
      ["dob", "Data urodzenia", "date"],
      ["address", "Adres RP"],
      ["phone", "Telefon RP"],
      ["documents", "Dokumenty"],
      ["notes", "Notatki"],
      ["wanted", "Poszukiwany", "checkbox"],
      ["verification_status", "Status weryfikacji"]
    ]
  },
  vehicles: {
    title: "POJAZDY",
    endpoint: "/api/vehicles",
    fields: [
      ["plate", "Numer rejestracyjny"],
      ["brand", "Marka"],
      ["model", "Model"],
      ["color", "Kolor"],
      ["owner", "Właściciel"],
      ["status", "Status"],
      ["notes", "Notatki"]
    ]
  },
  citations: {
    title: "WYKROCZENIA I MANDATY",
    endpoint: "/api/citations",
    fields: [
      ["person", "Obywatel"],
      ["charge", "Wykroczenie"],
      ["amount", "Kwota"],
      ["officer", "Funkcjonariusz"],
      ["date", "Data", "date"],
      ["notes", "Notatki"]
    ]
  },
  reports: {
    title: "RAPORTY",
    endpoint: "/api/reports",
    fields: [
      ["title", "Tytuł"],
      ["type", "Rodzaj raportu"],
      ["officer", "Funkcjonariusz"],
      ["narrative", "Treść raportu", "textarea"],
      ["date", "Data", "date"],
      ["status", "Status"]
    ]
  },
  units: {
    title: "PATROLE",
    endpoint: "/api/units",
    fields: [
      ["callsign", "Numer patrolu"],
      ["officers", "Funkcjonariusze"],
      ["status", "Status"],
      ["area", "Rejon"],
      ["vehicle", "Pojazd"],
      ["notes", "Notatki"]
    ]
  }
};

function fieldHtml(field, value = "") {
  const [name, label, type] = field;
  const safe = escapeHtml(value);

  if (type === "checkbox") {
    return `
      <label class="form-check">
        <input name="${name}" type="checkbox" ${value ? "checked" : ""}>
        ${label}
      </label>
    `;
  }

  if (type === "textarea") {
    return `
      <label>${label}</label>
      <textarea name="${name}" rows="4">${safe}</textarea>
    `;
  }

  return `
    <label>${label}</label>
    <input name="${name}" type="${type || "text"}" value="${safe}">
  `;
}

function readForm(form, config) {
  const result = {};

  config.fields.forEach(([name, , type]) => {
    const input = form.elements[name];
    if (!input) return;

    result[name] = type === "checkbox"
      ? input.checked
      : input.value.trim();
  });

  return result;
}

async function openPage(page) {
  if (!state.user) return;

  if (page === "users" && !isAdmin()) {
    showMessage("Brak uprawnień.", true);
    return;
  }

  if (isDispatcher() && page !== "summary") {
    showMessage("Konto Dyżurnego nie ma dostępu do tego modułu.", true);
    return;
  }

  state.currentPage = page;

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  if (page === "summary") {
    await renderSummary();
  } else if (page === "citizenSearch") {
    renderCitizenSearch();
  } else if (page === "users") {
    await renderUsers();
  } else if (modules[page]) {
    await renderModule(page);
  }
}

async function renderSummary() {
  contentArea.innerHTML = `
    <div class="section-title">PULPIT SŁUŻBOWY</div>
    <div class="panel">Ładowanie danych systemu...</div>
  `;

  try {
    const data = await api("/api/summary");

    contentArea.innerHTML = `
      <div class="section-title">PULPIT SŁUŻBOWY</div>
      <div class="summary-grid">
        ${Object.entries(data).map(([key, value]) => `
          <div class="panel">
            <strong>${escapeHtml(key)}</strong>
            <div>${escapeHtml(typeof value === "object" ? JSON.stringify(value) : value)}</div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (error) {
    contentArea.innerHTML = `
      <div class="panel">Nie udało się pobrać pulpitu: ${escapeHtml(error.message)}</div>
    `;
  }
}

async function renderModule(page) {
  const config = modules[page];

  contentArea.innerHTML = `
    <div class="section-title">${config.title}</div>
    <div class="panel">Ładowanie danych...</div>
  `;

  try {
    const records = await api(config.endpoint);
    state.records[page] = Array.isArray(records) ? records : [];

    contentArea.innerHTML = `
      <div class="section-title">${config.title}</div>

      <section class="panel">
        <h2>DODAJ NOWY WPIS</h2>
        <form id="recordForm">
          ${config.fields.map(field => fieldHtml(field)).join("")}
          <button class="primary-button" type="submit">ZAPISZ</button>
        </form>
      </section>

      <section class="panel">
        <h2>BAZA DANYCH</h2>
        <div id="recordList"></div>
      </section>
    `;

    $("#recordForm").addEventListener("submit", async event => {
      event.preventDefault();

      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;

      try {
        await api(config.endpoint, {
          method: "POST",
          body: JSON.stringify(readForm(form, config))
        });

        showMessage("Zapisano wpis.");
        await renderModule(page);
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    });

    const list = $("#recordList");

    if (!state.records[page].length) {
      list.innerHTML = "<p>Brak wpisów.</p>";
      return;
    }

    list.innerHTML = state.records[page].map(record => `
      <div class="user-row">
        ${config.fields.map(([name, label, type]) => `
          <p><strong>${label}:</strong>
          ${escapeHtml(type === "checkbox"
            ? (record[name] ? "Tak" : "Nie")
            : record[name] ?? "")}</p>
        `).join("")}
        <button type="button" data-delete-record="${record.id}">USUŃ WPIS</button>
      </div>
    `).join("");

    list.querySelectorAll("[data-delete-record]").forEach(button => {
      button.addEventListener("click", async () => {
        if (!confirm("Czy na pewno usunąć ten wpis?")) return;

        try {
          await api(`${config.endpoint}/${button.dataset.deleteRecord}`, {
            method: "DELETE"
          });

          showMessage("Usunięto wpis.");
          await renderModule(page);
        } catch (error) {
          showMessage(error.message, true);
        }
      });
    });

  } catch (error) {
    contentArea.innerHTML = `
      <div class="panel">
        <h2>Błąd pobierania danych</h2>
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;
  }
}

function renderCitizenSearch() {
  contentArea.innerHTML = `
    <div class="section-title">SPRAWDZANIE OBYWATELI</div>
    <section class="panel">
      <h2>WYSZUKIWANIE</h2>
      <form id="citizenSearchForm">
        <label>Imię, nazwisko lub identyfikator RP</label>
        <input name="query" required>
        <button class="primary-button" type="submit">SZUKAJ</button>
      </form>
      <div id="citizenResults"></div>
    </section>
  `;

  $("#citizenSearchForm").addEventListener("submit", async event => {
    event.preventDefault();

    const query = event.currentTarget.elements.query.value.trim();
    const results = $("#citizenResults");

    results.textContent = "Wyszukiwanie...";

    try {
      const data = await api(
        `/api/citizens/search?q=${encodeURIComponent(query)}`
      );

      const citizens = Array.isArray(data) ? data : data.results || [];

      results.innerHTML = citizens.length
        ? citizens.map(person => `
          <div class="user-row">
            <strong>${escapeHtml(person.name ||
              `${person.first_name || ""} ${person.last_name || ""}`)}</strong>
            <p>Identyfikator RP: ${escapeHtml(person.pesel || "Brak")}</p>
            <p>Adres: ${escapeHtml(person.address || "Brak")}</p>
            <p>Status: ${person.wanted ? "POSZUKIWANY" : "Brak wpisu"}</p>
          </div>
        `).join("")
        : "<p>Nie znaleziono obywateli.</p>";
    } catch (error) {
      results.textContent = "Błąd wyszukiwania: " + error.message;
    }
  });
}

async function renderUsers() {
  if (!isAdmin()) {
    contentArea.innerHTML = "<div class='panel'>Brak dostępu.</div>";
    return;
  }

  try {
    state.users = await api("/api/users");

    contentArea.innerHTML = `
      <div class="section-title">ZARZĄDZANIE DOSTĘPAMI</div>

      <section class="panel">
        <h2>UTWÓRZ NOWE KONTO</h2>

        <form id="userForm">
          <label>Rodzaj konta</label>
          <select name="role_group" id="accountRole">
            <option value="Funkcjonariusz">Funkcjonariusz</option>
            <option value="DYŻURNY">Dyżurny</option>
          </select>

          <label>Login</label>
          <input name="username" required minlength="3" autocomplete="off">

          <label>Hasło</label>
          <input name="password" type="password" required minlength="12" autocomplete="new-password">

          <label>Imię i nazwisko</label>
          <input name="display_name" required>

          <label>Numer odznaki</label>
          <input name="badge">

          <div id="rankContainer">
            <label>Stopień</label>
            <select name="rank" id="accountRank" required>
              <optgroup label="KORPUS SZEREGOWYCH">
                <option value="Posterunkowy">Posterunkowy</option>
                <option value="Starszy posterunkowy">Starszy posterunkowy</option>
              </optgroup>

              <optgroup label="KORPUS PODOFICERÓW">
                <option value="Sierżant">Sierżant</option>
                <option value="Starszy sierżant">Starszy sierżant</option>
                <option value="Sierżant sztabowy">Sierżant sztabowy</option>
              </optgroup>

              <optgroup label="KORPUS ASPIRANTÓW">
                <option value="Młodszy aspirant">Młodszy aspirant</option>
                <option value="Aspirant">Aspirant</option>
                <option value="Starszy aspirant">Starszy aspirant</option>
                <option value="Aspirant sztabowy">Aspirant sztabowy</option>
              </optgroup>

              <optgroup label="KORPUS OFICERÓW MŁODSZYCH">
                <option value="Podkomisarz">Podkomisarz</option>
                <option value="Komisarz">Komisarz</option>
                <option value="Nadkomisarz">Nadkomisarz</option>
              </optgroup>

              <optgroup label="KORPUS OFICERÓW STARSZYCH">
                <option value="Podinspektor">Podinspektor</option>
                <option value="Młodszy inspektor">Młodszy inspektor</option>
                <option value="Inspektor">Inspektor</option>
              </optgroup>

              <optgroup label="KORPUS GENERAŁÓW">
                <option value="Nadinspektor">Nadinspektor</option>
                <option value="Generalny inspektor">Generalny inspektor</option>
              </optgroup>
            </select>
          </div>

          <button class="primary-button" type="submit">UTWÓRZ KONTO</button>
        </form>
      </section>

      <section class="panel">
        <h2>LISTA KONT</h2>
        <div id="usersList"></div>
      </section>
    `;

    const form = $("#userForm");
    const roleSelect = $("#accountRole");
    const rankSelect = $("#accountRank");
    const rankContainer = $("#rankContainer");

    function updateRankVisibility() {
      const isDispatcherAccount = roleSelect.value === "DYŻURNY";

      rankContainer.classList.toggle("hidden", isDispatcherAccount);
      rankSelect.required = !isDispatcherAccount;
      rankSelect.disabled = isDispatcherAccount;
    }

    roleSelect.addEventListener("change", updateRankVisibility);
    updateRankVisibility();

    form.addEventListener("submit", async event => {
      event.preventDefault();

      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;

      try {
        await api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            username: form.elements.username.value.trim(),
            password: form.elements.password.value,
            display_name: form.elements.display_name.value.trim(),
            badge: form.elements.badge.value.trim(),
            rank: roleSelect.value === "DYŻURNY"
              ? "Dyżurny"
              : rankSelect.value,
            role_group: roleSelect.value
          })
        });

        showMessage("Utworzono konto.");
        await renderUsers();
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    });

    const list = $("#usersList");

    if (!state.users.length) {
      list.innerHTML = "<p>Brak utworzonych kont.</p>";
      return;
    }

    list.innerHTML = state.users.map(user => `
      <div class="user-row">
        <strong>${escapeHtml(user.display_name || user.username)}</strong>
        <p>Login: ${escapeHtml(user.username)}</p>
        <p>Rodzaj konta: ${escapeHtml(user.role_group || "Funkcjonariusz")}</p>
        <p>Stopień: ${escapeHtml(user.rank || "Nieustalony")}</p>
        <p>Odznaka: ${escapeHtml(user.badge || "Brak")}</p>
        <p>Status: ${user.active ? "Aktywne" : "Nieaktywne"}</p>

        <button type="button" data-toggle="${user.id}">
          ${user.active ? "DEZAKTYWUJ" : "AKTYWUJ"}
        </button>

        <button type="button" data-delete="${user.id}">
          USUŃ KONTO
        </button>
      </div>
    `).join("");

    list.querySelectorAll("[data-toggle]").forEach(button => {
      button.addEventListener("click", async () => {
        const user = state.users.find(item =>
          String(item.id) === button.dataset.toggle
        );

        if (!user) return;

        try {
          await api(`/api/users/${user.id}/active`, {
            method: "PATCH",
            body: JSON.stringify({ active: !user.active })
          });

          showMessage("Zmieniono status konta.");
          await renderUsers();
        } catch (error) {
          showMessage(error.message, true);
        }
      });
    });

    list.querySelectorAll("[data-delete]").forEach(button => {
      button.addEventListener("click", async () => {
        if (!confirm("Czy na pewno usunąć konto?")) return;

        try {
          await api(`/api/users/${button.dataset.delete}`, {
            method: "DELETE"
          });

          showMessage("Usunięto konto.");
          await renderUsers();
        } catch (error) {
          showMessage(error.message, true);
        }
      });
    });

  } catch (error) {
    contentArea.innerHTML = `
      <div class="panel">
        <h2>Błąd</h2>
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;
  }
}

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
  });
});

// ==================================================
// TABLET DYŻURNEGO + INTERWENCJE + POWIADOMIENIA
// ==================================================

const dispatchStyle = document.createElement("style");
dispatchStyle.textContent = `
  .dispatch-wrap { display:grid; gap:16px; }
  .dispatch-nav { display:flex; flex-wrap:wrap; gap:8px; }
  .dispatch-nav button, .dispatch-action {
    border:1px solid #526477; border-radius:8px; padding:10px 14px;
    background:#172536; color:#fff; cursor:pointer;
  }
  .dispatch-nav button.active, .dispatch-action.primary {
    background:#1765a5; border-color:#268bd2;
  }
  .dispatch-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
  .dispatch-card { background:rgba(20,35,52,.9); border:1px solid #40546b; border-radius:10px; padding:14px; }
  .dispatch-card h3 { margin-top:0; }
  .dispatch-card label { display:block; margin:10px 0 5px; }
  .dispatch-card input, .dispatch-card textarea, .dispatch-card select {
    width:100%; box-sizing:border-box; padding:10px; border-radius:6px;
    border:1px solid #526477; background:#101c2a; color:#fff;
  }
  .dispatch-card textarea { min-height:90px; resize:vertical; }
  .dispatch-intervention { border:1px solid #40546b; border-radius:10px; padding:14px; margin:12px 0; }
  .dispatch-intervention p { overflow-wrap:anywhere; }
  .dispatch-status { display:inline-block; padding:5px 9px; border-radius:6px; background:#263c53; margin:4px 0; }
  .dispatch-history { border-left:2px solid #526477; padding-left:12px; margin:12px 0; }
  .dispatch-muted { opacity:.75; font-size:.9em; }
  .dispatch-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; }
  .dispatch-toolbar button { padding:9px 12px; }
  .dispatch-unit { padding:10px; border:1px solid #40546b; border-radius:8px; margin:7px 0; }
  .dispatch-empty { padding:18px; text-align:center; opacity:.75; }
  @media(max-width:600px) {
    .dispatch-card, .dispatch-intervention { padding:11px; }
    .dispatch-nav button { flex:1 1 100%; }
  }
`;
document.head.appendChild(dispatchStyle);

let dispatchRefreshTimer = null;
let notificationTimer = null;
let knownInterventionIds = null;
let notificationAudioContext = null;

const dispatchStatuses = [
  "Oczekuje na przydział",
  "Przydzielona",
  "W drodze",
  "Na miejscu",
  "Zakończona"
];

const dispatchPriorities = ["Niski", "Normalny", "Wysoki", "Pilny"];

function dispatchDate(value) {
  if (!value) return "Brak danych";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Brak danych"
    : date.toLocaleString("pl-PL");
}

function dispatchNav(active) {
  return `
    <div class="dispatch-nav">
      <button type="button" data-dispatch-page="interventions"
        class="${active === "interventions" ? "active" : ""}">
        INTERWENCJE
      </button>
      <button type="button" data-dispatch-page="units"
        class="${active === "units" ? "active" : ""}">
        PATROLE
      </button>
      <button type="button" data-dispatch-page="history"
        class="${active === "history" ? "active" : ""}">
        HISTORIA
      </button>
    </div>
  `;
}

function bindDispatchNav() {
  document.querySelectorAll("[data-dispatch-page]").forEach(button => {
    button.addEventListener("click", () => {
      renderDispatchPage(button.dataset.dispatchPage);
    });
  });
}

async function renderDispatchPage(page = "interventions") {
  if (!isDispatcher()) return;

  state.currentPage = "dispatch";

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.remove("active");
    button.classList.add("hidden");
  });

  if (page === "units") {
    await renderDispatchUnits();
  } else if (page === "history") {
    await renderDispatchHistory();
  } else {
    await renderDispatchInterventions();
  }
}

async function renderDispatchInterventions() {
  contentArea.innerHTML = `
    <div class="section-title">TABLET DYŻURNEGO</div>
    <div class="dispatch-wrap">
      ${dispatchNav("interventions")}
      <section class="dispatch-card">
        <div class="dispatch-toolbar">
          <h2>NOWA INTERWENCJA</h2>
          <button type="button" id="dispatchRefresh" class="dispatch-action">ODŚWIEŻ</button>
        </div>
        <form id="newInterventionForm">
          <label>Adres zdarzenia *</label>
          <input name="address" maxlength="300" required placeholder="Ulica, numer, miejscowość">

          <label>Osoba zgłaszająca</label>
          <input name="reporter" maxlength="150" placeholder="Dane zgłaszającego">

          <label>Opis zdarzenia *</label>
          <textarea name="description" maxlength="5000" required placeholder="Opis zgłoszenia"></textarea>

          <label>Priorytet</label>
          <select name="priority">
            ${dispatchPriorities.map(p => `<option value="${p}" ${p === "Normalny" ? "selected" : ""}>${p}</option>`).join("")}
          </select>

          <label>Przydziel patrol (opcjonalnie)</label>
          <select name="unit_id" id="newInterventionUnit">
            <option value="">Bez przydziału — oczekuje</option>
          </select>

          <button class="dispatch-action primary" type="submit">UTWÓRZ INTERWENCJĘ</button>
        </form>
      </section>

      <section class="dispatch-card">
        <h2>AKTUALNE INTERWENCJE</h2>
        <div id="dispatchInterventionList">Ładowanie...</div>
      </section>
    </div>
  `;

  bindDispatchNav();

  $("#dispatchRefresh").addEventListener("click", () => {
    renderDispatchInterventions();
  });

  try {
    const [interventions, units] = await Promise.all([
      api("/api/interventions"),
      api("/api/units")
    ]);

    const availableUnits = units.filter(unit => unit.status === "Dostępny");
    $("#newInterventionUnit").innerHTML =
      `<option value="">Bez przydziału — oczekuje</option>` +
      availableUnits.map(unit => `
        <option value="${unit.id}">
          ${escapeHtml(unit.callsign)} — ${escapeHtml(unit.officers || "Brak danych")}
        </option>
      `).join("");

    $("#dispatchInterventionList").innerHTML = interventions.length
      ? interventions.map(renderInterventionCard).join("")
      : `<div class="dispatch-empty">Brak zarejestrowanych interwencji.</div>`;

    bindInterventionActions();
  } catch (error) {
    $("#dispatchInterventionList").innerHTML =
      `<p>Błąd pobierania danych: ${escapeHtml(error.message)}</p>`;
  }

  $("#newInterventionForm").addEventListener("submit", async event => {
    event.preventDefault();

    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;

    try {
      await api("/api/interventions", {
        method: "POST",
        body: JSON.stringify({
          address: form.elements.address.value.trim(),
          reporter: form.elements.reporter.value.trim(),
          description: form.elements.description.value.trim(),
          priority: form.elements.priority.value,
          unit_id: form.elements.unit_id.value || null
        })
      });

      showMessage("Utworzono interwencję.");
      await renderDispatchInterventions();
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

function renderInterventionCard(item) {
  const history = Array.isArray(item.history) ? item.history : [];

  return `
    <article class="dispatch-intervention">
      <div class="dispatch-toolbar">
        <h3>${escapeHtml(item.incident_number || `INT-${item.id}`)}</h3>
        <span class="dispatch-status">${escapeHtml(item.status)}</span>
      </div>

      <p><strong>Adres:</strong> ${escapeHtml(item.address)}</p>
      <p><strong>Zgłaszający:</strong> ${escapeHtml(item.reporter || "Nie podano")}</p>
      <p><strong>Opis:</strong> ${escapeHtml(item.description)}</p>
      <p><strong>Priorytet:</strong> ${escapeHtml(item.priority)}</p>
      <p><strong>Patrol:</strong> ${escapeHtml(item.unit_callsign || item.callsign || "Nieprzydzielony")}</p>
      <p class="dispatch-muted">Utworzono: ${escapeHtml(dispatchDate(item.created_at))}</p>

      <div class="dispatch-grid">
        <div>
          <label>Status</label>
          <select data-intervention-status="${item.id}">
            ${dispatchStatuses.map(status => `
              <option value="${status}" ${item.status === status ? "selected" : ""}>
                ${status}
              </option>
            `).join("")}
          </select>
        </div>
        <div>
          <label>Przydziel patrol</label>
          <select data-intervention-unit="${item.id}">
            <option value="">Bez patrolu</option>
          </select>
        </div>
      </div>

      <button type="button" class="dispatch-action primary"
        data-save-intervention="${item.id}">
        ZAPISZ ZMIANY
      </button>

      ${history.length ? `
        <details>
          <summary>Historia interwencji (${history.length})</summary>
          ${history.map(entry => `
            <div class="dispatch-history">
              <strong>${escapeHtml(entry.event)}</strong>
              <p>${escapeHtml(entry.details || "")}</p>
              <small>${escapeHtml(entry.actor_name || "System")} — ${escapeHtml(dispatchDate(entry.created_at))}</small>
            </div>
          `).join("")}
        </details>
      ` : ""}
    </article>
  `;
}

async function bindInterventionActions() {
  try {
    const units = await api("/api/units");

    document.querySelectorAll("[data-intervention-unit]").forEach(select => {
      const interventionId = select.dataset.interventionUnit;
      const intervention = state.records.interventions?.find(
        item => String(item.id) === String(interventionId)
      );

      const currentUnitId = intervention?.unit_id;

      const options = units.filter(unit =>
        unit.status === "Dostępny" || String(unit.id) === String(currentUnitId)
      );

      select.innerHTML = `<option value="">Bez patrolu</option>` +
        options.map(unit => `
          <option value="${unit.id}" ${String(unit.id) === String(currentUnitId) ? "selected" : ""}>
            ${escapeHtml(unit.callsign)} — ${escapeHtml(unit.officers || "Brak danych")}
            (${escapeHtml(unit.status)})
          </option>
        `).join("");
    });

    document.querySelectorAll("[data-save-intervention]").forEach(button => {
      button.addEventListener("click", async () => {
        const id = button.dataset.saveIntervention;
        const status = document.querySelector(`[data-intervention-status="${id}"]`).value;
        const unitId = document.querySelector(`[data-intervention-unit="${id}"]`).value;

        button.disabled = true;

        try {
          await api(`/api/interventions/${id}`, {
            method: "PATCH",
            body: JSON.stringify({
              status,
              unit_id: unitId || null
            })
          });

          showMessage("Zapisano zmiany interwencji.");
          await renderDispatchInterventions();
        } catch (error) {
          showMessage(error.message, true);
        } finally {
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    showMessage("Nie udało się pobrać patroli: " + error.message, true);
  }
}

async function renderDispatchUnits() {
  contentArea.innerHTML = `
    <div class="section-title">TABLET DYŻURNEGO</div>
    <div class="dispatch-wrap">
      ${dispatchNav("units")}
      <section class="dispatch-card">
        <div class="dispatch-toolbar">
          <h2>STAN PATROLI</h2>
          <button type="button" id="dispatchUnitsRefresh" class="dispatch-action">ODŚWIEŻ</button>
        </div>
        <div id="dispatchUnitsList">Ładowanie...</div>
      </section>
    </div>
  `;

  bindDispatchNav();

  async function loadUnits() {
    const units = await api("/api/units");

    $("#dispatchUnitsList").innerHTML = units.length
      ? units.map(unit => `
        <div class="dispatch-unit">
          <strong>${escapeHtml(unit.callsign)}</strong>
          <span class="dispatch-status">${escapeHtml(unit.status)}</span>
          <p>Funkcjonariusze: ${escapeHtml(unit.officers || "Brak danych")}</p>
          <p>Rejon: ${escapeHtml(unit.area || "Nie określono")}</p>
          <p>Pojazd: ${escapeHtml(unit.vehicle || "Nie określono")}</p>
        </div>
      `).join("")
      : "<p>Brak zarejestrowanych patroli.</p>";
  }

  $("#dispatchUnitsRefresh").addEventListener("click", () => {
    loadUnits().catch(error => showMessage(error.message, true));
  });

  try {
    await loadUnits();
  } catch (error) {
    $("#dispatchUnitsList").textContent = error.message;
  }
}

async function renderDispatchHistory() {
  contentArea.innerHTML = `
    <div class="section-title">TABLET DYŻURNEGO</div>
    <div class="dispatch-wrap">
      ${dispatchNav("history")}
      <section class="dispatch-card">
        <h2>HISTORIA INTERWENCJI</h2>
        <div id="dispatchHistoryList">Ładowanie...</div>
      </section>
    </div>
  `;

  bindDispatchNav();

  try {
    const interventions = await api("/api/interventions");
    const completed = interventions.filter(item => item.status === "Zakończona");

    $("#dispatchHistoryList").innerHTML = completed.length
      ? completed.map(item => `
        <div class="dispatch-intervention">
          <strong>${escapeHtml(item.incident_number || `INT-${item.id}`)}</strong>
          <p>Adres: ${escapeHtml(item.address)}</p>
          <p>Opis: ${escapeHtml(item.description)}</p>
          <p>Patrol: ${escapeHtml(item.unit_callsign || item.callsign || "Nieprzydzielony")}</p>
          <p>Zakończono / zmieniono: ${escapeHtml(dispatchDate(item.updated_at))}</p>
          <details>
            <summary>Pokaż historię zmian</summary>
            ${(item.history || []).map(entry => `
              <div class="dispatch-history">
                <strong>${escapeHtml(entry.event)}</strong>
                <p>${escapeHtml(entry.details || "")}</p>
                <small>${escapeHtml(entry.actor_name || "System")} — ${escapeHtml(dispatchDate(entry.created_at))}</small>
              </div>
            `).join("")}
          </details>
        </div>
      `).join("")
      : `<div class="dispatch-empty">Nie ma jeszcze zakończonych interwencji.</div>`;
  } catch (error) {
    $("#dispatchHistoryList").textContent = error.message;
  }
}

// --------------------------------------------------
// POWIADOMIENIA DLA FUNKCJONARIUSZA
// --------------------------------------------------

function enableNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!notificationAudioContext) {
      notificationAudioContext = new AudioContextClass();
    }

    if (notificationAudioContext.state === "suspended") {
      notificationAudioContext.resume();
    }
  } catch {
    // Dźwięk jest opcjonalny.
  }
}

function playInterventionSound() {
  try {
    if (!notificationAudioContext) return;

    const context = notificationAudioContext;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.12;

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start();
    oscillator.stop(context.currentTime + 0.35);
  } catch {
    // Brak obsługi audio nie blokuje działania systemu.
  }
}

document.addEventListener("pointerdown", enableNotificationSound, { once: true });

async function checkMyInterventions() {
  if (!state.user || isDispatcher()) return;

  try {
    const interventions = await api("/api/interventions/mine");
    const currentIds = new Set(interventions.map(item => String(item.id)));

    if (knownInterventionIds === null) {
      knownInterventionIds = currentIds;
      return;
    }

    const newAssignments = interventions.filter(item =>
      !knownInterventionIds.has(String(item.id))
    );

    if (newAssignments.length) {
      playInterventionSound();
      showMessage(
        `Nowa interwencja dla Twojego patrolu: ${newAssignments.map(item => item.incident_number || `INT-${item.id}`).join(", ")}`
      );
    }

    knownInterventionIds = currentIds;
  } catch {
    // Brak połączenia nie przerywa pracy panelu.
  }
}

function startInterventionNotifications() {
  if (notificationTimer) clearInterval(notificationTimer);
  knownInterventionIds = null;

  if (!isDispatcher()) {
    checkMyInterventions();
    notificationTimer = setInterval(checkMyInterventions, 12000);
  }
}

// --------------------------------------------------
// NOWE PRZEŁĄCZANIE WIDOKÓW PO ZALOGOWANIU
// --------------------------------------------------

async function openPage(page) {
  if (!state.user) return;

  if (isDispatcher()) {
    await renderDispatchPage("interventions");
    return;
  }

  if (page === "users" && !isAdmin()) {
    showMessage("Brak uprawnień.", true);
    return;
  }

  state.currentPage = page;

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.remove("hidden");
    button.classList.toggle("active", button.dataset.page === page);
  });

  if (page === "summary") {
    await renderSummary();
  } else if (page === "citizenSearch") {
    renderCitizenSearch();
  } else if (page === "users") {
    await renderUsers();
  } else if (modules[page]) {
    await renderModule(page);
  }
}

async function startApp() {
  hideScreens();

  try {
    const status = await api("/api/status");

    if (status.needsSetup) {
      showScreen("setupScreen");
      return;
    }

    const result = await api("/api/me");

    if (result && result.id) {
      state.user = result;
      updateUserPanel();
      showScreen("dashboardScreen");

      startInterventionNotifications();
      await openPage("summary");
      return;
    }

    state.user = null;
    showScreen("loginScreen");
  } catch (error) {
    state.user = null;
    showScreen("loginScreen");
  }
}

// Ponowne uruchomienie aplikacji z nową obsługą ról.
startApp();
