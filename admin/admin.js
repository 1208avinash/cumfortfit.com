(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const config = window.CFP_SUPABASE_CONFIG;
  const configured = Boolean(config?.url && config?.publishableKey &&
    !config.url.includes("YOUR_PROJECT_REF") && !config.publishableKey.includes("YOUR_SUPABASE"));
  const screens = ["setup-screen", "login-screen", "dashboard-screen"];
  let supabase = null;

  function showScreen(id) {
    screens.forEach((screen) => { $("#" + screen).hidden = screen !== id; });
  }
  function message(text, target = "#login-message") {
    $(target).textContent = text || "";
  }
  function showLogin() { showScreen("login-screen"); }
  function showDashboard(user, role) {
    $("#user-email").textContent = user.email || "Studio member";
    $("#user-role").textContent = role;
    document.querySelectorAll(".owner-only").forEach((el) => { el.hidden = role !== "owner"; });
    document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = !["owner", "admin"].includes(role); });
    showScreen("dashboard-screen");
  }
  async function resolveMembership(user) {
    const { data, error } = await supabase.from("admin_memberships")
      .select("role,active").eq("user_id", user.id).maybeSingle();
    if (error) throw new Error("Could not verify studio access. Confirm the approved database migration is installed.");
    if (!data || data.active !== true || !["owner", "admin", "editor"].includes(data.role)) {
      await supabase.auth.signOut();
      throw new Error("This account has no active CUSTOM FIT PRIME admin invitation.");
    }
    return data.role;
  }
  async function refreshSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) { showLogin(); return; }
    try {
      const role = await resolveMembership(data.session.user);
      showDashboard(data.session.user, role);
    } catch (error) {
      showLogin();
      message(error.message);
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!configured || !window.supabase?.createClient) {
      showScreen("setup-screen");
      return;
    }
    supabase = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector("button[type=submit]");
      button.disabled = true; button.textContent = "Signing in…"; message("");
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: $("#email").value.trim(), password: $("#password").value
        });
        if (error) throw error;
        const role = await resolveMembership(data.user);
        showDashboard(data.user, role);
      } catch (error) {
        message(error.message || "Sign-in failed. Please try again.");
      } finally {
        button.disabled = false; button.textContent = "Sign in securely";
      }
    });
    $("#sign-out").addEventListener("click", async () => {
      const { error } = await supabase.auth.signOut();
      if (error) { message(error.message, "#workspace-message"); return; }
      showLogin();
    });
    $("#side-nav").addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (!button) return;
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
      const labels = { overview:"Overview", catalogue:"Catalogue", lookbook:"Lookbook", categories:"Categories", media:"Image approvals", content:"Site content", team:"Team & access", activity:"Audit history" };
      $("#view-title").textContent = labels[button.dataset.view] || "Overview";
      message("This section will be enabled in the next implementation increment.", "#workspace-message");
    });
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") showLogin();
    });
    try { await refreshSession(); }
    catch (error) { showLogin(); message(error.message); }
  });
})();