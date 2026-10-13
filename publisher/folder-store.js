/* Save the user-selected directory handle in browser IndexedDB.
   A stored handle does not bypass browser permissions: the editor checks
   permission on startup and only asks to restore access after a user click. */
(function () {
  'use strict';

  const DATABASE = 'blog-publisher-local';
  const STORE = 'preferences';
  const DIRECTORY_KEY = 'blog-directory';

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('此浏览器未提供 IndexedDB'));
        return;
      }
      let request;
      try {
        request = indexedDB.open(DATABASE, 1);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开目录记录'));
      request.onblocked = () => reject(new Error('目录记录被其他浏览器窗口占用'));
    });
  }

  async function transaction(mode, operation) {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        let request;
        try {
          const tx = db.transaction(STORE, mode);
          request = operation(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(request.result);
          tx.onerror = () => reject(tx.error || request.error || new Error('无法访问目录记录'));
          tx.onabort = () => reject(tx.error || new Error('目录记录写入已取消'));
        } catch (error) {
          reject(error);
        }
      });
    } finally {
      db.close();
    }
  }

  window.BlogFolderStore = Object.freeze({
    get: () => transaction('readonly', store => store.get(DIRECTORY_KEY)),
    set: handle => transaction('readwrite', store => store.put(handle, DIRECTORY_KEY)),
    clear: () => transaction('readwrite', store => store.delete(DIRECTORY_KEY))
  });
})();
