
"use strict";

const $ = selector => document.querySelector(selector);

const state = {
  user: null,
  users: [],
  currentPage: "summary",
  dispatchPage: "interventions",
  records: {}
};

const contentArea = $("#contentArea");

let dispatchRefreshTimer = null;
let notificationTimer = null;
let knownInterventionIds = null;
let notificationAudioContext = null;
let dispatchLoading = false;

const dispatchStatuses = [
  "Oczekuje na przydział",
  "Przydzielona",
  "W drodze",
  "Na miejscu",
  "Zakończona"
];

const dispatchPriorities = ["Niski", "Normalny", "Wysoki", "Pilny"];

function isUnitAvailable(unit) {
  if (typeof unit?.available_for_dispatch === "boolean") {
    return unit.available_for_dispatch;
  }

  const status = String(unit?.status || "")
    .trim()
    .toLocaleLowerCase("pl-PL")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return ["dostepny", "wolny", "available"].includes(status);
}

// ==================================================
// PODSTAWOWE FUNKCJE
// ==================================================

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
    throw new Error(
      data.error ||
      data.message ||
      `Błąd serwera: ${response.status}`
    );
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
    document.getElementById(id)?.classList.add("hidden");
  });
}

function showScreen(id) {
  hideScreens();
  document.getElementById(id)?.classList.remove("hidden");
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
  const auditButton = $("#auditLogsMenuButton");

  if (name) {
    name.textContent =
      state.user?.displayName ||
      state.user?.display_name ||
      state.user?.username ||
      "FUNKCJONARIUSZ";
  }

  if (details) {
    details.textContent = [
      state.user?.rank,
      state.user?.badge
        ? `Odznaka: ${state.user.badge}`
        : ""
    ].filter(Boolean).join(" • ");
  }

  if (adminButton) adminButton.classList.toggle("hidden", !isAdmin());
  if (auditButton) auditButton.classList.toggle("hidden", !isAdmin());
}

function hasDutyIdentity() {
  return !isDispatcher() || state.user?.dutyIdentityComplete === true;
}

function removeDutyIdentityGate() {
  document.getElementById("dutyIdentityGate")?.remove();
}

