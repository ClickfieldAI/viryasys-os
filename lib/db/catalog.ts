import type { DB } from "./index";

/** Preloaded solar EPC materials (indicative rates — editable on every PO line). [category, name, spec, unit, rate, tax%] */
const CATALOG: [string, string, string, string, number, number][] = [
  ["Panels", "Solar PV modules", "540 Wp mono PERC, Tier-1", "nos", 12600, 12],
  ["Panels", "Solar PV modules", "545 Wp mono PERC, Tier-1", "nos", 12900, 12],
  ["Panels", "Solar PV modules", "550 Wp mono bifacial, Tier-1", "nos", 13500, 12],
  ["Panels", "Solar PV modules", "580 Wp TOPCon bifacial, Tier-1", "nos", 14800, 12],
  ["Panels", "Solar PV modules", "335 Wp poly, Tier-1", "nos", 8500, 12],
  ["Inverters", "String inverter", "5 kW, 1-phase, IP65", "nos", 42000, 12],
  ["Inverters", "String inverter", "10 kW, 3-phase, IP65", "nos", 65000, 12],
  ["Inverters", "String inverter", "25 kW, 3-phase, IP66", "nos", 130000, 12],
  ["Inverters", "String inverter", "50 kW, 3-phase, IP66", "nos", 195000, 12],
  ["Inverters", "String inverter", "100 kW, 3-phase, IP66", "nos", 460200, 12],
  ["Inverters", "Hybrid inverter", "5 kW, battery-ready", "nos", 95000, 12],
  ["Structure", "Mounting structure", "HDG, wind load 150 km/h", "kWp", 3300, 18],
  ["Structure", "Mounting structure", "HDG elevated, wind load 180 km/h", "kWp", 3900, 18],
  ["Structure", "Mounting structure", "GI pre-galvanised, mini-rail", "kWp", 2900, 18],
  ["Structure", "Mounting structure", "Aluminium rail, metal-sheet roof", "kWp", 3600, 18],
  ["Cables", "DC solar cable", "4 sq mm, Cu, UV-resistant (Polycab)", "m", 62, 18],
  ["Cables", "DC solar cable", "6 sq mm, Cu, UV-resistant (Polycab)", "m", 92, 18],
  ["Cables", "AC cable", "3.5C 25 sq mm Al armoured", "m", 210, 18],
  ["Cables", "AC cable", "3.5C 70 sq mm Al armoured", "m", 480, 18],
  ["Cables", "AC cable", "4C 6 sq mm Cu armoured", "m", 320, 18],
  ["Cables", "DC/AC cables, conduits & BOS", "Polycab / equivalent", "kWp", 4200, 18],
  ["Cables", "Earthing strip", "GI 25x3 mm", "m", 145, 18],
  ["Cables", "Cable tray & conduit", "Perforated GI / HDPE", "m", 160, 18],
  ["Electrical", "ACDB", "3-phase, 63 A, with SPD", "nos", 14500, 18],
  ["Electrical", "ACDB", "3-phase, 160 A, with SPD", "nos", 32000, 18],
  ["Electrical", "DCDB", "4-in 4-out, 1000 V DC", "nos", 9800, 18],
  ["Electrical", "Lightning arrestor", "ESE, 60 m radius", "nos", 22000, 18],
  ["Electrical", "Earthing kit", "Chemical earthing, 3 m electrode", "nos", 7800, 18],
  ["Electrical", "Monitoring system", "Datalogger + WiFi/4G gateway", "nos", 18000, 18],
  ["Electrical", "Net / bi-directional meter", "3-phase, CT operated, Class 0.5S", "nos", 16500, 18],
  ["Electrical", "MC4 connectors", "1500 V DC pair", "nos", 85, 18],
  ["Electrical", "ACDB, DCDB, earthing, LA, monitoring", "As per design", "lot", 525000, 18],
  ["Other", "Installation consumables", "Clamps, lugs, ties, glands", "lot", 25000, 18],
  ["Other", "Transportation & unloading", "To project site", "lot", 30000, 18],
];

export function seedCatalog(db: DB) {
  if ((db.prepare("SELECT COUNT(*) c FROM material_catalog").get() as { c: number }).c > 0) return;
  const ins = db.prepare("INSERT INTO material_catalog (category, name, spec, unit, rate, tax_pct) VALUES (?,?,?,?,?,?)");
  db.transaction(() => CATALOG.forEach((r) => ins.run(...r)))();
}
