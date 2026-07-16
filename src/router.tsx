import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { routeTree } from "./routeTree.gen";

export interface RouterAuthContext {
  session: Session | null;
  isAuthenticated: boolean;
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  });

  const router = createRouter({
    routeTree,
    context: {
      queryClient,
      auth: { session: null, isAuthenticated: false } as RouterAuthContext,
    },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
