const state = {
  user: null,
  page: "summary",
  records: {},
  users: [],
  editing: null
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
      ["notes", "Notatki"],
      ["wanted", "Status poszukiwania"]
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

function showMessage(message, error = false) {
  const element = $("message");
  if (!element) return;

  element.textContent = message;
  element.classList.remove("hidden", "error", "success");
  element.classList.add(error ? "error" : "success");

  setTimeout(() => element.classList.add("hidden"), 5000);
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

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
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

function formValue(form, name) {
  return form.elements[name]?.value?.trim() ?? "";
}

function fieldHTML(field, value = "") {
  const [name, label] = field;
  const safeValue = escapeHTML(value);

  if (name === "notes" || name === "narrative" || name === "documents") {
    return `
      <label>${escapeHTML(label)}</label>
      <textarea name="${name}" rows="3">${safeValue}</textarea>
    `;
  }

  if (name === "dob" || name === "date") {
    return `
      <label>${escapeHTML(label)}</label>
      <input type="date" name="${name}" value="${safeValue}">
    `;
  }

  if (name === "wanted" || name === "status" && name === "wanted") {
    return `
      <label>${escapeHTML(label)}</label>
      <select name="${name}">
        <option value="">Nieustalony</option>
        <option value="Nie">Nie</option>
        <option value="Tak">Tak</option>
      </select>
    `;
  }

  return `
    <label>${escapeHTML(label)}</label>
    <input name="${name}" value="${safeValue}" ${name === "amount" ? 'type="number" min="0"' : ""}>
  `;
}

function renderRecordForm(moduleKey, record = null) {
  const config = modules[moduleKey];
  const values = record || {};

  return `
    <form id="recordForm" class="record-form">
      <div class="section-title">${record ? "EDYCJA WPISU" : "NOWY WPIS"}</div>
      ${config.fields.map(field => fieldHTML(field, values[field[0]])).join("")}
      ${moduleKey === "people" ? `
        <label>Status weryfikacji danych RP</label>
        <select name="verification_status">
          <option value="Niezweryfikowane">Niezweryfikowane</option>
          <option value="Potwierdzone w rozmowie RP">Potwierdzone w rozmowie RP</option>
          <option value="Do ponownego sprawdzenia">Do ponownego sprawdzenia</option>
        </select>
      ` : ""}
      <div class="form-actions">
        <button class="primary-button" type="submit">ZAPISZ</button>
        <button class="small-button" type="button" id="cancelEdit">ANULUJ</button>
      </div>
    </form>
  `;
}

async function loadModule(moduleKey) {
  const config = modules[moduleKey];
  const records = await api(config.endpoint);

  state.records[moduleKey] = records;
  renderModule(moduleKey);
}

function renderModule(moduleKey) {
  const config = modules[moduleKey];
  const records = state.records[moduleKey] || [];

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
    $("recordFormArea").innerHTML = renderRecordForm(moduleKey);
    bindRecordForm(moduleKey);
  });

  $("recordSearch").addEventListener("input", event => {
    renderRecordList(moduleKey, event.target.value);
  });

  renderRecordList(moduleKey);
}

function renderRecordList(moduleKey, query = "") {
  const config = modules[moduleKey];
  const records = state.records[moduleKey] || [];
  const filtered = records.filter(record =>
    Object.values(record).some(value =>
      String(value ?? "").toLowerCase().includes(query.toLowerCase())
    )
  );

  $("recordList").innerHTML = filtered.length
    ? filtered.map(record => `
      <article class="record-card">
        ${config.fields.map(([key, label]) => `
          <div><strong>${escapeHTML(label)}:</strong> ${escapeHTML(record[key] ?? "—")}</div>
        `).join("")}
        ${moduleKey === "people" ? `
          <div><strong>Weryfikacja RP:</strong> ${escapeHTML(record.verification_status || "Niezweryfikowane")}</div>
          <button class="small-button" data-check="${record.id}">SPRAWDŹ OBYWATELA</button>
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
      const record = records.find(item => item.id === Number(button.dataset.edit));
      $("recordFormArea").innerHTML = renderRecordForm(moduleKey, record);
      bindRecordForm(moduleKey, record.id);
    });
  });

  $("recordList").querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!confirm("Czy na pewno usunąć ten wpis?")) return;

      try {
        await api(`${config.endpoint}/${button.dataset.delete}`, {
          method: "DELETE"
        });
        await loadModule(moduleKey);
        showMessage("Usunięto wpis.");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });

  $("recordList").querySelectorAll("[data-check]").forEach(button => {
    button.addEventListener("click", () => {
      const record = records.find(item => item.id === Number(button.dataset.check));
      showCitizenCheck(record);
    });
  });
}