function renderDutyIdentityGate() {
  if (!isDispatcher() || hasDutyIdentity()) {
    removeDutyIdentityGate();
    return;
  }

  if (!document.getElementById("dutyIdentityGateStyles")) {
    const styles = document.createElement("style");
    styles.id = "dutyIdentityGateStyles";
    styles.textContent = `
      .duty-identity-backdrop {
        position:fixed; inset:0; z-index:99999; display:flex;
        align-items:center; justify-content:flex-end; padding:24px;
        box-sizing:border-box; background:rgba(5,12,18,.82);
      }
      .duty-identity-card {
        width:min(440px,100%); box-sizing:border-box; padding:24px;
        border-left:8px solid #c62828; border-radius:12px;
        background:#fff; color:#172b46; box-shadow:0 18px 60px rgba(0,0,0,.4);
      }
      .duty-identity-alert {
        margin:-24px -24px 20px; padding:14px 20px;
        background:#b71c1c; color:#fff; font-weight:800;
        letter-spacing:.04em; border-radius:5px 5px 0 0;
      }
      .duty-identity-card h2 { margin:0 0 10px; color:#172b46; }
      .duty-identity-card p { color:#536982; line-height:1.5; }
      .duty-identity-card label { display:block; margin:14px 0 6px; font-weight:700; }
      .duty-identity-card input {
        width:100%; box-sizing:border-box; padding:12px;
        border:1px solid #9aa9b8; border-radius:7px; font-size:16px;
      }
      .duty-identity-card button {
        width:100%; margin-top:14px; padding:12px;
        border:0; border-radius:7px; font-weight:800; cursor:pointer;
      }
      .duty-identity-save { background:#b71c1c; color:#fff; }
      .duty-identity-logout { background:#edf1f5; color:#26394d; }
      .duty-identity-error { color:#b71c1c !important; font-weight:700; min-height:1.2em; }
      @media (max-width:640px) {
        .duty-identity-backdrop { justify-content:center; padding:14px; }
        .duty-identity-card { padding:20px; }
        .duty-identity-alert { margin:-20px -20px 18px; }
      }
    `;
    document.head.appendChild(styles);
  }

  let gate = document.getElementById("dutyIdentityGate");
  if (!gate) {
    gate = document.createElement("div");
    gate.id = "dutyIdentityGate";
    gate.className = "duty-identity-backdrop";
    document.body.appendChild(gate);
  }

  gate.innerHTML = `
    <section class="duty-identity-card" role="dialog"
      aria-modal="true" aria-labelledby="dutyIdentityTitle">
      <div class="duty-identity-alert" role="alert">WYMAGANE — UZUPEŁNIJ DANE</div>
      <h2 id="dutyIdentityTitle">Identyfikacja dyżurnego</h2>
      <p>Wpisz swoje imię i nazwisko. Do chwili zapisania danych
        moduły, menu i przyciski Bluebird pozostają zablokowane.</p>
      <form id="dutyIdentityForm">
        <label for="dutyFirstName">IMIĘ</label>
        <input id="dutyFirstName" name="first_name" maxlength="80"
          autocomplete="given-name" required autofocus>
        <label for="dutyLastName">NAZWISKO</label>
        <input id="dutyLastName" name="last_name" maxlength="80"
          autocomplete="family-name" required>
        <p id="dutyIdentityError" class="duty-identity-error" aria-live="polite"></p>
        <button class="duty-identity-save" type="submit">ZAPISZ DANE I PRZEJDŹ DO DYŻURKI</button>
        <button class="duty-identity-logout" id="dutyIdentityLogout" type="button">WYLOGUJ SIĘ</button>
      </form>
    </section>
  `;

  $("#dutyIdentityForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const errorBox = $("#dutyIdentityError");
    button.disabled = true;
    errorBox.textContent = "";

    try {
      const result = await api("/api/duty/identity", {
        method: "POST",
        body: JSON.stringify({
          first_name: form.elements.first_name.value.trim(),
          last_name: form.elements.last_name.value.trim()
        })
      });

      state.user = result.user;
      updateUserPanel();
      removeDutyIdentityGate();
      showMessage("Zapisano dane dyżurnego. Dostęp do Dyżurki odblokowany.");
      startBackgroundTasks();
      await openPage("dispatch");
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  $("#dutyIdentityLogout").addEventListener("click", logoutCurrentUser);
}

function stopBackgroundTasks() {
  if (notificationTimer) {
    clearInterval(notificationTimer);
    notificationTimer = null;
  }

  if (dispatchRefreshTimer) {
    clearInterval(dispatchRefreshTimer);
    dispatchRefreshTimer = null;
  }

  knownInterventionIds = null;
}

function setNavigationVisibility() {
  document.querySelectorAll("[data-page]").forEach(button => {
    if (isDispatcher()) {
      button.classList.add("hidden");
      button.classList.remove("active");
      return;
    }

    button.classList.remove("hidden");

    if (["users", "auditLogs"].includes(button.dataset.page) && !isAdmin()) {
      button.classList.add("hidden");
    }
  });
}

// ==================================================
// LOGOWANIE I KONTO
// ==================================================

async function startApp() {
  hideScreens();
  stopBackgroundTasks();
  removeDutyIdentityGate();

  try {
    const status = await api("/api/status");

    if (status.needsSetup) {
      state.user = null;
      showScreen("setupScreen");
      return;
    }

    if (status.authenticated && status.user && status.user.id) {
      state.user = status.user;
      updateUserPanel();
      setNavigationVisibility();
      showScreen("dashboardScreen");

      if (isDispatcher() && !hasDutyIdentity()) {
        renderDutyIdentityGate();
        return;
      }

      startBackgroundTasks();
      if (isDispatcher()) {
        showMessage("Zalogowano na konto Dyżurnego.");
        await openPage("dispatch");
      } else {
        await openPage("summary");
      }
      return;
    }

    state.user = null;
    showScreen("loginScreen");
  } catch {
    state.user = null;
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
    setNavigationVisibility();
    showScreen("dashboardScreen");

    if (isDispatcher() && !hasDutyIdentity()) {
      renderDutyIdentityGate();
      return;
    }

    removeDutyIdentityGate();
    // Powiadomienia uruchamiają się również po ręcznym logowaniu.
    startBackgroundTasks();

    if (isDispatcher()) {
      showMessage("Zalogowano na konto Dyżurnego.");
      await openPage("dispatch");
    } else {
      await openPage("summary");
    }
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

async function logoutCurrentUser() {
  stopBackgroundTasks();

  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    // Wylogowanie lokalne niezależnie od odpowiedzi serwera.
  }

  removeDutyIdentityGate();
  state.user = null;
  state.records = {};
  state.users = [];
  showScreen("loginScreen");
}

$("#logoutButton")?.addEventListener("click", logoutCurrentUser);

// ==================================================
// MODUŁY SYSTEMU
// ==================================================

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
        <input name="${name}" type="checkbox"
          ${value ? "checked" : ""}>
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

// ==================================================
// NAWIGACJA
// ==================================================

async function openPage(page) {
  if (!state.user) return;

  if (isDispatcher() && !hasDutyIdentity()) {
    renderDutyIdentityGate();
    return;
  }

  if (isDispatcher()) {
    await renderDispatchPage(
      page === "dispatch" ? state.dispatchPage : "interventions"
    );
    return;
  }

  if (["users", "auditLogs"].includes(page) && !isAdmin()) {
    showMessage("Brak uprawnień.", true);
    return;
  }

  state.currentPage = page;

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.remove("hidden");
    button.classList.toggle("active", button.dataset.page === page);

    if (["users", "auditLogs"].includes(button.dataset.page) && !isAdmin()) {
      button.classList.add("hidden");
    }
  });

  if (page === "interventions") {
    await renderInterventionsBoard();
  } else if (page === "summary") {
    await renderSummary();
  } else if (page === "citizenSearch") {
    renderCitizenSearch();
  } else if (page === "users") {
    await renderUsers();
  } else if (page === "auditLogs") {
    await renderAuditLogs();
  } else if (modules[page]) {
    await renderModule(page);
  }
}

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
  });
});

