const state = {
  user: null,
  records: {},
  users: []
};

const modules = {
  people: {
    title: "REJESTR OBYWATELI",
    endpoint: "/api/people",
    fields: [
      ["first_name", "Imię"],
      ["last_name", "Nazwisko"],
      ["pesel", "Identyfikator RP (fikcyjny)"],
      ["dob", "Data urodzenia"],
      ["address", "Adres RP"],
      ["phone", "Telefon RP (fikcyjny)"],
      ["documents", "Dokumenty RP"],
      ["notes", "Notatki"]
    ]
  },
  vehicles: {
    title: "POJAZDY",
    endpoint: "/api/vehicles",
    fields: [
      ["plate", "Numer rejestracyjny RP"],
      ["brand", "Marka"],
      ["model", "Model"],
      ["color", "Kolor"],
      ["owner", "Właściciel RP"],
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
      ["amount", "Kwota mandatu"],
      ["date", "Data"],
      ["officer", "Funkcjonariusz"],
      ["notes", "Uwagi"]
    ]
  },
  reports: {
    title: "RAPORTY",
    endpoint: "/api/reports",
    fields: [
      ["title", "Tytuł raportu"],
      ["type", "Rodzaj raportu"],
      ["date", "Data"],
      ["officer", "Funkcjonariusz"],
      ["status", "Status"],
      ["narrative", "Treść raportu"]
    ]
  },
  units: {
    title: "PATROLE",
    endpoint: "/api/units",
    fields: [
      ["callsign", "Numer patrolu"],
      ["officers", "Funkcjonariusze"],
      ["vehicle", "Pojazd"],
      ["status", "Status patrolu"],
      ["area", "Rejon"],
      ["notes", "Uwagi"]
    ]
  }
};

const ranks = [
  "Posterunkowy",
  "Starszy posterunkowy",
  "Sierżant",
  "Starszy sierżant",
  "Sierżant sztabowy",
  "Młodszy aspirant",
  "Aspirant",
  "Starszy aspirant",
  "Aspirant sztabowy",
  "Podkomisarz",
  "Komisarz",
  "Nadkomisarz",
  "Podinspektor",
  "Młodszy inspektor",
  "Inspektor",
  "Nadinspektor",
  "Generalny inspektor"
];

const $ = id => document.getElementById(id);

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || "Wystąpił błąd.");
  }

  return data;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function showMessage(message, error = false) {
  const element = $("message");
  if (!element) return;

  element.textContent = message;
  element.classList.remove("hidden", "error", "success");
  element.classList.add(error ? "error" : "success");

  setTimeout(() => element.classList.add("hidden"), 4500);
}

function showScreen(screen) {
  ["loginScreen", "setupScreen", "dashboardScreen"].forEach(id => {
    const element = $(id);
    if (!element) return;

    const active = id === screen;
    element.classList.toggle("hidden", !active);
    element.hidden = !active;
  });
}

function isAdmin() {
  return state.user?.roleGroup === "Komendantura";
}

function renderUserDetails() {
  if (!state.user) return;

  $("welcomeName").textContent =
    state.user.displayName || state.user.username || "FUNKCJONARIUSZ";

  $("userDetails").textContent = [
    state.user.rank || "Funkcjonariusz",
    state.user.badge ? `Nr ${state.user.badge}` : "",
    "KPP Lubin"
  ].filter(Boolean).join(" • ");

  $("usersMenuButton")?.classList.toggle("hidden", !isAdmin());
}

function getValue(form, name) {
  return form.elements[name]?.value?.trim() || "";
}

function renderField([name, label], value = "") {
  const safe = escapeHTML(value);

  if (["notes", "narrative", "documents"].includes(name)) {
    return `
      <label>${escapeHTML(label)}</label>
      <textarea name="${name}" rows="3">${safe}</textarea>
    `;
  }

  if (["dob", "date"].includes(name)) {
    return `
      <label>${escapeHTML(label)}</label>
      <input name="${name}" type="date" value="${safe}">
    `;
  }

  return `
    <label>${escapeHTML(label)}</label>
    <input name="${name}" value="${safe}" ${name === "amount" ? 'type="number" min="0"' : ""}>
  `;
}

function recordFormHTML(key, record = {}) {
  const config = modules[key];

  return `
    <form id="recordForm" class="record-form">
      <div class="section-title">${record.id ? "EDYCJA WPISU" : "NOWY WPIS"}</div>
      ${config.fields.map(field => renderField(field, record[field[0]])).join("")}

      ${key === "people" ? `
        <label>Status poszukiwania RP</label>
        <select name="wanted">
          <option value="Nie" ${record.wanted === "Nie" ? "selected" : ""}>Nie</option>
          <option value="Tak" ${record.wanted === "Tak" ? "selected" : ""}>Tak</option>
        </select>

        <label>Status weryfikacji RP</label>
        <select name="verification_status">
          ${[
            "Niezweryfikowane",
            "Potwierdzone w rozmowie RP",
            "Do ponownego sprawdzenia"
          ].map(value => `
            <option ${record.verification_status === value ? "selected" : ""}>${value}</option>
          `).join("")}
        </select>
      ` : ""}

      <div class="form-actions">
        <button class="primary-button" type="submit">ZAPISZ</button>
        <button class="small-button" type="button" id="cancelEdit">ANULUJ</button>
      </div>
    </form>
  `;
}

