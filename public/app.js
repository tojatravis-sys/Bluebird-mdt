
"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  user: null,
  page: "summary",
  records: [],
  users: [],
  status: null
};

const modules = {
  people: {
    title: "Osoby",
    endpoint: "/api/people",
    fields: [
      ["first_name", "Imię"],
      ["last_name", "Nazwisko"],
      ["pesel", "PESEL"],
      ["address", "Adres"],
      ["notes", "Uwagi"]
    ]
  },
  vehicles: {
    title: "Pojazdy",
    endpoint: "/api/vehicles",
    fields: [
      ["registration", "Numer rejestracyjny"],
      ["brand", "Marka"],
      ["model", "Model"],
      ["color", "Kolor"],
      ["owner", "Właściciel"],
      ["notes", "Uwagi"]
    ]
  },
  citations: {
    title: "Mandaty",
    endpoint: "/api/citations",
    fields: [
      ["person", "Osoba"],
      ["offence", "Wykroczenie"],
      ["amount", "Kwota"],
      ["date", "Data"],
      ["officer", "Funkcjonariusz"],
      ["notes", "Uwagi"]
    ]
  },
  reports: {
    title: "Raporty",
    endpoint: "/api/reports",
    fields: [
      ["title", "Tytuł"],
      ["description", "Opis"],
      ["date", "Data"],
      ["officer", "Funkcjonariusz"],
      ["status", "Status"]
    ]
  },
  units: {
    title: "Patrole",
    endpoint: "/api/units",
    fields: [
      ["unit_name", "Oznaczenie patrolu"],
      ["officers", "Funkcjonariusze"],
      ["vehicle", "Pojazd"],
      ["status", "Status"],
      ["location", "Lokalizacja"],
      ["notes", "Uwagi"]
    ]
  }
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showMessage(message, isError = false) {
  const box = $("#message");

  if (!box) {
    alert(message);
    return;
  }

  box.textContent = message;
  box.classList.toggle("error", isError);
  box.classList.toggle("success", !isError);
  box.hidden = false;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || "Wystąpił błąd serwera.");
  }

  return data;
}

function showScreen(screenId) {
  ["loginScreen", "setupScreen", "dashboardScreen"].forEach(id => {
    const screen = $("#" + id);
    if (!screen) return;

    screen.classList.toggle("hidden", id !== screenId);
    screen.hidden = id !== screenId;
  });
}

function getFormValue(form, name) {
  const field = form.elements.namedItem(name);
  return field ? field.value.trim() : "";
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value ?? "";
}

function isAdmin() {
  return state.user?.role === "admin" ||
    state.user?.role_group === "Komendantura" ||
    state.user?.is_admin === 1 ||
    state.user?.is_admin === true;
}

function displayName() {
  return state.user?.display_name ||
    state.user?.username ||
    "Funkcjonariusz";
}

function updateDashboardHeader() {
  setText("#welcomeName", displayName());
  setText("#userName", displayName());
  setText("#userRank", state.user?.rank || "Funkcjonariusz");
  setText("#organizationName", "KPP Lubin");

  const usersMenu = $('[data-page="users"]');

  if (usersMenu) {
    usersMenu.classList.toggle("hidden", !isAdmin());
    usersMenu.hidden = !isAdmin();
  }
}

function showDashboard() {
  if (!state.user) {
    showScreen("loginScreen");
    return;
  }

  updateDashboardHeader();
  showScreen("dashboardScreen");
  openPage("summary");
}

async function loadInitialState() {
  showScreen("loginScreen");

  try {
    const status = await api("/api/status");
    state.status = status;

    if (status.needsSetup || status.setupRequired || status.initialSetup) {
      showScreen("setupScreen");
      return;
    }

    const result = await api("/api/me");
    const user = result.user || result;

    if (!user || !user.username) {
      state.user = null;
      showScreen("loginScreen");
      return;
    }

    state.user = user;
    showDashboard();

  } catch (error) {
    state.user = null;

    if (state.status?.needsSetup || state.status?.setupRequired) {
      showScreen("setupScreen");
    } else {
      showScreen("loginScreen");
      showMessage("Sesja wygasła lub nie można połączyć się z serwerem. Zaloguj się ponownie.", true);
    }
  }
}