// ==================================================
// WSPÓLNA LISTA INTERWENCJI W BLUEBIRD
// ==================================================

async function renderInterventionsBoard() {
  state.currentPage = "interventions";

  contentArea.innerHTML = `
    <div class="section-title">INTERWENCJE</div>
    <section class="panel">
      <div class="dispatch-toolbar">
        <h2>REJESTR INTERWENCJI</h2>
        <button type="button" id="refreshBluebirdInterventions"
          class="small-button">ODŚWIEŻ</button>
      </div>
      <div id="bluebirdInterventionsList">Ładowanie interwencji...</div>
    </section>
  `;

  const list = $("#bluebirdInterventionsList");
  const refresh = $("#refreshBluebirdInterventions");

  async function loadInterventions() {
    if (!list) return;
    list.textContent = "Pobieranie interwencji...";

    try {
      const interventions = await api("/api/interventions");

      list.innerHTML = interventions.length
        ? interventions.map(item => {
            const statusClass = item.status === "Zakończona"
              ? "completed"
              : item.status === "Oczekuje na przydział"
                ? "pending"
                : "";

            return `
              <article class="intervention-card">
                <h3>${escapeHtml(item.incident_number || `INT-${item.id}`)}</h3>
                <span class="intervention-status ${statusClass}">
                  ${escapeHtml(item.status || "Nieznany")}
                </span>
                <p><strong>Adres:</strong> ${escapeHtml(item.address || "Nie podano")}</p>
                <p><strong>Zgłaszający:</strong> ${escapeHtml(item.reporter || "Nie podano")}</p>
                <p><strong>Opis:</strong> ${escapeHtml(item.description || "")}</p>
                <p><strong>Priorytet:</strong> ${escapeHtml(item.priority || "Normalny")}</p>
                <p><strong>Patrol:</strong> ${escapeHtml(item.unit_callsign || item.callsign || "Nieprzydzielony")}</p>
                <p><strong>Utworzono:</strong> ${escapeHtml(dispatchDate(item.created_at))}</p>
              </article>
            `;
          }).join("")
        : '<div class="dispatch-empty">Brak zarejestrowanych interwencji.</div>';
    } catch (error) {
      list.textContent = "Nie udało się pobrać interwencji: " + error.message;
    }
  }

  refresh?.addEventListener("click", loadInterventions);
  await loadInterventions();
}

