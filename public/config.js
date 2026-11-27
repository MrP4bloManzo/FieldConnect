// Public endpoint only. Database and signing credentials stay inside Supabase.
window.FIELDCONNECT_CONFIG = {
  apiBase: location.hostname === "mrp4blomanzo.github.io" || location.port === "4173"
    ? "https://yyueagefcfoqesmegvtd.supabase.co/functions/v1/fieldconnect-api" : ""
};
