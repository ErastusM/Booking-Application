import { createContext, useContext } from 'react';

// What the console shell loads for every section: the counts of what needs
// someone (sidebar badges, Overview's "Needs you") and the signed-in admin's
// money roles. `refresh` reloads them after an action.
export const AdminData = createContext({ counts: null, refresh: () => {} });
export const useAdminData = () => useContext(AdminData);