// ==================================================
// PULPIT
// ==================================================

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
            <div>${escapeHtml(
              typeof value === "object"
                ? JSON.stringify(value)
                : value
            )}</div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (error) {
    contentArea.innerHTML = `
      <div class="panel">
        Nie udało się pobrać pulpitu:
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}

// ==================================================
// MODUŁY DANYCH
// ==================================================

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
          <p>
            <strong>${label}:</strong>
            ${escapeHtml(
              type === "checkbox"
                ? (record[name] ? "Tak" : "Nie")
                : record[name] ?? ""
            )}
          </p>
        `).join("")}

        <button type="button" data-delete-record="${record.id}">
          USUŃ WPIS
        </button>
      </div>
    `).join("");

    list.querySelectorAll("[data-delete-record]").forEach(button => {
      button.addEventListener("click", async () => {
        if (!confirm("Czy na pewno usunąć ten wpis?")) return;

        try {
          await api(
            `${config.endpoint}/${button.dataset.deleteRecord}`,
            { method: "DELETE" }
          );

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

// ==================================================
// WYSZUKIWANIE OBYWATELI
// ==================================================

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

      const citizens = Array.isArray(data)
        ? data
        : data.results || [];

      results.innerHTML = citizens.length
        ? citizens.map(person => `
          <div class="user-row">
            <strong>
              ${escapeHtml(
                person.name ||
                `${person.first_name || ""} ${person.last_name || ""}`
              )}
            </strong>

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

// ==================================================
// ZARZĄDZANIE KONTAMI
// ==================================================

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
          <input name="password" type="password" required
            minlength="12" autocomplete="new-password">

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

          <button class="primary-button" type="submit">
            UTWÓRZ KONTO
          </button>
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
      const dispatcher = roleSelect.value === "DYŻURNY";

      rankContainer.classList.toggle("hidden", dispatcher);
      rankSelect.required = !dispatcher;
      rankSelect.disabled = dispatcher;
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

// ==================================================
// DZIENNIK SYSTEMOWY — KOMENDANTURA
// ==================================================

async function renderAuditLogs() {
  if (!isAdmin()) {
    contentArea.innerHTML = "<div class='panel'>Brak dostępu.</div>";
    return;
  }

  state.currentPage = "auditLogs";
  contentArea.innerHTML = `
    <div class="section-title">KOMENDANTURA — DZIENNIK SYSTEMOWY</div>
    <section class="panel">
      <h2>AKTYWNI DYŻURNI</h2>
      <div id="activeDutyOperators">Pobieranie...</div>
    </section>
    <section class="panel">
      <div class="dispatch-toolbar">
        <h2>HISTORIA ZDARZEŃ</h2>
        <button type="button" class="small-button" id="auditRefresh">ODŚWIEŻ</button>
      </div>
      <form id="auditSearchForm" class="search-form">
        <input id="auditSearch" type="search"
          placeholder="Szukaj osoby, czynności lub modułu...">
        <button type="submit" class="primary-button">SZUKAJ</button>
      </form>
      <div id="auditLogList">Pobieranie logów...</div>
    </section>
  `;

  const activeList = $("#activeDutyOperators");
  const logList = $("#auditLogList");
  const searchInput = $("#auditSearch");

  function formatAuditDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pl-PL");
  }

  async function loadActiveDuty() {
    const operators = await api("/api/duty/active");
    activeList.innerHTML = operators.length
      ? operators.map(operator => `
          <div class="user-row">
            <strong>${escapeHtml(operator.first_name)} ${escapeHtml(operator.last_name)}</strong>
            <p>Rozpoczęcie: ${escapeHtml(formatAuditDate(operator.started_at))}</p>
            <p>Ostatnia aktywność: ${escapeHtml(formatAuditDate(operator.last_seen_at))}</p>
          </div>
        `).join("")
      : "<p>Obecnie nikt nie jest zalogowany na Dyżurkę.</p>";
  }

  async function loadAuditLogs() {
    logList.textContent = "Pobieranie logów...";
    try {
      const query = searchInput.value.trim();
      const logs = await api("/api/audit-logs?q=" + encodeURIComponent(query));
      logList.innerHTML = logs.length
        ? logs.map(log => `
            <article class="dispatch-intervention">
              <div class="dispatch-toolbar">
                <strong>${escapeHtml(log.action)}</strong>
                <small>${escapeHtml(formatAuditDate(log.created_at))}</small>
              </div>
              <p><strong>Osoba:</strong> ${escapeHtml(log.actor_name || "System")}</p>
              <p><strong>Rola:</strong> ${escapeHtml(log.actor_role || "—")}</p>
              <p><strong>Szczegóły:</strong> ${escapeHtml(log.details || "—")}</p>
              <small>${escapeHtml(log.method || "")} ${escapeHtml(log.route || "")} · HTTP ${escapeHtml(log.status_code ?? "—")}</small>
            </article>
          `).join("")
        : "<p>Brak wpisów pasujących do wyszukiwania.</p>";
    } catch (error) {
      logList.textContent = error.message;
    }
  }

  $("#auditSearchForm").addEventListener("submit", event => {
    event.preventDefault();
    loadAuditLogs();
  });

  $("#auditRefresh").addEventListener("click", async () => {
    try {
      await loadActiveDuty();
    } catch (error) {
      activeList.textContent = error.message;
    }
    await loadAuditLogs();
  });

  try {
    await Promise.all([loadActiveDuty(), loadAuditLogs()]);
  } catch (error) {
    activeList.textContent = error.message;
  }
}

