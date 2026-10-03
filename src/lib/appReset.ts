/**
 * Completely purges all client-side storage, unregisters service workers,
 * deletes PWA asset caches, and forces a cache-busting reload from the server.
 */
export async function hardResetApp() {
  try {
    // 1. Unregister all Service Workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }

    // 2. Clear all PWA & browser Cache Storage
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }

    // 3. Clear LocalStorage and SessionStorage
    localStorage.clear();
    sessionStorage.clear();

    // 4. Clear IndexedDB databases (TanStack persister, Dexie, Supabase)
    if (window.indexedDB && indexedDB.databases) {
      try {
        const databases = await indexedDB.databases();
        await Promise.all(
          databases.map((db) => {
            if (db.name) {
              return new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(db.name!);
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
                req.onblocked = () => resolve(false);
              });
            }
            return Promise.resolve();
          })
        );
      } catch (e) {
        console.warn('Could not enumerate IndexedDB databases:', e);
      }
    }

    // 5. Expire all accessible document cookies
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const eqPos = cookie.indexOf('=');
      const name = eqPos > -1 ? cookie.substring(0, eqPos).trim() : cookie.trim();
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=${window.location.hostname}`;
    }

    // 6. Force cache-busting hard reload from the origin
    const cleanUrl = `${window.location.origin}/?reinstall=${Date.now()}`;
    window.location.replace(cleanUrl);
  } catch (error) {
    console.error('Error performing hard reset:', error);
    // Fallback: reload anyway
    window.location.reload();
  }
}