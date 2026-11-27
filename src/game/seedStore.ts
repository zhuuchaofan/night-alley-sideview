/**
 * 待用调试种子: `setSeed(seed)` 只写待用种子, 不改当前局; 开局时消费一次,
 * 否则用随机新种子 (Date.now() % 2^31)。设计 §4 (design-rooms.md v3)。
 */

let pendingSeed: number | null = null;

/** 调试钩子 setSeed 用: 只写待用种子, 不改当前局。 */
export function setPendingSeed(seed: number): void {
  pendingSeed = seed >>> 0;
}

/** 开局时消费一次待用种子; 没有则返回 null, 调用方改用随机种子。 */
export function consumePendingSeed(): number | null {
  const seed = pendingSeed;
  pendingSeed = null;
  return seed;
}

/** 随机新种子。 */
export function newRandomSeed(): number {
  return Date.now() % 2 ** 31;
}
