import { useEffect, useMemo, useState } from 'react';

import { clearAccessToken, login, logout, refreshSession } from '../../shared/api/api-client.js';
import { adminSessionSchema, sellerSessionSchema } from '../../shared/schemas/session.js';
import { SessionContext } from './session-context.js';

export function SessionProvider({ children }) {
  const [seller, setSeller] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [ready, setReady] = useState({ seller: false, admin: false });

  useEffect(() => {
    for (const scope of ['seller', 'admin']) {
      const schema = scope === 'admin' ? adminSessionSchema : sellerSessionSchema;
      refreshSession(scope)
        .then((data) => {
          const parsed = schema.parse(data);
          if (scope === 'admin') setAdmin(parsed);
          else setSeller(parsed);
        })
        .catch(() => clearAccessToken(scope))
        .finally(() => setReady((current) => ({ ...current, [scope]: true })));
    }
  }, []);

  const value = useMemo(() => ({
    seller,
    admin,
    ready,
    async signIn(scope, credentials) {
      const data = await login(scope, credentials.email, credentials.password);
      const parsed = (scope === 'admin' ? adminSessionSchema : sellerSessionSchema).parse(data);
      if (scope === 'admin') setAdmin(parsed);
      else setSeller(parsed);
      setReady((current) => ({ ...current, [scope]: true }));
      return parsed;
    },
    async signOut(scope) {
      await logout(scope);
      if (scope === 'admin') setAdmin(null);
      else setSeller(null);
    },
  }), [admin, ready, seller]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