// ==================================================
// TABLET DYŻURNEGO
// ==================================================

const dispatchStyle = document.createElement("style");

dispatchStyle.textContent = `
  .dispatch-wrap { display:grid; gap:16px; }

  .dispatch-nav {
    display:flex;
    flex-wrap:wrap;
    gap:8px;
  }

  .dispatch-nav button,
  .dispatch-action {
    border:1px solid #d6e0ec;
    border-radius:8px;
    padding:10px 14px;
    background:#f3f6fa;
    color:#3b5574;
    cursor:pointer;
  }

  .dispatch-nav button.active,
  .dispatch-action.primary {
    background:#eaf3ff;
    color:#1765bd;
    border-color:#80b4ed;
  }

  .dispatch-grid {
    display:grid;
    grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
    gap:12px;
  }

  .dispatch-card {
    background:#ffffff;
    color:#172b46;
    border:1px solid #dce4ef;
    border-radius:10px;
    padding:14px;
  }

  .dispatch-card h2, .dispatch-card h3 { margin-top:0; color:#304b6d; }

  .dispatch-card label {
    display:block;
    margin:10px 0 5px;
  }

  .dispatch-card input,
  .dispatch-card textarea,
  .dispatch-card select {
    width:100%;
    box-sizing:border-box;
    padding:10px;
    border-radius:6px;
    border:1px solid #526477;
    background:#ffffff;
    color:#172b46;
  }

  .dispatch-card textarea {
    min-height:90px;
    resize:vertical;
  }

  .dispatch-intervention {
    background:#ffffff;
    color:#172b46;
    border:1px solid #dce4ef;
    border-radius:10px;
    padding:14px;
    margin:12px 0;
  }

  .dispatch-intervention p { overflow-wrap:anywhere; color:#536982; }

  .dispatch-status {
    display:inline-block;
    padding:5px 9px;
    border-radius:6px;
    background:#eaf3ff;
    color:#1765bd;
    margin:4px 0;
  }

  .dispatch-history {
    border-left:2px solid #b8d3f1;
    padding-left:12px;
    margin:12px 0;
  }

  .dispatch-muted {
    color:#75869c;
    font-size:.9em;
  }

  .dispatch-toolbar {
    display:flex;
    flex-wrap:wrap;
    gap:8px;
    align-items:center;
    justify-content:space-between;
  }

  .dispatch-toolbar button { padding:9px 12px; }

  .dispatch-unit {
    padding:10px;
    border:1px solid #dce4ef;
    border-radius:8px;
    background:#ffffff;
    color:#172b46;
    margin:7px 0;
  }

  .dispatch-empty {
    padding:18px;
    text-align:center;
    color:#75869c;
    background:#ffffff;
    border:1px dashed #dce4ef;
    border-radius:10px;
  }

  @media(max-width:600px) {
    .dispatch-card,
    .dispatch-intervention { padding:11px; }

    .dispatch-nav button { flex:1 1 100%; }
  }
`;

