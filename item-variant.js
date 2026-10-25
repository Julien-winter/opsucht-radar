const crypto = require("node:crypto");

function clean(value) {
  return String(value ?? "").replace(/§[0-9a-fk-or]/gi, "").trim();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(", ")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}: ${stableStringify(value[key])}`).join(", ")}}`;
  return JSON.stringify(value);
}

function itemVariant(item) {
  const lore = (item.lore || [])
    .map(line => clean(line).replace(/\bam \d{2}\.\d{2}\.\d{4}\b/gi, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const displayName = clean(item.displayName || "").replace(/\bam \d{2}\.\d{2}\.\d{4}\b/gi, "").replace(/\s+/g, " ").trim();
  const identity = [item.material, displayName, lore, item.enchantments || {}];
  return crypto.createHash("sha256").update(stableStringify(identity)).digest("hex").slice(0, 24);
}

module.exports = { itemVariant };
