import { networkInterfaces } from 'node:os';

// The addresses the other computers on the same Wi-Fi can open, best first:
// private IPv4 only, home ranges before virtual adapters (WSL, Hyper-V…).
export function localNetworkUrls(actualPort) {
  const candidates = [];
  for (const [name, interfaces] of Object.entries(networkInterfaces())) {
    for (const address of interfaces ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const octets = address.address.split('.').map(Number);
      const privateAddress = octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
      if (!privateAddress) continue;
      const virtual = /virtual|vethernet|wsl|docker|hyper-v|vmware|virtualbox/i.test(name);
      const rank = (virtual ? 10 : 0) + (octets[0] === 192 ? 0 : octets[0] === 10 ? 1 : 2);
      candidates.push({ rank, url: `http://${address.address}:${actualPort}` });
    }
  }
  return [...new Set(candidates.sort((a, b) => a.rank - b.rank).map(candidate => candidate.url))];
}
