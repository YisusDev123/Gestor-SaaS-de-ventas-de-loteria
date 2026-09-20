import { useIsMutating } from '@tanstack/react-query';
import { Download, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { canApplyPwaUpdate } from '../utils/pwa-update.js';

export function PwaStatus() {
  const activeMutations = useIsMutating();
  const canUpdate = canApplyPwaUpdate(activeMutations);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const updateRef = useRef(null);

  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => {
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return undefined;
    let active = true;
    import('virtual:pwa-register').then(({ registerSW }) => {
      if (!active) return;
      updateRef.current = registerSW({
        immediate: true,
        onNeedRefresh() { setUpdateAvailable(true); },
      });
    });
    return () => { active = false; };
  }, []);

  return <div className="pwa-notices" aria-live="polite">
    {!online && <div className="connection-notice" role="status"><WifiOff size={18} /><span><strong>Sin conexión.</strong> Puedes ver la interfaz cargada, pero ventas y datos privados requieren internet.</span></div>}
    {updateAvailable && <div className="update-notice" role="status"><Download size={18} /><span><strong>Actualización disponible.</strong>{canUpdate ? ' Puedes aplicarla ahora.' : ' Esperando a que termine la operación actual.'}</span><button className="button button--secondary" disabled={!canUpdate} onClick={() => updateRef.current?.(true)}>Actualizar</button></div>}
  </div>;
}
