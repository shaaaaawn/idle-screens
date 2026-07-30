const IPFS_GATEWAY = 'https://dweb.link/ipfs/';

export function resolveIpfsUrl(url: string): string {
  if (!url.startsWith('ipfs://')) return url;
  const stripped = url.slice('ipfs://'.length);
  return `${IPFS_GATEWAY}${stripped}`;
}

export interface FishEntry {
  id: number;
  name: string;
  breed: string;
  ipfs3d: string;
  localGlb: string;
}

export const FISH_CATALOG: FishEntry[] = [
  { id: 257, name: 'Fish 257', breed: 'angelfish', ipfs3d: 'ipfs://QmaHbEQAP6k2zopJHJBzyaK62zNX5yH8yASDjkaG4DY9Dp/fish_257_of_the_metaquarium_3d.glb', localGlb: '/assets/metaquarium/fish-257-angelfish.glb' },
  { id: 258, name: 'Fish 258', breed: 'angelfish', ipfs3d: 'ipfs://QmUZGF3ge3d9rzrtxrD6V4qx2gLtGeeNLuCb8fQeNyUkwJ/fish_258_of_the_metaquarium_3d.glb', localGlb: '' },
  { id: 259, name: 'Fish 259', breed: 'angelfish', ipfs3d: 'ipfs://QmfBBnNrVrkffMKoESvq3cB6nAWGpfMPjduTgw1unahvPf/fish_259_of_the_metaquarium_3d.glb', localGlb: '' },
  { id: 100, name: 'Fish 100', breed: 'betafish', ipfs3d: 'ipfs://Qmb5Uu8u154QTzoGpB6ypwVfPZ8NUsU519tQmrgE8yQrWV/fish_100_of_the_metaquarium_3d.glb', localGlb: '/assets/metaquarium/fish-100-betafish.glb' },
  { id: 457, name: 'Fish 457', breed: 'seahorse', ipfs3d: 'ipfs://QmVvEaCa6zRp8Z9YkkZVYBn2owSdwZxupEQacjfd1b2HA2/fish_457_of_the_metaquarium_3d.glb', localGlb: '' },
  { id: 497, name: 'Fish 497', breed: 'seaturtle', ipfs3d: 'ipfs://QmTBNvoUiwPw9HSUmy1qKCWPBKkBRAensgooYVqMmsviaE/fish_497_of_the_metaquarium_3d.glb', localGlb: '' },
];

export const DEFAULT_FISH = FISH_CATALOG[0]!;
