// To-do persistence in chrome.storage.sync. No DOM code here.

import { syncGet, syncSet, syncOnChanged } from "../shared/storage.js";

const KEY = "todos";

export const getTodos = () => syncGet(KEY, []);

export const setTodos = (todos) => syncSet(KEY, todos);

// Fires in every open new-tab page, including the one that made the change —
// mutations rely on this as the single render path.
export const onTodosChanged = (callback) =>
  syncOnChanged(KEY, (todos) => callback(todos || []));