async function loadModule(key) {
  const records = await api(modules[key].endpoint);
  state.records[key] = records;
  renderModule(key);
}

function renderModule(key) {
  const config = modules[key];

  $("contentArea").innerHTML = `
    <div class="section-title">${config.title}</div>
    <button class="primary-button" id="addRecord">DODAJ WPIS</button>
    <div id="recordFormArea"></div>
    <div class="search-area">
      <input id="recordSearch" placeholder="Szukaj..." autocomplete="off">
    </div>
    <div id="recordList" class="record-list"></div>
  `;

  $("addRecord").addEventListener("click", () => {
    $("recordFormArea").innerHTML = recordFormHTML(key);
    bindRecordForm(key);
  });

  $("recordSearch").addEventListener("input", event => {
    renderRecordList(key, event.target.value);
  });

  renderRecordList(key);
}

function renderRecordList(key, query = "") {
  const config = modules[key];
  const records = state.records[key] || [];

  const filtered = records.filter(record =>
    Object.values(record).some(value =>
      String(value ?? "").toLowerCase().includes(query.toLowerCase())
    )
  );

  $("recordList").innerHTML = filtered.length
    ? filtered.map(record => `
      <article class="record-card">
        ${config.fields.map(([field, label]) => `
          <div><strong>${escapeHTML(label)}:</strong> ${escapeHTML(record[field] || "—")}</div>
        `).join("")}

        ${key === "people" ? `
          <div><strong>Weryfikacja RP:</strong> ${escapeHTML(record.verification_status || "Niezweryfikowane")}</div>
        ` : ""}

        <div class="record-actions">
          <button class="small-button" data-edit="${record.id}">EDYTUJ</button>
          <button class="small-button danger-button" data-delete="${record.id}">USUŃ</button>
        </div>
      </article>
    `).join("")
    : `<p class="muted">Brak wpisów.</p>`;

  $("recordList").querySelectorAll("[data-edit]").forEach(button => {
    button.addEventListener("click", () => {
      const record = filtered.find(item => item.id === Number(button.dataset.edit));
      $("recordFormArea").innerHTML = recordFormHTML(key, record);
      bindRecordForm(key, record.id);
    });
  });

  $("recordList").querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!confirm("Czy na pewno usunąć ten wpis?")) return;

      try {
        await api(`${config.endpoint}/${button.dataset.delete}`, {
          method: "DELETE"
        });
        await loadModule(key);
        showMessage("Usunięto wpis.");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });
}

