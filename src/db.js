const DB_NAME = 'shuaitu-score-calculator';
const DB_VERSION = 1;
const STATE_STORE = 'app-state';
const PORTRAIT_STORE = 'portraits';
const STATE_KEY = 'current';

let databasePromise = null;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务已中止'));
  });
}

export function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STATE_STORE)) {
        database.createObjectStore(STATE_STORE);
      }
      if (!database.objectStoreNames.contains(PORTRAIT_STORE)) {
        database.createObjectStore(PORTRAIT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'));
  });

  return databasePromise;
}

export async function loadState() {
  const database = await openDatabase();
  const transaction = database.transaction(STATE_STORE, 'readonly');
  const request = transaction.objectStore(STATE_STORE).get(STATE_KEY);
  const state = await requestToPromise(request);
  await transactionToPromise(transaction);
  return state ?? null;
}

export async function saveState(state) {
  const database = await openDatabase();
  const transaction = database.transaction(STATE_STORE, 'readwrite');
  transaction.objectStore(STATE_STORE).put(state, STATE_KEY);
  await transactionToPromise(transaction);
}

export async function loadPortraits() {
  const database = await openDatabase();
  const transaction = database.transaction(PORTRAIT_STORE, 'readonly');
  const store = transaction.objectStore(PORTRAIT_STORE);
  const [keys, values] = await Promise.all([
    requestToPromise(store.getAllKeys()),
    requestToPromise(store.getAll()),
  ]);
  await transactionToPromise(transaction);
  return new Map(keys.map((key, index) => [String(key), values[index]]));
}

export async function savePortrait(heroId, blob) {
  const database = await openDatabase();
  const transaction = database.transaction(PORTRAIT_STORE, 'readwrite');
  transaction.objectStore(PORTRAIT_STORE).put(blob, heroId);
  await transactionToPromise(transaction);
}

export async function deletePortrait(heroId) {
  const database = await openDatabase();
  const transaction = database.transaction(PORTRAIT_STORE, 'readwrite');
  transaction.objectStore(PORTRAIT_STORE).delete(heroId);
  await transactionToPromise(transaction);
}