function bindRecordForm(moduleKey, recordId = null) {
  $("cancelEdit").addEventListener("click", () => {
    $("recordFormArea").innerHTML = "";
  });

  $("recordForm").addEventListener("submit", async event => {
    event.preventDefault();

    const form = event.currentTarget;
    const config = modules[moduleKey];
    const data = {};

    config.fields.forEach(([key]) => {
      data[key] = formValue(form, key);
    });

    if (moduleKey === "people") {
      data.verification_status = formValue(form, "verification_status") || "Niezweryfikowane";
      data.wanted = data.wanted || "Nie";
    }

    if (moduleKey === "reports") {
      data.narrative = data.narrative || "";
    }

    try {
      await api(
        recordId ? `${config.endpoint}/${recordId}` : config.endpoint,
        {
          method: recordId ? "PATCH" : "POST",
          body: JSON.stringify(data)
        }
      );

      $("recordFormArea").innerHTML = "";
      await loadModule(moduleKey);
      showMessage("Zapisano wpis.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

function showCitizenCheck(person) {
  const area = $("contentArea");

  area.innerHTML = `
    <div class="section-title">SPRAWDZANIE OBYWATELA</div>
    <article class="record-card">
      <h3>${escapeHTML(person.first_name || "")} ${escapeHTML(person.last_name || person.name || "")}</h3>
      <p><strong>Identyfikator RP:</strong> ${escapeHTML(person.pesel || "—")}</p>
      <p><strong>Data urodzenia:</strong> ${escapeHTML(person.dob || "—")}</p>
      <p><strong>Adres RP:</strong> ${escapeHTML(person.address || "—")}</p>
      <p><strong>Telefon RP:</strong> ${escapeHTML(person.phone || "—")}</p>
      <p><strong>Status poszukiwania RP:</strong> ${escapeHTML(person.wanted || "Nieustalony")}</p>
      <p><strong>Weryfikacja:</strong> ${escapeHTML(person.verification_status || "Niezweryfikowane")}</p>
      <p class="muted">Weryfikacja dotyczy wyłącznie rozmowy i danych fikcyjnych w ramach RP. Nie potwierdza prawdziwej tożsamości.</p>
      <button class="small-button" id="backToPeople">WRÓĆ DO REJESTRU</button>
    </article>
  `;

  $("backToPeople").addEventListener("click", () => openPage("people"));
}

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

async function renderUsers() {
  if (!isAdmin()) {
    showMessage("Brak uprawnień.", true);
    return;
  }

  state.users = await api("/api/users");

  $("contentArea").innerHTML = `
    <div class="section-title">ZARZĄDZANIE DOSTĘPAMI</div>
    <form id="userForm" class="record-form">
      <h3>UTWÓRZ KONTO FUNKCJONARIUSZA</h3>
      <label>Login</label>
      <input name="username" required minlength="3">
      <label>Hasło początkowe</label>
      <input name="password" type="password" required minlength="12">
      <label>Wyświetlana nazwa (opcjonalnie)</label>
      <input name="display_name">
      <label>Numer odznaki (opcjonalnie)</label>
      <input name="badge">
      <label>Stopień</label>
      <select name="rank" required>
        ${ranks.map(rank => `<option>${escapeHTML(rank)}</option>`).join("")}
      </select>
      <button class="primary-button" type="submit">UTWÓRZ KONTO</button>
    </form>
    <div class="section-title">KONTA FUNKCJONARIUSZY</div>
    <div id="usersList" class="record-list">
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

    const data = {
      username: formValue(form, "username"),
      password: formValue(form, "password"),
      display_name: formValue(form, "display_name"),
      badge: formValue(form, "badge"),
      rank: formValue(form, "rank"),
      role_group: "Funkcjonariusz"
    };

    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify(data)
      });
      showMessage("Utworzono konto.");
      await renderUsers();
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  document.querySelectorAll("[data-toggle-user]").forEach(button => {
    button.addEventListener("click", async () => {
      const active = button.dataset.active !== "1";

      try {
        await api(`/api/users/${button.dataset.toggleUser}/active`, {
          method: "PATCH",
          body: JSON.stringify({ active })
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

async function openPage(page) {
  state.page = page;

  try {
    if (page === "summary") {
      await renderSummary();
    } else if (page === "users") {
      await renderUsers();
    } else if (modules[page]) {
      await loadModule(page);
    }
  } catch (error) {
    showMessage(error.message, true);
  }
}

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
          username: formValue(form, "username"),
          password: formValue(form, "password")
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
          username: formValue(form, "username"),
          password: formValue(form, "password")
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
