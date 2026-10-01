export type FundOperatingModel = "PRIVATE_CAPITAL" | "OPEN_ENDED"
export type ValuationStatus = "ESTIMATED" | "PROVISIONAL" | "FINAL" | "RESTATED"
export type LpRole = "VIEWER" | "SIGNATORY" | "MANAGER"

export interface LpFund {
  id: string
  publicReference: string
  name: string
  shortName: string
  operatingModel: FundOperatingModel
  currency: string
  shareClass?: string | null
  asOfDate: string
  valuationStatus: ValuationStatus
  investorAccountReference: string
  commitmentAmount?: string
}

export interface LpPortalUnreadCounts {
  requests: number
  messages: number
  notices: number
  notifications: number
}

export interface LpPortalClient {
  id: string
  legalName: string
  email: string
  investorId: string
  displayName?: string
}