function bindAuthentication() {
  const loginForm = $("#loginForm");

  if (loginForm) {
    loginForm.addEventListener("submit", async event => {
      event.preventDefault();

      const username = getFormValue(loginForm, "username");
      const password = getFormValue(loginForm, "password");

      if (!username || !password) {
        showMessage("Wpisz login i hasło.", true);
        return;
      }

      try {
        const result = await api("/api/login", {
          method: "POST",
          body: JSON.stringify({ username, password })
        });

        state.user = result.user || result;

        if (!state.user.username) {
          throw new Error("Serwer nie zwrócił danych zalogowanego użytkownika.");
        }

        loginForm.reset();
        showDashboard();

      } catch (error) {
        state.user = null;
        showScreen("loginScreen");
        showMessage(error.message, true);
      }
    });
  }

  const setupForm = $("#setupForm");

  if (setupForm) {
    setupForm.addEventListener("submit", async event => {
      event.preventDefault();

      const username = getFormValue(setupForm, "username");
      const password = getFormValue(setupForm, "password");

      if (!username || !password) {
        showMessage("Uzupełnij login i hasło.", true);
        return;
      }

      if (password.length < 12) {
        showMessage("Hasło musi mieć co najmniej 12 znaków.", true);
        return;
      }

      try {
        const result = await api("/api/setup", {
          method: "POST",
          body: JSON.stringify({ username, password })
        });

        state.user = result.user || result;

        if (!state.user.username) {
          throw new Error("Nie udało się odczytać utworzonego konta.");
        }

        setupForm.reset();
        showDashboard();

      } catch (error) {
        showScreen("setupScreen");
        showMessage(error.message, true);
      }
    });
  }

  const logoutButton = $("#logoutButton");

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      try {
        await api("/api/logout", { method: "POST" });
      } catch {
        // Wylogowanie lokalne również czyści ekran.
      }

      state.user = null;
      showScreen("loginScreen");
      showMessage("Wylogowano. Wprowadź login i hasło.");
    });
  }
}

function bindNavigation() {
  $$("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      if (!state.user) {
        showScreen("loginScreen");
        return;
      }

      const page = button.dataset.page;

      if (page === "users" && !isAdmin()) {
        showMessage("Brak uprawnień do zarządzania kontami.", true);
        return;
      }

      openPage(page);
    });
  });
}

