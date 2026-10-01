/** Shared auth helpers for client-design vanilla runtimes. */

export function getClientDesignSessionUser() {
  const u =
    typeof window !== "undefined" ? window.__CLIENT_DESIGN_SESSION_USER__ : null
  return u && typeof u === "object" ? u : null
}

export function clientDesignSignOut() {
  if (typeof window.__CLIENT_DESIGN_SIGN_OUT__ === "function") {
    window.__CLIENT_DESIGN_SIGN_OUT__()
    return true
  }
  if (typeof window.__HOME_V3_SIGN_OUT__ === "function") {
    window.__HOME_V3_SIGN_OUT__()
    return true
  }
  return false
}

export function onClientDesignSessionUser(callback) {
  const handler = (event) => {
    callback(event.detail ?? getClientDesignSessionUser())
  }
  window.addEventListener("client-design-session-user", handler)
  callback(getClientDesignSessionUser())
  return () => window.removeEventListener("client-design-session-user", handler)
}

export function escHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[m]
  )
}

export function applySessionUserToProfile(rootEl, options = {}) {
  const user = getClientDesignSessionUser()
  if (!user || !rootEl) return false

  const scope = options.scope || rootEl
  const selector =
    options.profileSelector || ".profile, .user-button, .user, .user-name"
  scope.querySelectorAll(selector).forEach((profile) => {
    const strong = profile.querySelector("strong")
    if (strong) strong.textContent = user.name

    const roleLabel = profile.querySelector("#roleLabel")
    if (roleLabel) roleLabel.textContent = user.role

    const userCopySpan = profile.querySelector(".user-copy span")
    if (userCopySpan) userCopySpan.textContent = user.role

    const avatar = profile.querySelector(".avatar")
    if (avatar && user.initials && !avatar.querySelector("img")) {
      avatar.textContent = user.initials
    }
  })

  const menuName = scope.querySelector("#v5ProfileName")
  const menuRole = scope.querySelector("#v5ProfileRole")
  if (menuName) menuName.textContent = user.name
  if (menuRole) menuRole.textContent = `${user.role} · verified session`

  return true
}

export function buildArcusProfilePopoverHtml(user, iconHtml = "") {
  const u = user ||
    getClientDesignSessionUser() || {
      name: "User",
      email: "",
      initials: "U",
      role: "Team member",
    }
  return `<div class="popover-title">Signed in as</div>
<div class="popover-item" style="cursor:default;padding-top:4px;padding-bottom:4px">
<span class="activity-icon" style="color:var(--brand,#315fc2);background:color-mix(in srgb,var(--brand,#315fc2) 12%,transparent);font-size:11px;font-weight:600">${escHtml(u.initials || "U")}</span>
<span class="popover-item-copy"><strong>${escHtml(u.name)}</strong><small>${escHtml(u.email || u.role)}</small></span>
</div>
<div class="popover-divider"></div>
<button type="button" class="popover-item" data-action="client-design-sign-out">${iconHtml}<span class="popover-item-copy"><strong>Sign out</strong><small>End your Arcus session</small></span></button>`
}
