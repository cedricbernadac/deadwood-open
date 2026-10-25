// A weapon type selects rules/models; an inventory id selects one physical
// copy and its independent stock. Legacy inventories keep their type keys.
export function weaponType(id, stock) {
  return typeof stock?.weapon === 'string' ? stock.weapon
    : typeof id === 'string' ? id.split('#', 1)[0] : null;
}

export function weaponEntries(player) {
  if (player?.inventory) return Object.entries(player.inventory)
    .map(([id, stock]) => ({ id, weapon: weaponType(id, stock), stock }));
  return (player?.weapons ?? []).map(stock => ({ id: stock.id ?? stock.weapon, weapon: stock.weapon, stock }));
}

export function resolveWeaponId(player, requested) {
  if (typeof requested !== 'string') return null;
  const entries = weaponEntries(player);
  return entries.find(entry => entry.id === requested)?.id
    ?? entries.find(entry => entry.weapon === requested)?.id ?? null;
}

export function activeWeaponId(player) {
  const entries = weaponEntries(player);
  const selected = entries.find(entry => entry.id === player?.weaponId && entry.weapon === player?.weapon);
  if (selected) return selected.id;
  // Old fixtures and clients may still set only the type.
  return entries.find(entry => entry.id === player?.weapon)?.id
    ?? entries.find(entry => entry.weapon === player?.weapon)?.id
    ?? (player?.inventory || player?.weapons ? null : player?.weapon ?? null);
}

export function weaponStock(player, id = activeWeaponId(player)) {
  return weaponEntries(player).find(entry => entry.id === id)?.stock;
}