document.head.appendChild(dispatchStyle);

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
      <button type="button"
        data-dispatch-page="interventions"
        class="${active === "interventions" ? "active" : ""}">
        INTERWENCJE
      </button>

      <button type="button"
        data-dispatch-page="units"
        class="${active === "units" ? "active" : ""}">
        PATROLE
      </button>

      <button type="button"
        data-dispatch-page="history"
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
  state.dispatchPage = page;

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

// ==================================================
// INTERWENCJE
// ==================================================

async function renderDispatchInterventions() {
  contentArea.innerHTML = `
    <div class="section-title">TABLET DYŻURNEGO</div>

    <div class="dispatch-wrap">
      ${dispatchNav("interventions")}

      <section class="dispatch-card">
        <div class="dispatch-toolbar">
          <h2>NOWA INTERWENCJA</h2>
          <button type="button" id="dispatchRefresh"
            class="dispatch-action">ODŚWIEŻ</button>
        </div>

        <form id="newInterventionForm">
          <label>Adres zdarzenia *</label>
          <input name="address" maxlength="300" required
            placeholder="Ulica, numer, miejscowość">

          <label>Osoba zgłaszająca</label>
          <input name="reporter" maxlength="150"
            placeholder="Dane zgłaszającego">

          <label>Opis zdarzenia *</label>
          <textarea name="description" maxlength="5000" required
            placeholder="Opis zgłoszenia"></textarea>

          <label>Priorytet</label>
          <select name="priority">
            ${dispatchPriorities.map(priority => `
              <option value="${priority}"
                ${priority === "Normalny" ? "selected" : ""}>
                ${priority}
              </option>
            `).join("")}
          </select>

          <label>Przydziel patrol (opcjonalnie)</label>
          <select name="unit_id" id="newInterventionUnit">
            <option value="">Bez przydziału — oczekuje</option>
          </select>

          <button class="dispatch-action primary" type="submit">
            UTWÓRZ INTERWENCJĘ
          </button>
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

    state.records.interventions = interventions;

    $("#newInterventionUnit").innerHTML =
      `<option value="">Bez przydziału — oczekuje</option>` +
      (units.length
        ? units.map(unit => `
            <option value="${unit.id}" ${isUnitAvailable(unit) ? "" : "disabled"}>
              ${escapeHtml(unit.callsign)} —
              ${escapeHtml(unit.officers || "Brak danych")}
              (${isUnitAvailable(unit) ? "Dostępny" : "Zajęty — inna interwencja"})
            </option>
          `).join("")
        : '<option value="" disabled>Brak patroli w bazie</option>');

    $("#dispatchInterventionList").innerHTML = interventions.length
      ? interventions.map(renderInterventionCard).join("")
      : `<div class="dispatch-empty">
          Brak zarejestrowanych interwencji.
        </div>`;

    await bindInterventionActions(units);
  } catch (error) {
    const list = $("#dispatchInterventionList");

    if (list) {
      list.innerHTML =
        `<p>Błąd pobierania danych: ${escapeHtml(error.message)}</p>`;
    }
  }

  $("#newInterventionForm")?.addEventListener("submit", async event => {
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
  const history = Array.isArray(item.history)
    ? item.history
    : [];

  return `
    <article class="dispatch-intervention">
      <div class="dispatch-toolbar">
        <h3>${escapeHtml(item.incident_number || `INT-${item.id}`)}</h3>
        <span class="dispatch-status">${escapeHtml(item.status)}</span>
      </div>

      <p><strong>Adres:</strong> ${escapeHtml(item.address)}</p>
      <p><strong>Zgłaszający:</strong>
        ${escapeHtml(item.reporter || "Nie podano")}
      </p>
      <p><strong>Opis:</strong> ${escapeHtml(item.description)}</p>
      <p><strong>Priorytet:</strong> ${escapeHtml(item.priority)}</p>
      <p><strong>Patrol:</strong>
        ${escapeHtml(item.unit_callsign || item.callsign || "Nieprzydzielony")}
      </p>

      <p class="dispatch-muted">
        Utworzono: ${escapeHtml(dispatchDate(item.created_at))}
      </p>

      <div class="dispatch-grid">
        <div>
          <label>Status</label>
          <select data-intervention-status="${item.id}">
            ${dispatchStatuses.map(status => `
              <option value="${status}"
                ${item.status === status ? "selected" : ""}>
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
              <small>
                ${escapeHtml(entry.actor_name || "System")} —
                ${escapeHtml(dispatchDate(entry.created_at))}
              </small>
            </div>
          `).join("")}
        </details>
      ` : ""}
    </article>
  `;
}

