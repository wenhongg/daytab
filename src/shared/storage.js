// Thin promise wrappers around chrome.storage, shared by the feature
// modules' store.js files. No DOM code here.
//
// `sync` is for small user prefs that should follow the account; `local`
// is for data too big or churny for the sync quota (e.g. cached calendar
// events) and never leaves the machine.

function makeArea(area) {
  return {
    get(key, defaultValue) {
      return new Promise((resolve) => {
        chrome.storage[area].get({ [key]: defaultValue }, (data) => resolve(data[key]));
      });
    },
    set(key, value) {
      return new Promise((resolve, reject) => {
        chrome.storage[area].set({ [key]: value }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    },
    // Fires in every open new-tab page, including the one that made the change.
    onChanged(key, callback) {
      chrome.storage.onChanged.addListener((changes, changedArea) => {
        if (changedArea === area && changes[key]) {
          callback(changes[key].newValue);
        }
      });
    },
  };
}

const sync = makeArea("sync");
const local = makeArea("local");

export const syncGet = sync.get;
export const syncSet = sync.set;
export const syncOnChanged = sync.onChanged;
export const localGet = local.get;
export const localSet = local.set;
export const localOnChanged = local.onChanged;