function setActiveMenu(page) {
  $$("[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });
}

function contentElement() {
  return $("#contentArea") ||
    $("#content") ||
    $("#mainContent") ||
    $(".dashboard-content");
}

function renderContainer(title, description = "") {
  const content = contentElement();

  if (!content) {
    showMessage("Nie znaleziono obszaru pulpitu w HTML.", true);
    return null;
  }

  content.innerHTML = `
    <section class="content-card">
      <h2>${escapeHTML(title)}</h2>
      ${description ? `<p>${escapeHTML(description)}</p>` : ""}
      <div id="pageContent"></div>
    </section>
  `;

  return $("#pageContent");
}

function openPage(page) {
  if (!state.user) {
    showScreen("loginScreen");
    return;
  }

  state.page = page;
  setActiveMenu(page);

  if (page === "summary") {
    renderSummary();
    return;
  }

  if (page === "users") {
    if (!isAdmin()) {
      showMessage("Brak uprawnień.", true);
      return;
    }

    renderUsers();
    return;
  }

  if (modules[page]) {
    renderModule(page);
  }
}

async function renderSummary() {
  const target = renderContainer(
    "Pulpit KPP Lubin",
    "Panel systemu Bluebird MDT."
  );

  if (!target) return;

  target.innerHTML = "<p>Ładowanie danych...</p>";

  try {
    const data = await api("/api/summary");

    const values = [
      ["Osoby", data.people ?? data.peopleCount ?? 0],
      ["Pojazdy", data.vehicles ?? data.vehiclesCount ?? 0],
      ["Mandaty", data.citations ?? data.citationsCount ?? 0],
      ["Raporty", data.reports ?? data.reportsCount ?? 0],
      ["Patrole", data.units ?? data.unitsCount ?? 0]
    ];

    target.innerHTML = `
      <div class="summary-grid">
        ${values.map(([label, value]) => `
          <div class="summary-card">
            <div class="summary-number">${escapeHTML(value)}</div>
            <div class="summary-label">${escapeHTML(label)}</div>
          </div>
        `).join("")}
      </div>
      <p class="dashboard-note">Zalogowano jako: <strong>${escapeHTML(displayName())}</strong></p>
      <p class="dashboard-note">Jednostka: KPP Lubin</p>
    `;
  } catch (error) {
    target.innerHTML = `<p class="error">${escapeHTML(error.message)}</p>`;
  }
}

function renderRecordForm(page, record = null) {
  const module = modules[page];
  const target = $("#pageContent");

  if (!target) return;

  const fields = module.fields.map(([key, label]) => {
    const value = record?.[key] ?? "";
    const isLong = ["notes", "description"].includes(key);

    return `
      <label class="field">
        <span>${escapeHTML(label)}</span>
        ${isLong
          ? `<textarea name="${escapeHTML(key)}" rows="3">${escapeHTML(value)}</textarea>`
          : `<input name="${escapeHTML(key)}" value="${escapeHTML(value)}" autocomplete="off">`
        }
      </label>
    `;
  }).join("");

  target.innerHTML = `
    <form id="recordForm" class="data-form">
      ${fields}
      <div class="content-actions">
        <button type="submit">Zapisz wpis</button>
        <button type="button" id="cancelRecord" class="secondary-button">Anuluj</button>
      </div>
    </form>
  `;

  $("#cancelRecord").addEventListener("click", () => renderModule(page));

  $("#recordForm").addEventListener("submit", async event => {
    event.preventDefault();

    const form = event.currentTarget;
    const body = {};

    module.fields.forEach(([key]) => {
      body[key] = getFormValue(form, key);
    });

    try {
      if (record?.id) {
        await api(`${module.endpoint}/${encodeURIComponent(record.id)}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        });
      } else {
        await api(module.endpoint, {
          method: "POST",
          body: JSON.stringify(body)
        });
      }

      showMessage("Zapisano wpis.");
      renderModule(page);
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

async function renderModule(page) {
  const module = modules[page];
  const target = renderContainer(module.title, "Rejestr KPP Lubin.");

  if (!target) return;

  target.innerHTML = `
    <div class="content-actions">
      <button type="button" id="addRecord">Dodaj wpis</button>
    </div>
    <p>Ładowanie danych...</p>
  `;

  $("#addRecord").addEventListener("click", () => renderRecordForm(page));

  try {
    const result = await api(module.endpoint);
    const records = Array.isArray(result)
      ? result
      : (result.items || result.records || []);

    state.records = records;

    target.innerHTML = `
      <div class="content-actions">
        <button type="button" id="addRecord">Dodaj wpis</button>
      </div>
      ${records.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                ${module.fields.slice(0, 4).map(([, label]) => `<th>${escapeHTML(label)}</th>`).join("")}
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              ${records.map((record, index) => `
                <tr>
                  ${module.fields.slice(0, 4).map(([key]) => `<td>${escapeHTML(record[key] ?? "—")}</td>`).join("")}
                  <td>
                    <button type="button" data-edit="${index}">Edytuj</button>
                    <button type="button" class="danger-button" data-delete="${index}">Usuń</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : "<p>Brak wpisów w tym rejestrze.</p>"}
    `;

    $("#addRecord").addEventListener("click", () => renderRecordForm(page));

    $$("[data-edit]", target).forEach(button => {
      button.addEventListener("click", () => {
        renderRecordForm(page, records[Number(button.dataset.edit)]);
      });
    });

    $$("[data-delete]", target).forEach(button => {
      button.addEventListener("click", async () => {
        const record = records[Number(button.dataset.delete)];

        if (!record?.id) {
          showMessage("Nie można ustalić identyfikatora wpisu.", true);
          return;
        }

        if (!confirm("Czy na pewno usunąć ten wpis?")) return;

        try {
          await api(`${module.endpoint}/${encodeURIComponent(record.id)}`, {
            method: "DELETE"
          });

          showMessage("Usunięto wpis.");
          renderModule(page);
        } catch (error) {
          showMessage(error.message, true);
        }
      });
    });
  } catch (error) {
    target.innerHTML = `<p class="error">${escapeHTML(error.message)}</p>`;
  }
}

async function renderUsers() {
  if (!isAdmin()) return;

  const target = renderContainer(
    "Zarządzanie kontami",
    "Tworzenie, blokowanie i usuwanie dostępów funkcjonariuszy."
  );

  if (!target) return;

  target.innerHTML = `
    <div class="content-actions">
      <button type="button" id="addUser">Utwórz konto funkcjonariusza</button>
    </div>
    <p>Ładowanie kont...</p>
  `;

  $("#addUser").addEventListener("click", renderUserForm);

  try {
    const result = await api("/api/users");
    const users = Array.isArray(result)
      ? result
      : (result.users || result.items || []);

    state.users = users;

    target.innerHTML = `
      <div class="content-actions">
        <button type="button" id="addUser">Utwórz konto funkcjonariusza</button>
      </div>
      ${users.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Login</th>
                <th>Nazwa</th>
                <th>Stopień</th>
                <th>Status</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              ${users.map((user, index) => `
                <tr>
                  <td>${escapeHTML(user.username)}</td>
                  <td>${escapeHTML(user.display_name || "—")}</td>
                  <td>${escapeHTML(user.rank || "—")}</td>
                  <td>${user.active === false || user.active === 0 ? "Zablokowane" : "Aktywne"}</td>
                  <td>
                    <button type="button" data-toggle-user="${index}">
                      ${user.active === false || user.active === 0 ? "Odblokuj" : "Zablokuj"}
                    </button>
                    <button type="button" class="danger-button" data-remove-user="${index}">Usuń</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : "<p>Nie utworzono jeszcze innych kont.</p>"}
    `;

    $("#addUser").addEventListener("click", renderUserForm);

    $$("[data-toggle-user]", target).forEach(button => {
      button.addEventListener("click", async () => {
        const user = users[Number(button.dataset.toggleUser)];

        try {
          await api(`/api/users/${encodeURIComponent(user.id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              active: !(user.active === false || user.active === 0)
            })
          });

          showMessage("Zmieniono status konta.");
          renderUsers();
        } catch (error) {
          showMessage(error.message, true);
        }
      });
    });

    $$("[data-remove-user]", target).forEach(button => {
      button.addEventListener("click", async () => {
        const user = users[Number(button.dataset.removeUser)];

        if (!confirm(`Usunąć konto ${user.username}?`)) return;

        try {
          await api(`/api/users/${encodeURIComponent(user.id)}`, {
            method: "DELETE"
          });

          showMessage("Usunięto konto.");
          renderUsers();
        } catch (error) {
          showMessage(error.message, true);
        }
      });
    });
  } catch (error) {
    target.innerHTML = `<p class="error">${escapeHTML(error.message)}</p>`;
  }
}