async function bindInterventionActions(loadedUnits = null) {
  try {
    const units = loadedUnits || await api("/api/units");

    document.querySelectorAll("[data-intervention-unit]").forEach(select => {
      const interventionId = select.dataset.interventionUnit;

      const intervention = state.records.interventions?.find(item =>
        String(item.id) === String(interventionId)
      );

      const currentUnitId = intervention?.unit_id;

      select.innerHTML =
        `<option value="">Bez patrolu</option>` +
        units.map(unit => {
          const current = String(unit.id) === String(currentUnitId);
          const available = isUnitAvailable(unit);
          const disabled = !available && !current;

          return `
            <option value="${unit.id}"
              ${current ? "selected" : ""}
              ${disabled ? "disabled" : ""}>
              ${escapeHtml(unit.callsign)} —
              ${escapeHtml(unit.officers || "Brak danych")}
              (${current ? "przydzielony do tej interwencji" : available ? "Dostępny" : "Zajęty — inna interwencja"})
            </option>
          `;
        }).join("");
    });

    document.querySelectorAll("[data-save-intervention]").forEach(button => {
      button.addEventListener("click", async () => {
        const id = button.dataset.saveIntervention;

        const statusSelect =
          document.querySelector(`[data-intervention-status="${id}"]`);

        const unitSelect =
          document.querySelector(`[data-intervention-unit="${id}"]`);

        if (!statusSelect || !unitSelect) return;

        button.disabled = true;

        try {
          await api(`/api/interventions/${id}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: statusSelect.value,
              unit_id: unitSelect.value || null
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
    showMessage(
      "Nie udało się pobrać patroli: " + error.message,
      true
    );
  }
}

// ==================================================
// STAN PATROLI
// ==================================================

async function renderDispatchUnits() {
  contentArea.innerHTML = `
    <div class="section-title">TABLET DYŻURNEGO</div>

    <div class="dispatch-wrap">
      ${dispatchNav("units")}

      <section class="dispatch-card">
        <div class="dispatch-toolbar">
          <h2>STAN PATROLI</h2>
          <button type="button" id="dispatchUnitsRefresh"
            class="dispatch-action">ODŚWIEŻ</button>
        </div>

        <div id="dispatchUnitsList">Ładowanie...</div>
      </section>
    </div>
  `;

  bindDispatchNav();

  async function loadUnits() {
    const units = await api("/api/units");
    const list = $("#dispatchUnitsList");

    if (!list) return;

    list.innerHTML = units.length
      ? units.map(unit => `
        <div class="dispatch-unit">
          <strong>${escapeHtml(unit.callsign)}</strong>
          <span class="dispatch-status">${escapeHtml(unit.status)}</span>

          <p>Funkcjonariusze:
            ${escapeHtml(unit.officers || "Brak danych")}
          </p>

          <p>Rejon:
            ${escapeHtml(unit.area || "Nie określono")}
          </p>

          <p>Pojazd:
            ${escapeHtml(unit.vehicle || "Nie określono")}
          </p>
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

// ==================================================
// HISTORIA
// ==================================================

async function loadDispatchHistoryList() {
  const list = $("#dispatchHistoryList");
  if (!list) return;

  try {
    const completed = await api("/api/interventions?archive=1");

    list.innerHTML = completed.length
      ? completed.map(item => `
        <div class="dispatch-intervention">
          <strong>${escapeHtml(item.incident_number || `INT-${item.id}`)}</strong>
          <p>Adres: ${escapeHtml(item.address)}</p>
          <p>Opis: ${escapeHtml(item.description)}</p>
          <p>Patrol: ${escapeHtml(item.unit_callsign || item.callsign || "Nieprzydzielony")}</p>
          <p>Zakończono: ${escapeHtml(dispatchDate(item.completed_at || item.updated_at))}</p>
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
    list.textContent = error.message;
  }
}

async function renderDispatchHistory() {
  contentArea.innerHTML = `
    <div class="section-title">TABLET DYŻURNEGO</div>
    <div class="dispatch-wrap">
      ${dispatchNav("history")}
      <section class="dispatch-card">
        <div class="dispatch-toolbar">
          <h2>HISTORIA INTERWENCJI</h2>
          <button type="button" id="dispatchHistoryRefresh" class="dispatch-action">ODŚWIEŻ</button>
        </div>
        <div id="dispatchHistoryList">Ładowanie...</div>
      </section>
    </div>
  `;

  bindDispatchNav();
  $("#dispatchHistoryRefresh")?.addEventListener("click", loadDispatchHistoryList);
  await loadDispatchHistoryList();
}

async function refreshDispatchView() {
  if (!state.user || !isDispatcher()) return;
  if (state.currentPage !== "dispatch") return;
  if (dispatchLoading) return;

  // Nie odświeżamy formularza, kiedy Dyżurny właśnie coś wpisuje.
  const active = document.activeElement;

  if (
    active &&
    contentArea.contains(active) &&
    ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)
  ) {
    return;
  }

  dispatchLoading = true;

  try {
    if (state.dispatchPage === "units") {
      const units = await api("/api/units");
      const list = $("#dispatchUnitsList");

      if (!list) return;

      list.innerHTML = units.length
        ? units.map(unit => `
          <div class="dispatch-unit">
            <strong>${escapeHtml(unit.callsign)}</strong>
            <span class="dispatch-status">${escapeHtml(unit.status)}</span>
            <p>Funkcjonariusze:
              ${escapeHtml(unit.officers || "Brak danych")}
            </p>
            <p>Rejon: ${escapeHtml(unit.area || "Nie określono")}</p>
            <p>Pojazd: ${escapeHtml(unit.vehicle || "Nie określono")}</p>
          </div>
        `).join("")
        : "<p>Brak zarejestrowanych patroli.</p>";
    }

    if (state.dispatchPage === "interventions") {
      const interventions = await api("/api/interventions");
      const list = $("#dispatchInterventionList");

      if (!list) return;

      state.records.interventions = interventions;

      list.innerHTML = interventions.length
        ? interventions.map(renderInterventionCard).join("")
        : `<div class="dispatch-empty">
            Brak zarejestrowanych interwencji.
          </div>`;

      await bindInterventionActions();
    }

    if (state.dispatchPage === "history") {
      await loadDispatchHistoryList();
    }
  } catch {
    // Chwilowy brak połączenia nie przerywa pracy tabletu.
  } finally {
    dispatchLoading = false;
  }
}

// ==================================================
// POWIADOMIENIA DŹWIĘKOWE
// ==================================================

function enableNotificationSound() {
  try {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

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
    // Brak obsługi audio nie blokuje aplikacji.
  }
}

document.addEventListener(
  "pointerdown",
  enableNotificationSound,
  { once: true }
);

async function checkMyInterventions() {
  if (!state.user || isDispatcher()) return;

  try {
    const interventions = await api("/api/interventions/mine");

    const currentIds = new Set(
      interventions.map(item => String(item.id))
    );

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
        `Nowa interwencja dla Twojego patrolu: ${
          newAssignments.map(item =>
            item.incident_number || `INT-${item.id}`
          ).join(", ")
        }`
      );
    }

    knownInterventionIds = currentIds;
  } catch {
    // Brak połączenia nie przerywa pracy aplikacji.
  }
}

function startBackgroundTasks() {
  stopBackgroundTasks();

  if (!state.user) return;

  if (isDispatcher()) {
    dispatchRefreshTimer = setInterval(
      refreshDispatchView,
      15000
    );
  } else {
    // Pierwsze sprawdzenie następuje od razu po zalogowaniu.
    checkMyInterventions();

    notificationTimer = setInterval(
      checkMyInterventions,
      12000
    );
  }
}

// ==================================================
// START APLIKACJI
// ==================================================

startApp();
