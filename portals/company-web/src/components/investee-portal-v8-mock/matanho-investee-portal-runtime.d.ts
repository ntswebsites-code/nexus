declare module "@/components/investee-portal-v8-mock/matanho-investee-portal-runtime" {
  export function startInvesteePortalV8Runtime(
    rootEl: HTMLElement,
    options?: {
      shellHtml?: string
      initialPage?: string
      liveOnly?: boolean
      onNavigate?: (page: string) => void
    }
  ): {
    setPage: (page: string) => void
    destroy: () => void
    hydrate?: (payload: unknown) => void
  }
}
