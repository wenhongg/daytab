// To-do checklist: render + add/toggle/delete.

import { getTodos, setTodos, onTodosChanged } from "./store.js";

const els = {
  list: document.getElementById("todo-list"),
  status: document.getElementById("todo-status"),
  form: document.getElementById("todo-form"),
  input: document.getElementById("todo-input"),
};

function setStatus(message) {
  els.status.textContent = message || "";
  els.status.classList.toggle("hidden", !message);
}

function renderTodos(todos) {
  els.list.textContent = "";
  for (const todo of todos) {
    const li = document.createElement("li");
    li.className = "todo-item" + (todo.done ? " done" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = todo.done;
    checkbox.addEventListener("change", () => {
      updateTodos((items) =>
        items.map((t) => (t.id === todo.id ? { ...t, done: checkbox.checked } : t))
      );
    });
    li.appendChild(checkbox);

    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = todo.text;
    li.appendChild(text);

    const del = document.createElement("button");
    del.className = "todo-delete";
    del.textContent = "×";
    del.setAttribute("aria-label", `Delete "${todo.text}"`);
    del.addEventListener("click", () => {
      updateTodos((items) => items.filter((t) => t.id !== todo.id));
    });
    li.appendChild(del);

    els.list.appendChild(li);
  }
}

// Writes storage only; rendering happens via the onTodosChanged listener,
// which also fires in this tab.
async function updateTodos(transform) {
  const todos = await getTodos();
  try {
    await setTodos(transform(todos));
    setStatus("");
  } catch (err) {
    // Most likely the chrome.storage.sync quota — surface it instead of
    // silently losing the edit.
    setStatus("Couldn't save. The list may be full — delete some items.");
    renderTodos(todos);
  }
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  updateTodos((items) => [...items, { id: crypto.randomUUID(), text, done: false }]);
});

// If a change from another tab arrives while the initial read is in flight,
// the read's result is stale — skip rendering it.
let gotChange = false;
onTodosChanged((todos) => {
  gotChange = true;
  renderTodos(todos);
});
getTodos().then((todos) => {
  if (!gotChange) renderTodos(todos);
});