function bindRecordForm(key, recordId = null) {
  $("cancelEdit").addEventListener("click", () => {
    $("recordFormArea").innerHTML = "";
  });

  $("recordForm").addEventListener("submit", async event => {
    event.preventDefault();

    const form = event.currentTarget;
    const data = {};

    modules[key].fields.forEach(([field]) => {
      data[field] = getValue(form, field);
    });

    if (key === "people") {
      data.wanted = getValue(form, "wanted") || "Nie";
      data.verification_status =
        getValue(form, "verification_status") || "Niezweryfikowane";
    }

    try {
      await api(
        recordId
          ? `${modules[key].endpoint}/${recordId}`
          : modules[key].endpoint,
        {
          method: recordId ? "PATCH" : "POST",
          body: JSON.stringify(data)
        }
      );

      $("recordFormArea").innerHTML = "";
      await loadModule(key);
      showMessage("Zapisano wpis.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

/* OSOBNA ZAKŁADKA: SPRAWDZANIE OBYWATELI */

async function renderCitizenSearch() {
  const people = await api("/api/people");

  $("contentArea").innerHTML = `
    <div class="section-title">SPRAWDZANIE OBYWATELI</div>
    <p class="muted">
      Wyszukaj fikcyjny profil RP po imieniu, nazwisku lub identyfikatorze RP.
    </p>
    <div class="search-area">
      <input id="citizenSearchInput" placeholder="Wpisz dane obywatela..." autocomplete="off">
    </div>
    <div id="citizenResults" class="record-list">
      <p class="muted">Wpisz dane, aby rozpocząć wyszukiwanie.</p>
    </div>
  `;

  $("citizenSearchInput").addEventListener("input", event => {
    const query = event.target.value.trim().toLowerCase();

    if (!query) {
      $("citizenResults").innerHTML =
        '<p class="muted">Wpisz dane, aby rozpocząć wyszukiwanie.</p>';
      return;
    }

    const results = people.filter(person =>
      [
        person.name,
        person.first_name,
        person.last_name,
        person.pesel
      ].some(value => String(value || "").toLowerCase().includes(query))
    );

    $("citizenResults").innerHTML = results.length
      ? results.map(person => `
        <article class="record-card">
          <strong>${escapeHTML(
            `${person.first_name || ""} ${person.last_name || person.name || ""}`
          )}</strong>
          <div>Identyfikator RP: ${escapeHTML(person.pesel || "—")}</div>
          <div>Status RP: ${escapeHTML(person.wanted || "Nieustalony")}</div>
          <div>Weryfikacja: ${escapeHTML(person.verification_status || "Niezweryfikowane")}</div>
          <button class="small-button" data-citizen="${person.id}">OTWÓRZ PROFIL</button>
        </article>
      `).join("")
      : '<p class="muted">Nie znaleziono obywatela.</p>';

    $("citizenResults").querySelectorAll("[data-citizen]").forEach(button => {
      button.addEventListener("click", () => {
        const person = people.find(item => item.id === Number(button.dataset.citizen));
        renderCitizenProfile(person);
      });
    });
  });
}

async function renderCitizenProfile(person) {
  const [citations, vehicles, reports] = await Promise.all([
    api("/api/citations"),
    api("/api/vehicles"),
    api("/api/reports")
  ]);

  const name = person.name ||
    `${person.first_name || ""} ${person.last_name || ""}`.trim();

  const relatedCitations = citations.filter(item =>
    item.person_id === person.id ||
    String(item.person || "").toLowerCase() === name.toLowerCase()
  );

  const relatedVehicles = vehicles.filter(item =>
    item.person_id === person.id ||
    String(item.owner || "").toLowerCase() === name.toLowerCase()
  );

  const relatedReports = reports.filter(item =>
    item.person_id === person.id ||
    String(item.narrative || "").toLowerCase().includes(name.toLowerCase())
  );

  $("contentArea").innerHTML = `
    <div class="section-title">KARTA OBYWATELA RP</div>
    <article class="record-card">
      <h3>${escapeHTML(name || "Nieznany obywatel")}</h3>
      <div>Identyfikator RP: ${escapeHTML(person.pesel || "—")}</div>
      <div>Data urodzenia: ${escapeHTML(person.dob || "—")}</div>
      <div>Adres RP: ${escapeHTML(person.address || "—")}</div>
      <div>Telefon RP: ${escapeHTML(person.phone || "—")}</div>
      <div>Dokumenty RP: ${escapeHTML(person.documents || "—")}</div>
      <div>Status poszukiwania RP: ${escapeHTML(person.wanted || "Nieustalony")}</div>
      <div>Status weryfikacji: ${escapeHTML(person.verification_status || "Niezweryfikowane")}</div>
      <p class="muted">
        Potwierdzenie oznacza wyłącznie potwierdzenie danych podczas rozmowy w RP.
        Nie jest weryfikacją prawdziwej tożsamości.
      </p>
    </article>

    <div class="section-title">MANDATY RP (${relatedCitations.length})</div>
    ${relatedCitations.map(item => `
      <article class="record-card">
        ${escapeHTML(item.charge || "Mandat")}
        <div>Kwota: ${escapeHTML(item.amount || "—")}</div>
      </article>
    `).join("") || '<p class="muted">Brak powiązanych mandatów.</p>'}

    <div class="section-title">POJAZDY RP (${relatedVehicles.length})</div>
    ${relatedVehicles.map(item => `
      <article class="record-card">
        ${escapeHTML(item.plate || "—")}
        <div>${escapeHTML(`${item.brand || ""} ${item.model || ""}`)}</div>
      </article>
    `).join("") || '<p class="muted">Brak powiązanych pojazdów.</p>'}

    <div class="section-title">RAPORTY RP (${relatedReports.length})</div>
    ${relatedReports.map(item => `
      <article class="record-card">${escapeHTML(item.title || "Raport")}</article>
    `).join("") || '<p class="muted">Brak powiązanych raportów.</p>'}

    <button class="small-button" id="backToCitizenSearch">WRÓĆ DO WYSZUKIWANIA</button>
  `;

  $("backToCitizenSearch").addEventListener("click", renderCitizenSearch);
}

/* PULPIT */

async function renderSummary() {
  const summary = await api("/api/summary");

  $("contentArea").innerHTML = `
    <div class="section-title">PULPIT SŁUŻBOWY</div>
    <div class="summary-grid">
      ${Object.entries(summary).map(([key, value]) => `
        <article class="record-card">
          <div class="muted">${escapeHTML(key)}</div>
          <div class="welcome-name">${escapeHTML(value)}</div>
        </article>
      `).join("")}
    </div>
  `;
}

/* ZARZĄDZANIE DOSTĘPAMI */

async function renderUsers() {
  if (!isAdmin()) {
    showMessage("Brak uprawnień.", true);
    return;
  }

  state.users = await api("/api/users");

  $("contentArea").innerHTML = `
    <div class="section-title">ZARZĄDZANIE DOSTĘPAMI</div>

    <form id="userForm" class="record-form">
      <h3>NOWE KONTO FUNKCJONARIUSZA</h3>
      <label>Login</label>
      <input name="username" required minlength="3">

      <label>Hasło początkowe</label>
      <input name="password" type="password" required minlength="12">

      <label>Nazwa wyświetlana (opcjonalnie)</label>
      <input name="display_name">

      <label>Numer odznaki (opcjonalnie)</label>
      <input name="badge">

      <label>Stopień</label>
      <select name="rank">
        ${ranks.map(rank => `<option>${escapeHTML(rank)}</option>`).join("")}
      </select>

      <button class="primary-button" type="submit">UTWÓRZ KONTO</button>
    </form>

    <div class="section-title">KONTA FUNKCJONARIUSZY</div>
    <div class="record-list">
      ${state.users.map(user => `
        <article class="record-card">
          <strong>${escapeHTML(user.display_name || user.username)}</strong>
          <div>Login: ${escapeHTML(user.username)}</div>
          <div>Stopień: ${escapeHTML(user.rank || "—")}</div>
          <div>Odznaka: ${escapeHTML(user.badge || "—")}</div>
          <div>Status: ${user.active ? "Aktywne" : "Zablokowane"}</div>
          <div class="record-actions">
            <button class="small-button" data-toggle-user="${user.id}" data-active="${user.active ? "1" : "0"}">
              ${user.active ? "ZABLOKUJ" : "ODBLOKUJ"}
            </button>
            <button class="small-button danger-button" data-delete-user="${user.id}">USUŃ KONTO</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;

  $("userForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;

    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: getValue(form, "username"),
          password: getValue(form, "password"),
          display_name: getValue(form, "display_name"),
          badge: getValue(form, "badge"),
          rank: getValue(form, "rank"),
          role_group: "Funkcjonariusz"
        })
      });

      showMessage("Utworzono konto.");
      await renderUsers();
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  document.querySelectorAll("[data-toggle-user]").forEach(button => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/users/${button.dataset.toggleUser}/active`, {
          method: "PATCH",
          body: JSON.stringify({
            active: button.dataset.active !== "1"
          })
        });
        await renderUsers();
        showMessage("Zmieniono status konta.");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });

  document.querySelectorAll("[data-delete-user]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!confirm("Czy na pewno usunąć konto?")) return;

      try {
        await api(`/api/users/${button.dataset.deleteUser}`, {
          method: "DELETE"
        });
        await renderUsers();
        showMessage("Usunięto konto.");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });
}

/* NAWIGACJA */

async function openPage(page) {
  try {
    if (page === "summary") {
      await renderSummary();
    } else if (page === "citizenSearch") {
      await renderCitizenSearch();
    } else if (page === "users") {
      await renderUsers();
    } else if (modules[page]) {
      await loadModule(page);
    }
  } catch (error) {
    showMessage(error.message, true);
  }
}

/* LOGOWANIE I START */

async function loadInitialState() {
  try {
    const status = await api("/api/status");

    if (status.needsSetup) {
      showScreen("setupScreen");
      return;
    }

    const result = await api("/api/me");

    if (result.user) {
      state.user = result.user;
      renderUserDetails();
      showScreen("dashboardScreen");
      await openPage("summary");
    } else {
      showScreen("loginScreen");
    }
  } catch (error) {
    showScreen("loginScreen");
    showMessage("Nie udało się połączyć z serwerem: " + error.message, true);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("setupForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;

    try {
      const result = await api("/api/setup", {
        method: "POST",
        body: JSON.stringify({
          username: getValue(form, "username"),
          password: getValue(form, "password")
        })
      });

      state.user = result.user;
      renderUserDetails();
      showScreen("dashboardScreen");
      await openPage("summary");
      showMessage("Utworzono konto Komendantury.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;

    try {
      const result = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          username: getValue(form, "username"),
          password: getValue(form, "password")
        })
      });

      state.user = result.user;
      renderUserDetails();
      showScreen("dashboardScreen");
      await openPage("summary");
      showMessage("Zalogowano.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  $("logoutButton").addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } finally {
      state.user = null;
      showScreen("loginScreen");
    }
  });

  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => openPage(button.dataset.page));
  });

  loadInitialState();
});
