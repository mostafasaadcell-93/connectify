// Verified product facts. Unknown stays null. Nothing here writes a price or guesses a model.

export const WARRANTY_PROVIDERS = ["apple", "samsung", "seller", "international", "local"];
export const ACTIVATIONS = ["active", "inactive"];
export const LEGACY_FACT_COLUMNS = "sku,warranty_years,region,sim,condition,verified";
export const UPGRADED_FACT_COLUMNS = LEGACY_FACT_COLUMNS + ",warranty_provider,activation";

export function missingFactColumn(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();
  if (code === "42703" || code === "PGRST204") return true;
  return (message.includes("warranty_provider") || message.includes("activation"))
    && (message.includes("column") || message.includes("schema cache"));
}

export function factsFromRow(row) {
  if (!row) return null;
  const years = row.warranty_years == null || row.warranty_years === "" ? null : Number(row.warranty_years);
  return {
    verified: row.verified === true,
    warrantyYears: Number.isFinite(years) ? years : null,
    warrantyProvider: WARRANTY_PROVIDERS.includes(row.warranty_provider) ? row.warranty_provider : null,
    region: row.region || null,
    sim: row.sim || null,
    condition: row.condition || null,
    activation: ACTIVATIONS.includes(row.activation) ? row.activation : null
  };
}

export function factWrite(fields, upgradeInstalled) {
  const source = fields || {};
  const provider = source.warrantyProvider || null;
  const activation = source.activation || null;
  if (provider != null && !WARRANTY_PROVIDERS.includes(provider)) return {ok: false, reason: "invalid_warranty_provider"};
  if (activation != null && !ACTIVATIONS.includes(activation)) return {ok: false, reason: "invalid_activation"};
  const years = source.warrantyYears == null || source.warrantyYears === "" ? null : Number(source.warrantyYears);
  const body = {
    sku: source.sku,
    warranty_years: Number.isFinite(years) ? years : null,
    region: source.region || null,
    sim: source.sim || null,
    condition: source.condition || null,
    verified: source.verified === true,
    verified_at: source.verified === true ? source.verifiedAt || null : null,
    updated_at: source.updatedAt || null
  };
  const requestedUpgrade = provider != null || activation != null;
  if (upgradeInstalled === true) {
    body.warranty_provider = provider;
    body.activation = activation;
    return {ok: true, body, storedUpgrade: true, requestedUpgrade};
  }
  return {ok: true, body, storedUpgrade: false, requestedUpgrade};
}

export function factSaveNote(result) {
  if (!result || !result.ok) return "Facts were not stored. Selling prices were not changed.";
  if (!result.storedUpgrade && result.requestedUpgrade) {
    return "Warranty years, region, SIM, and condition were saved. Warranty provider and activation were not saved because the verified-facts upgrade is not installed. Selling prices were not changed.";
  }
  if (!result.storedUpgrade) {
    const base = result.body.verified
      ? "Verified facts saved for " + result.body.sku + "."
      : "Facts saved as unverified, so matching still ignores them.";
    return base + " Warranty provider and activation stay unknown because the verified-facts upgrade is not installed. Selling prices were not changed.";
  }
  if (result.body.verified) return "Verified facts saved for " + result.body.sku + ". Selling prices were not changed.";
  return "Facts saved as unverified, so matching still ignores them. Selling prices were not changed.";
}
