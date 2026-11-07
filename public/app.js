async function renderUsers() {
  if (!isAdmin()) {
    contentArea.innerHTML = `
      <div class="panel">
        <h2>Brak dostępu</h2>
        <p>Tylko Komendantura może zarządzać kontami.</p>
      </div>
    `;
    return;
  }

  try {
    state.users = await api("/api/users");

    contentArea.innerHTML = `
      <section class="panel">
        <h2>ZARZĄDZANIE DOSTĘPAMI</h2>
        <p>Tworzenie kont funkcjonariuszy KPP Lubin.</p>

        <form id="userForm">
          <label>Login</label>
          <input name="username" type="text" required minlength="3" autocomplete="off">

          <label>Hasło</label>
          <input name="password" type="password" required minlength="12" autocomplete="new-password">

          <label>Imię i nazwisko</label>
          <input name="display_name" type="text" required>

          <label>Numer odznaki</label>
          <input name="badge" type="text">

          <label>Stopień</label>
          <select name="rank" required>
            <option value="Posterunkowy">Posterunkowy</option>
            <option value="Sierżant">Sierżant</option>
            <option value="Starszy Sierżant">Starszy Sierżant</option>
            <option value="Aspirant">Aspirant</option>
            <option value="Komendant">Komendant</option>
            <option value="Zastępca Komendanta">Zastępca Komendanta</option>
            <option value="Naczelnik">Naczelnik</option>
            <option value="Zastępca Naczelnika">Zastępca Naczelnika</option>
            <option value="Funkcjonariusz">Funkcjonariusz</option>
          </select>

          <button type="submit">UTWÓRZ KONTO</button>
        </form>
      </section>

      <section class="panel">
        <h2>LISTA FUNKCJONARIUSZY</h2>
        <div id="usersList"></div>
      </section>
    `;

    const userForm = document.getElementById("userForm");

    userForm.addEventListener("submit", async event => {
      event.preventDefault();

      const button = userForm.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = "TWORZENIE KONTA...";

      try {
        await api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            username: userForm.querySelector('[name="username"]').value.trim(),
            password: userForm.querySelector('[name="password"]').value,
            display_name: userForm.querySelector('[name="display_name"]').value.trim(),
            badge: userForm.querySelector('[name="badge"]').value.trim(),
            rank: userForm.querySelector('[name="rank"]').value,
            role_group: "Funkcjonariusz"
          })
        });

        userForm.reset();
        showMessage("Konto funkcjonariusza zostało utworzone.");
        await renderUsers();
      } catch (error) {
        showMessage("Błąd tworzenia konta: " + error.message, true);
      } finally {
        button.disabled = false;
        button.textContent = "UTWÓRZ KONTO";
      }
    });

    const usersList = document.getElementById("usersList");

    if (!state.users.length) {
      usersList.innerHTML = "<p>Brak utworzonych kont.</p>";
      return;
    }

    usersList.innerHTML = state.users.map(user => `
      <div class="user-row">
        <strong>${escapeHtml(user.display_name || user.username)}</strong>
        <p>Login: ${escapeHtml(user.username)}</p>
        <p>Stopień: ${escapeHtml(user.rank || "Nieustalony")}</p>
        <p>Odznaka: ${escapeHtml(user.badge || "Brak")}</p>
        <p>Status: ${user.active ? "Aktywne" : "Nieaktywne"}</p>

        <button type="button" data-toggle-user="${user.id}">
          ${user.active ? "DEZAKTYWUJ" : "AKTYWUJ"}
        </button>

        <button type="button" data-delete-user="${user.id}">
          USUŃ KONTO
        </button>
      </div>
    `).join("");

    usersList.querySelectorAll("[data-toggle-user]").forEach(button => {
      button.addEventListener("click", async () => {
        try {
          const id = button.dataset.toggleUser;
          const user = state.users.find(item => String(item.id) === String(id));

          await api(`/api/users/${id}/active`, {
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

    usersList.querySelectorAll("[data-delete-user]").forEach(button => {
      button.addEventListener("click", async () => {
        const id = button.dataset.deleteUser;

        if (!confirm("Czy na pewno chcesz usunąć to konto?")) return;

        try {
          await api(`/api/users/${id}`, { method: "DELETE" });
          showMessage("Konto zostało usunięte.");
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
