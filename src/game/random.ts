export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function nextRandom(state: number): {
  state: number;
  value: number;
} {
  const nextState = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return { state: nextState, value: nextState / 0x1_0000_0000 };
}

export function shuffle<T>(items: T[], initialState: number): {
  items: T[];
  state: number;
} {
  const result = [...items];
  let state = initialState;

  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = nextRandom(state);
    state = random.state;
    const swapIndex = Math.floor(random.value * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return { items: result, state };
}