function renderUserForm() {
  const target = $("#pageContent");

  if (!target || !isAdmin()) return;

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

  target.innerHTML = `
    <h3>Nowe konto</h3>
    <form id="userForm" class="data-form">
      <label class="field">
        <span>Login</span>
        <input name="username" required autocomplete="off">
      </label>
      <label class="field">
        <span>Hasło tymczasowe</span>
        <input name="password" type="password" required minlength="10" autocomplete="new-password">
      </label>
      <label class="field">
        <span>Wyświetlana nazwa</span>
        <input name="display_name" autocomplete="off">
      </label>
      <label class="field">
        <span>Stopień</span>
        <select name="rank">
          ${ranks.map(rank => `<option value="${escapeHTML(rank)}">${escapeHTML(rank)}</option>`).join("")}
        </select>
      </label>
      <div class="content-actions">
        <button type="submit">Utwórz konto</button>
        <button type="button" id="cancelUser" class="secondary-button">Anuluj</button>
      </div>
    </form>
    <p class="dashboard-note">Stopień nie zmienia uprawnień operacyjnych. Uprawnienia administracyjne ma wyłącznie Komendantura.</p>
  `;

  $("#cancelUser").addEventListener("click", renderUsers);

  $("#userForm").addEventListener("submit", async event => {
    event.preventDefault();

    const form = event.currentTarget;
    const username = getFormValue(form, "username");
    const password = getFormValue(form, "password");
    const display_name = getFormValue(form, "display_name");
    const rank = getFormValue(form, "rank");

    if (password.length < 10) {
      showMessage("Hasło musi mieć co najmniej 10 znaków.", true);
      return;
    }

    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          display_name: display_name || username,
          rank
        })
      });

      showMessage("Utworzono konto funkcjonariusza.");
      renderUsers();
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindAuthentication();
  bindNavigation();
  loadInitialState();
});
